import type { AlbumCandidate, AlbumQuery, AlbumSearchPage } from "./contracts.js";
import { StreamingError } from "./resolution.js";
import { albumSearchTitle } from "./album-search-title.js";

const endpoint = "https://music.youtube.com/youtubei/v1/search";
const albumFilter = "EgWKAQIYAWoKEAkQBRAKEAMQBA%3D%3D";
export type YouTubeMusicSearchEvent =
  | {readonly kind: "request"; readonly method: "POST"; readonly endpoint: string; readonly query: string; readonly clientVersion: string; readonly continued: boolean}
  | {readonly kind: "response"; readonly status: number; readonly contentType: string; readonly error?: {readonly code?: number; readonly status?: string; readonly message?: string}; readonly bodyFormat?: "json" | "non-json"}
  | {readonly kind: "failure"; readonly code: "network" | "cancelled" | "invalid-response"; readonly message: string};

function diagnosticText(value: string): string {
  return value.replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
    .replace(/((?:access_token|refresh_token|authorization|cookie|api[_-]?key|key|token)\s*[=:]\s*)[^\s,;<>]+/gi, "$1[redacted]")
    .slice(0, 500);
}
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
}
function at(value: unknown, ...path: string[]): unknown {
  for (const key of path) value = object(value)[key];
  return value;
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string {
  return array(at(value, "runs")).map(run => object(run)["text"]).filter(part => typeof part === "string").join("");
}
export function youtubeMusicSearchUrl(title: string, artist: string): string {
  const url = new URL("https://music.youtube.com/search");
  url.searchParams.set("q", `${title} ${artist}`.trim());
  return url.href;
}
export function isYouTubeAlbumUrl(value: string, id: string): boolean {
  try {
    const url = new URL(value);
    return /^MPRE[a-zA-Z0-9_-]{4,200}$/.test(id) && url.origin === "https://music.youtube.com" &&
      !url.username && !url.password && url.pathname === `/browse/${id}` && !url.search && !url.hash;
  } catch { return false; }
}
export function isYouTubeArtwork(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["lh3.googleusercontent.com", "yt3.googleusercontent.com", "i.ytimg.com"].includes(url.hostname);
  } catch { return false; }
}

export function parseYouTubeAlbums(value: unknown): readonly AlbumCandidate[] | AlbumSearchPage {
  if (!object(value)["contents"] && !object(value)["continuationContents"]) {
    throw new StreamingError("invalid-response", "O YouTube Music mudou ou não retornou uma busca válida. Tente novamente ou exporte o log.");
  }
  const candidates = new Map<string, AlbumCandidate>();
  let nextPage: string | undefined;
  let nodes = 0;
  let knownContainer = false;
  const visit = (node: unknown, depth = 0): void => {
    if (depth > 40 || ++nodes > 50000) throw new StreamingError("invalid-response", "Resposta do YouTube Music excedeu o limite de processamento.");
    if (!node || typeof node !== "object") return;
    if (["sectionListRenderer", "musicShelfRenderer", "musicShelfContinuation", "itemSectionRenderer"].some(key => key in node)) knownContainer = true;
    const item = object(object(node)["musicResponsiveListItemRenderer"]);
    if (Object.keys(item).length) {
      const browse = at(item, "navigationEndpoint", "browseEndpoint");
      const id = object(browse)["browseId"];
      const pageType = at(browse, "browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig", "pageType");
      const columns = array(item["flexColumns"]);
      const title = text(at(columns[0], "musicResponsiveListItemFlexColumnRenderer", "text")).trim();
      const runs = array(at(columns[1], "musicResponsiveListItemFlexColumnRenderer", "text", "runs"));
      const artists = runs.flatMap(run => {
        const artistId = at(run, "navigationEndpoint", "browseEndpoint", "browseId");
        const name = object(run)["text"];
        return typeof artistId === "string" && /^UC[a-zA-Z0-9_-]+$/.test(artistId) && typeof name === "string" && name.trim()
          ? [{id: artistId, name: name.trim()}] : [];
      });
      if (typeof id === "string" && pageType === "MUSIC_PAGE_TYPE_ALBUM" && title && artists.length) {
        const url = `https://music.youtube.com/browse/${id}`;
        if (isYouTubeAlbumUrl(url, id)) {
          const thumbnails = array(at(item, "thumbnail", "musicThumbnailRenderer", "thumbnail", "thumbnails"));
          const artwork = thumbnails.map(t => object(t)["url"]).filter((url): url is string => typeof url === "string" && isYouTubeArtwork(url)).at(-1);
          const year = runs.map(run => object(run)["text"]).find(part => typeof part === "string" && /^\d{4}$/.test(part));
          candidates.set(id, {service: "youtube-music", id, title, artists, url,
            ...(artwork ? {artworkUrl: artwork} : {}), ...(typeof year === "string" ? {releaseDate: year} : {})});
        }
      }
      return;
    }
    const token = at(node, "nextContinuationData", "continuation") ?? at(node, "continuationCommand", "token");
    if (typeof token === "string" && token.length <= 8192) nextPage = token;
    for (const child of Object.values(node)) visit(child, depth + 1);
  };
  visit(object(value)["contents"] ?? object(value)["continuationContents"]);
  if (!knownContainer) throw new StreamingError("invalid-response", "Formato de busca do YouTube Music não reconhecido. Exporte o log e tente novamente mais tarde.");
  return nextPage ? {candidates: [...candidates.values()], complete: false, nextPage} : [...candidates.values()];
}

export class YouTubeMusicClient {
  readonly id = "youtube-music" as const;
  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}
  async search(query: AlbumQuery, signal?: AbortSignal, cursor?: string, onDiagnostic?: (event: YouTubeMusicSearchEvent) => void): Promise<readonly AlbumCandidate[] | AlbumSearchPage> {
    if (!query.title.trim() || query.title.length > 200 || query.artist.length > 200 || (cursor !== undefined && (!cursor || cursor.length > 8192))) {
      throw new StreamingError("invalid-query", "Informe um álbum válido para buscar no YouTube Music.");
    }
    const url = new URL(endpoint);
    if (cursor) {
      let token: string;
      try { token = decodeURIComponent(cursor); }
      catch { throw new StreamingError("invalid-query", "Continuação inválida. Faça uma nova busca."); }
      url.searchParams.set("ctoken", token);
      url.searchParams.set("continuation", token);
    }
    const title = albumSearchTitle(query);
    const version = `1.${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.01.00`;
    onDiagnostic?.({kind: "request", method: "POST", endpoint, query: `${title} ${query.artist}`.trim(), clientVersion: version, continued: Boolean(cursor)});
    let response: Response;
    try {
      response = await this.fetcher(url.href, {method: "POST", credentials: "omit", redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({context: {client: {clientName: "WEB_REMIX", clientVersion: version, hl: "en", gl: "BR"}},
          query: `${title} ${query.artist}`.trim(), params: albumFilter})});
    } catch {
      onDiagnostic?.({kind: "failure", code: signal?.aborted ? "cancelled" : "network", message: "Requisição encerrada sem resposta HTTP disponível."});
      throw new StreamingError(signal?.aborted ? "cancelled" : "network", "Não foi possível consultar o YouTube Music. Tente novamente.");
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.slice(0, 100);
    if (!response.ok) {
      let bodyFormat: "json" | "non-json" = "non-json";
      let error: Extract<YouTubeMusicSearchEvent, {kind: "response"}>["error"];
      try {
        const body = object(await response.json());
        bodyFormat = "json";
        const details = object(body["error"]);
        error = {
          ...(typeof details["code"] === "number" ? {code: details["code"]} : {}),
          ...(typeof details["status"] === "string" ? {status: diagnosticText(details["status"])} : {}),
          ...(typeof details["message"] === "string" ? {message: diagnosticText(details["message"])} : {}),
        };
      } catch { /* Record HTTP metadata only; never include raw HTML or response headers. */ }
      onDiagnostic?.({kind: "response", status: response.status, contentType, bodyFormat, ...(error ? {error} : {})});
      throw new StreamingError(response.status === 429 ? "rate-limited" : "unavailable",
        response.status === 429 ? "O YouTube Music limitou as consultas. Aguarde antes de tentar novamente." : "YouTube Music indisponível para esta consulta.");
    }
    onDiagnostic?.({kind: "response", status: response.status, contentType});
    try { return parseYouTubeAlbums(await response.json()); }
    catch (error) {
      onDiagnostic?.({kind: "failure", code: "invalid-response", message: error instanceof StreamingError ? error.message : "O corpo da resposta não é um JSON válido."});
      if (error instanceof StreamingError) throw error;
      throw new StreamingError("invalid-response", "Resposta inválida do YouTube Music.");
    }
  }
}
