export type LastfmLanguage = "pt" | "en";
export interface LastfmQuery {readonly title: string;readonly artist: string;readonly language: LastfmLanguage}
export interface LastfmAlbum {
  readonly status: "ready" | "empty";
  readonly title: string;readonly artist: string;readonly url: string;readonly requestedLanguage: LastfmLanguage;
  readonly mbid?: string;readonly artworkUrl?: string;
  readonly tags: readonly string[];
  readonly tracks: readonly {readonly title: string;readonly number?: number;readonly durationSeconds?: number}[];
  readonly about?: string;readonly summary?: string;
  readonly rawAbout?: string;readonly rawSummary?: string;
  readonly attribution: {readonly source: "Last.fm";readonly url: string;readonly license: "Last.fm API Terms of Service";readonly licenseUrl: string};
}
export type LastfmFailure = "invalid-query" | "configuration-required" | "invalid-key" | "not-found" | "mismatch" | "invalid-response" | "rate-limited" | "network" | "timeout" | "cancelled" | "unavailable";
const messages: Record<LastfmFailure,string> = {
  "invalid-query":"Informe álbum, artista e idioma Português ou Inglês.","configuration-required":"Salve sua API key Last.fm nas configurações.",
  "invalid-key":"O Last.fm recusou a API key. Confira a credencial salva.","not-found":"Álbum não encontrado no Last.fm.",
  mismatch:"O Last.fm retornou outro álbum ou artista. Confira os termos da consulta.","invalid-response":"O Last.fm retornou dados inválidos.",
  "rate-limited":"O Last.fm limitou as consultas. Aguarde antes de tentar novamente.",network:"Não foi possível consultar o Last.fm. Confira sua conexão.",
  timeout:"O Last.fm demorou para responder. Tente novamente.",cancelled:"Consulta Last.fm cancelada.",unavailable:"O Last.fm está indisponível. Tente novamente mais tarde.",
};
export class LastfmError extends Error {constructor(readonly code:LastfmFailure){super(messages[code]);this.name="LastfmError";}}
export interface LastfmDiagnostic {readonly stage:"request"|"response"|"result"|"failure";readonly durationMs:number;readonly status?:number;readonly code?:LastfmFailure;readonly tracks?:number;readonly hasAbout?:boolean;readonly count?:number;readonly method?:"album.getInfo"|"album.search"}
const endpoint="https://ws.audioscrobbler.com/2.0/";
function object(value:unknown):Record<string,unknown>{return value && typeof value==="object" && !Array.isArray(value)?value as Record<string,unknown>:{};}
function text(value:unknown,max=512):string|undefined{return typeof value==="string" && value.trim() && value.length<=max?value.trim():undefined;}
function identity(value:string):string{return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g," ").trim();}
export function lastfmQuery(value:unknown):LastfmQuery {
  const input=object(value),title=text(input["title"],200),artist=text(input["artist"],200),language=input["language"];
  if(!title||!artist||language!=="pt"&&language!=="en")throw new LastfmError("invalid-query");
  return {title,artist,language};
}
function prose(value:unknown):string|undefined {
  if(value===undefined||value==="")return undefined;
  if(typeof value!=="string"||value.length>200_000)throw new LastfmError("invalid-response");
  const clean=value.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,"").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,"")
    .replace(/<br\s*\/?\s*>|<\/p\s*>/gi,"\n").replace(/<[^>]*>/g,"")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi,entity=>{
      const known:Record<string,string>={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'","&nbsp;":" "};
      if(known[entity.toLowerCase()]!==undefined)return known[entity.toLowerCase()]!;
      const n=entity.slice(2,-1),code=n[0]?.toLowerCase()==="x"?parseInt(n.slice(1),16):Number(n);
      return Number.isInteger(code)&&code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):"";
    }).replace(/\r\n?/g,"\n").trim();
  return clean||undefined;
}
function httpUrl(value:unknown,hosts:readonly string[]):string|undefined {
  if(typeof value!=="string"||value.length>2048)return undefined;
  try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password&&hosts.includes(url.hostname)?url.href:undefined;}catch{return undefined;}
}
export function parseLastfmAlbum(value:unknown,query:LastfmQuery):LastfmAlbum {
  const root=object(value),album=object(root["album"]),title=text(album["name"]),artist=text(album["artist"]);
  if(!title||!artist)throw new LastfmError("invalid-response");
  if(identity(title)!==identity(query.title)||identity(artist)!==identity(query.artist))throw new LastfmError("mismatch");
  const url=httpUrl(album["url"],["www.last.fm","last.fm"]);
  if(!url)throw new LastfmError("invalid-response");
  const path=new URL(url).pathname.split("/");
  try{if(path[1]!=="music"||identity(decodeURIComponent(path[2]!.replace(/\+/g," ")))!==identity(artist)||identity(decodeURIComponent(path[3]!.replace(/\+/g," ")))!==identity(title))throw Error();}catch{throw new LastfmError("invalid-response");}
  const wiki=object(album["wiki"]),about=prose(wiki["content"]),summary=prose(wiki["summary"]);
  const rawTracks=object(album["tracks"])["track"],rawTags=object(album["tags"])["tag"];
  if(rawTracks!==undefined&&(!Array.isArray(rawTracks)||rawTracks.length>1000))throw new LastfmError("invalid-response");
  const tracks=(Array.isArray(rawTracks)?rawTracks:[]).map(value=>{
    const track=object(value),title=text(track["name"]);if(!title)throw new LastfmError("invalid-response");
    const number=Number(object(track["@attr"])["rank"]),durationSeconds=Number(track["duration"]);
    return {title,...(Number.isSafeInteger(number)&&number>0?{number}:{}),...(Number.isSafeInteger(durationSeconds)&&durationSeconds>0?{durationSeconds}:{})};
  });
  const tags=[...new Set((Array.isArray(rawTags)?rawTags:[]).map(value=>text(object(value)["name"])).filter((value):value is string=>Boolean(value)))];
  const mbid=text(album["mbid"]),validMbid=mbid&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(mbid)?mbid:undefined;
  const images=Array.isArray(album["image"])?album["image"]:[];
  const artworkUrl=[...images].reverse().map(value=>httpUrl(object(value)["#text"],["lastfm.freetls.fastly.net","lastfm-img2.akamaized.net"])).find(Boolean);
  return {status:tracks.length||about||summary||validMbid?"ready":"empty",title,artist,url,requestedLanguage:query.language,tags,tracks,
    ...(validMbid?{mbid:validMbid}:{}),...(artworkUrl?{artworkUrl}:{}),...(about?{about}:{}),...(summary?{summary}:{}),
    ...(typeof wiki["content"] === "string" && wiki["content"].trim() ? {rawAbout: wiki["content"]} : {}),
    ...(typeof wiki["summary"] === "string" && wiki["summary"].trim() ? {rawSummary: wiki["summary"]} : {}),
    attribution:{source:"Last.fm",url,license:"Last.fm API Terms of Service",licenseUrl:"https://www.last.fm/api/tos"}};
}
export type LastfmAlbumMatch = Pick<LastfmAlbum, "title" | "artist" | "url" | "artworkUrl" | "requestedLanguage">;
export interface LastfmSearchPage {readonly albums: readonly LastfmAlbumMatch[]; readonly page: number; readonly pages: number}
interface LastfmRequestOptions {signal?: AbortSignal; onDiagnostic?: (event: LastfmDiagnostic) => void}
export function parseLastfmSearch(value: unknown, language: LastfmLanguage, page: number): LastfmSearchPage {
  const results = object(object(value)["results"]), matches = object(results["albummatches"]);
  const raw = matches["album"];
  const total = Number(results["opensearch:totalResults"]), perPage = Number(results["opensearch:itemsPerPage"]);
  if (!Object.hasOwn(results, "albummatches") || !Number.isSafeInteger(total) || total < 0 ||
    total > 0 && (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 200) ||
    raw !== undefined && !Array.isArray(raw) && (!raw || typeof raw !== "object")) throw new LastfmError("invalid-response");
  const unique = new Map<string, LastfmAlbumMatch>();
  for (const item of (Array.isArray(raw) ? raw : raw ? [raw] : []).slice(0, 200)) {
    const data = object(item), title = text(data["name"], 200), artist = text(data["artist"], 200);
    if (!title || !artist) continue;
    try {
      const album = parseLastfmAlbum({album: {name: title, artist, url: data["url"], image: data["image"]}}, {title, artist, language});
      unique.set(identity(artist) + "\n" + identity(title), {title: album.title, artist: album.artist, url: album.url,
        requestedLanguage: language, ...(album.artworkUrl ? {artworkUrl: album.artworkUrl} : {})});
    } catch { /* A malformed match must not become a selectable album. */ }
  }
  return {albums: [...unique.values()], page, pages: Math.max(1, Math.min(100, Math.ceil(total / (perPage || 25))))};
}
export class LastfmClient {
  constructor(private readonly environment:{key():Promise<string|undefined>;fetch?:typeof fetch;timeoutMs?:number}) {}
  album(value: unknown, options: LastfmRequestOptions = {}): Promise<LastfmAlbum> {
    return this.request(() => {
      const query = lastfmQuery(value);
      return {params: {method: "album.getInfo" as const, artist: query.artist, album: query.title, lang: query.language, autocorrect: "0"},
        parse: (data: unknown) => parseLastfmAlbum(data, query),
        diagnostic: (album: LastfmAlbum) => ({tracks: album.tracks.length, hasAbout: Boolean(album.about || album.summary)})};
    }, options);
  }
  search(value: unknown, options: LastfmRequestOptions & {page?: number} = {}): Promise<LastfmSearchPage> {
    return this.request(() => {
      const input = object(value), title = text(input["title"], 200), language = input["language"], page = options.page ?? 1;
      if (!title || language !== "pt" && language !== "en" || !Number.isSafeInteger(page) || page < 1 || page > 100) throw new LastfmError("invalid-query");
      return {params: {method: "album.search" as const, album: title, limit: "25", page: String(page)},
        parse: (data: unknown) => parseLastfmSearch(data, language, page), diagnostic: (result: LastfmSearchPage) => ({count: result.albums.length})};
    }, options);
  }
  private async request<T>(operation: () => {params: Record<string, string> & {method: "album.getInfo" | "album.search"}; parse(data: unknown): T;
    diagnostic(result: T): {tracks?: number; hasAbout?: boolean; count?: number}}, options: LastfmRequestOptions): Promise<T> {
    let method: "album.getInfo" | "album.search" | undefined;
    const started=Date.now(),emit=(stage:LastfmDiagnostic["stage"],fields:Omit<LastfmDiagnostic,"stage"|"durationMs">={})=>options.onDiagnostic?.({stage,durationMs:Math.max(0,Date.now()-started),...(method ? {method} : {}),...fields});
    const timeout=AbortSignal.timeout(this.environment.timeoutMs??20000),signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
    let status:number|undefined;
    try {
      const task=operation();method=task.params.method;signal.throwIfAborted();const key=await this.environment.key();signal.throwIfAborted();
      if(!key||!/^[\da-f]{32}$/i.test(key))throw new LastfmError("configuration-required");
      const url=new URL(endpoint);url.search=new URLSearchParams({...task.params,api_key:key,format:"json"}).toString();
      emit("request");const response=await (this.environment.fetch??fetch)(url.href,{credentials:"omit",redirect:"error",signal});status=response.status;emit("response",{status});
      if(status===429)throw new LastfmError("rate-limited");
      if(status>=500)throw new LastfmError("unavailable");
      const raw=await response.text();signal.throwIfAborted();if(raw.length>2_000_000)throw new LastfmError("invalid-response");
      let data:unknown;try{data=JSON.parse(raw);}catch{throw new LastfmError("invalid-response");}
      const error=object(data)["error"];
      if(error!==undefined)throw new LastfmError(error===10||error===26?"invalid-key":error===29?"rate-limited":error===6?(status===404?"not-found":"invalid-query"):"unavailable");
      if(!response.ok)throw new LastfmError(status===404?"not-found":status===403?"invalid-key":"unavailable");
      const result=task.parse(data);emit("result",{status,...task.diagnostic(result)});return result;
    } catch(error) {
      const failure=new LastfmError(options.signal?.aborted?"cancelled":timeout.aborted?"timeout":error instanceof LastfmError?error.code:"network");
      emit("failure",{...(status!==undefined?{status}:{}),code:failure.code});throw failure;
    }
  }
}

export function isLastfmSourceId(value: unknown): value is string {
  if(typeof value!=="string"||value.length>2048)return false;
  try {const url=new URL(value);return url.protocol==="https:"&&["www.last.fm","last.fm"].includes(url.hostname)&&!url.username&&!url.password&&!url.port&&!url.search&&/^\/music\/[^/]+\/[^/]+\/?$/.test(url.pathname)&&["#pt","#en"].includes(url.hash);}catch{return false;}
}
