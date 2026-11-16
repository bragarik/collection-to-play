import {createRequestDiagnostics, type RequestFailure, type SearchTiming} from "./request-diagnostics.js";
import type {AlbumCandidate, AlbumQuery, AlbumSearchPage, StreamingAdapter} from "../shared/contracts.js";
import {normalizeMetadata, StreamingError} from "../albums/resolution.js";
import {albumSearchTitle} from "../albums/album-search-title.js";

const endpoint = "https://itunes.apple.com/search";
// Search documents a result limit, but no continuation token or offset.
const resultLimit = 200;
type ItunesStage = "album-search" | "artist-search" | "artist-albums";
export type ItunesSearchEvent =
  | {readonly kind: "request"; readonly stage: ItunesStage; readonly at: string; readonly timeoutMs: number; readonly endpoint: string; readonly query: string; readonly country: "br"; readonly artistId?: string}
  | (SearchTiming & {readonly kind: "response"; readonly stage: ItunesStage; readonly status: number; readonly contentType: string})
  | (SearchTiming & {readonly kind: "results"; readonly stage: ItunesStage; readonly returned: number; readonly incomplete: boolean})
  | (SearchTiming & {readonly kind: "cache"; readonly stage: ItunesStage})
  | (SearchTiming & {readonly kind: "supplement"; readonly state: "started" | "complete" | "partial" | "skipped"; readonly reason?: "ambiguous-artist" | "artist-limit" | "no-artist" | "request-failed"; readonly artistCount?: number; readonly added?: number})
  | (RequestFailure & {readonly stage?: ItunesStage});

interface ItunesArtist {readonly id: string; readonly name: string}
const lookupEndpoint = "https://itunes.apple.com/lookup";
const artistLimit = 25;
const maxArtists = 3;
const cacheLifetimeMs = 10 * 60 * 1000;
const cacheEntryLimit = 64;
function resultsFrom(value: unknown, maximum: number): unknown[] {
  const data = object(value), results = data["results"];
  if (!Array.isArray(results) || !Number.isSafeInteger(data["resultCount"]) || data["resultCount"] !== results.length || results.length > maximum) {
    throw new StreamingError("invalid-response", "O iTunes retornou uma resposta de busca inválida.");
  }
  return results;
}
function parseArtists(value: unknown): {artists: readonly ItunesArtist[]; incomplete: boolean} {
  const results = resultsFrom(value, artistLimit), artists = new Map<string, ItunesArtist>();
  for (const raw of results) {
    const item = object(raw), id = identifier(item["artistId"]), name = item["artistName"];
    if (item["wrapperType"] !== "artist" || !id || !text(name)) throw new StreamingError("invalid-response", "O iTunes retornou um artista inválido.");
    artists.set(id, {id, name});
  }
  return {artists: [...artists.values()], incomplete: results.length === artistLimit};
}
function candidatesFrom(result: readonly AlbumCandidate[] | AlbumSearchPage): readonly AlbumCandidate[] {return "candidates" in result ? result.candidates : result;}
function parseArtistAlbums(value: unknown, artist: ItunesArtist): readonly AlbumCandidate[] | AlbumSearchPage {
  // Lookup includes the artist entry in addition to at most 200 collections.
  const results = resultsFrom(value, resultLimit + 1);
  const artists = results.filter(raw => object(raw)["wrapperType"] === "artist");
  if (artists.length !== 1 || identifier(object(artists[0])["artistId"]) !== artist.id ||
    typeof object(artists[0])["artistName"] !== "string" || normalizeMetadata(object(artists[0])["artistName"] as string) !== normalizeMetadata(artist.name)) {
    throw new StreamingError("invalid-response", "A resposta do iTunes não corresponde ao artista consultado.");
  }
  const collections = results.filter(raw => object(raw)["wrapperType"] !== "artist");
  return parseItunesAlbums({resultCount: collections.length, results: collections});
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function identifier(value: unknown): string | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
}
function text(value: unknown): value is string {return typeof value === "string" && Boolean(value.trim());}

export function itunesSearchUrl(title: string, artist: string): string {
  const url = new URL("https://music.apple.com/br/search");
  url.searchParams.set("term", `${title} ${artist}`.trim());
  return url.href;
}

export function isItunesAlbumUrl(value: string, id: string): boolean {
  try {
    const url = new URL(value);
    return /^[1-9]\d{0,15}$/.test(id) && url.origin === "https://music.apple.com" && !url.username && !url.password && !url.port &&
      new RegExp(`^/br/album/(?:[^/]+/)?${id}/?$`).test(url.pathname) && !url.hash &&
      [...url.searchParams].every(([key, entry]) => key === "uo" && /^\d+$/.test(entry));
  } catch {return false;}
}
export function isItunesArtwork(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      url.hostname.endsWith(".mzstatic.com") && url.pathname.startsWith("/image/");
  } catch {return false;}
}

export function parseItunesAlbums(value: unknown): readonly AlbumCandidate[] | AlbumSearchPage {
  const results = resultsFrom(value, resultLimit);
  const albums = new Map<string, AlbumCandidate>();
  for (const entry of results) {
    const item = object(entry);
    if (item["wrapperType"] !== "collection" || item["collectionType"] !== "Album") continue;
    const id = identifier(item["collectionId"]), artistId = identifier(item["artistId"]);
    const title = item["collectionName"], artist = item["artistName"], url = item["collectionViewUrl"];
    if (!id || !artistId || !text(title) || !text(artist) || !text(url) || !isItunesAlbumUrl(url, id)) {
      throw new StreamingError("invalid-response", "O iTunes retornou dados ou endereço de álbum inválidos.");
    }
    const artworkVariants = ([60, 100] as const).flatMap(size => {
      const image = item[`artworkUrl${size}`];
      return typeof image === "string" && isItunesArtwork(image) ? [{url: image, width: size, height: size}] : [];
    });
    const artworkUrl = artworkVariants.at(-1)?.url;
    const release = item["releaseDate"];
    const releaseDate = typeof release === "string" && /^\d{4}-\d{2}-\d{2}T/.test(release) && Number.isFinite(Date.parse(release)) ? release.slice(0, 10) : undefined;
    albums.set(id, {service: "apple-music", id, title, artists: [{id: artistId, name: artist}], url,
      ...(releaseDate ? {releaseDate} : {}), ...(artworkUrl ? {artworkUrl, artworkVariants} : {})});
  }
  const candidates = [...albums.values()];
  return results.length === resultLimit ? {candidates, complete: false} : candidates;
}

export class ItunesClient implements StreamingAdapter {
  readonly id = "apple-music" as const;
  private readonly cache = new Map<string, {expiresAt: number; value: unknown}>();
  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}

  async search(query: AlbumQuery, signal?: AbortSignal, onDiagnostic?: (event: ItunesSearchEvent) => void): Promise<readonly AlbumCandidate[] | AlbumSearchPage> {
    if (!query.title.trim() || query.title.length > 200 || query.artist.length > 200) {
      throw new StreamingError("invalid-query", "Informe um álbum válido para buscar no iTunes.");
    }
    let stage: ItunesStage = "album-search";
    const trace = createRequestDiagnostics("iTunes", signal, event => onDiagnostic?.({...event, stage}));
    const {signal: requestSignal, timing, failure} = trace;
    let calls = 0;
    const request = async <T>(nextStage: ItunesStage, url: URL, parse: (value: unknown) => T, cacheable = false): Promise<T> => {
      stage = nextStage;
      try {requestSignal.throwIfAborted();} catch (error) {throw failure(error, "request");}
      const cacheKey = url.href + (nextStage === "artist-albums" ? `|${normalizeMetadata(query.artist)}` : "");
      const stored = cacheable ? this.cache.get(cacheKey) : undefined;
      if (stored && stored.expiresAt > Date.now()) {
        onDiagnostic?.({kind: "cache", stage, ...timing()});
        return structuredClone(stored.value) as T;
      }
      if (++calls > 5) throw new StreamingError("rate-limited", "A busca atingiu o limite de consultas. Refine o artista.");
      const artistId = url.searchParams.get("id");
      onDiagnostic?.({kind: "request", stage, ...trace.requestInfo, at: new Date().toISOString(), endpoint: url.origin + url.pathname,
        query: url.searchParams.get("term") ?? query.artist.trim(), country: "br", ...(artistId ? {artistId} : {})});
      let response: Response;
      try {requestSignal.throwIfAborted(); response = await this.fetcher(url.href, {method: "GET", credentials: "omit", redirect: "error", signal: requestSignal});}
      catch (error) {throw failure(error, "request");}
      onDiagnostic?.({kind: "response", stage, ...timing(), status: response.status, contentType: (response.headers.get("content-type") ?? "").split(";")[0]!.slice(0, 100)});
      if (!response.ok) {
        if (response.status === 429) {
          const header = response.headers.get("Retry-After");
          const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : undefined;
          throw failure(new StreamingError("rate-limited", "O iTunes limitou as consultas. Aguarde antes de tentar novamente.",
            seconds !== undefined && Number.isFinite(seconds) ? Math.max(0, seconds) : undefined), "http", response);
        }
        throw failure(new StreamingError("unavailable", "iTunes indisponível para esta consulta."), "http", response);
      }
      let data: unknown;
      try {data = await response.json(); requestSignal.throwIfAborted();} catch (error) {throw failure(error, "response-body", response);}
      let result: T;
      try {result = parse(data);} catch (error) {throw failure(error, "parse", response);}
      onDiagnostic?.({kind: "results", stage, ...timing(), returned: object(data)["resultCount"] as number,
        incomplete: Boolean(object(result)["incomplete"] || object(result)["complete"] === false)});
      if (cacheable) {
        for (const [key, entry] of this.cache) if (entry.expiresAt <= Date.now()) this.cache.delete(key);
        if (this.cache.size >= cacheEntryLimit) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(cacheKey, {expiresAt: Date.now() + cacheLifetimeMs, value: structuredClone(result)});
      }
      return result;
    };
    const title = albumSearchTitle(query), artistName = normalizeMetadata(query.artist);
    const url = new URL(endpoint);
    url.search = new URLSearchParams({term: `${title} ${query.artist}`.trim(), entity: "album", media: "music", country: "br", limit: String(resultLimit)}).toString();
    let initial: readonly AlbumCandidate[] | AlbumSearchPage;
    try {initial = await request("album-search", url, parseItunesAlbums);}
    catch (error) {if (signal?.aborted) throw new StreamingError("cancelled", "Busca no iTunes cancelada."); throw error;}
    if (signal?.aborted) throw trace.failure(signal.reason, "request");
    const albums = new Map(candidatesFrom(initial).map(album => [album.id, album]));
    if (!artistName || [...albums.values()].some(album => normalizeMetadata(album.title) === normalizeMetadata(title) && album.artists.some(artist => normalizeMetadata(artist.name) === artistName))) return initial;
    onDiagnostic?.({kind: "supplement", ...timing(), state: "started"});
    let incomplete = "candidates" in initial;
    let notice: string | undefined;
    const partial = (message: string): void => {incomplete = true; notice = message;};
    try {
      const identified = new Map<string, ItunesArtist>();
      for (const album of albums.values()) for (const artist of album.artists) if (normalizeMetadata(artist.name) === artistName) identified.set(artist.id, artist);
      if (!identified.size) {
        const artistUrl = new URL(endpoint);
        artistUrl.search = new URLSearchParams({term: query.artist.trim(), entity: "musicArtist", media: "music", country: "br", limit: String(artistLimit)}).toString();
        const found = await request("artist-search", artistUrl, parseArtists, true);
        for (const artist of found.artists) if (normalizeMetadata(artist.name) === artistName) identified.set(artist.id, artist);
        if (found.incomplete) partial("A identificação do artista retornou uma lista parcial. Refine o nome ou confira os resultados disponíveis.");
      }
      if (!identified.size) {
        onDiagnostic?.({kind: "supplement", ...timing(), state: "skipped", reason: "no-artist", artistCount: 0});
      } else if (identified.size > maxArtists) {
        partial("Há vários artistas com esse nome. Refine o artista para completar a busca.");
        onDiagnostic?.({kind: "supplement", ...timing(), state: "partial", reason: "artist-limit", artistCount: identified.size});
      } else {
        if (identified.size > 1) {
          partial("Há artistas com o mesmo nome. Confira o artista e a edição antes de escolher um álbum.");
          onDiagnostic?.({kind: "supplement", ...timing(), state: "partial", reason: "ambiguous-artist", artistCount: identified.size});
        }
        const before = albums.size;
        for (const artist of identified.values()) {
          const lookupUrl = new URL(lookupEndpoint);
          lookupUrl.search = new URLSearchParams({id: artist.id, entity: "album", country: "br", limit: String(resultLimit)}).toString();
          try {
            const found = await request("artist-albums", lookupUrl, value => parseArtistAlbums(value, artist), true);
            for (const album of candidatesFrom(found)) albums.set(album.id, album);
            if ("candidates" in found) incomplete = true;
          } catch (error) {
            if (signal?.aborted || !albums.size) throw error;
            partial("Não foi possível completar a consulta dos álbuns do artista. Confira os resultados disponíveis ou tente novamente.");
            onDiagnostic?.({kind: "supplement", ...timing(), state: "partial", reason: "request-failed", artistCount: identified.size});
            // A transport, timeout or quota failure must not trigger further requests.
            break;
          }
        }
        onDiagnostic?.({kind: "supplement", ...timing(), state: incomplete ? "partial" : "complete", artistCount: identified.size, added: albums.size - before});
      }
    } catch (error) {
      if (signal?.aborted) throw new StreamingError("cancelled", "Busca no iTunes cancelada.");
      if (!albums.size) throw error;
      partial("Não foi possível completar a identificação do artista. Confira os resultados disponíveis ou tente novamente.");
      onDiagnostic?.({kind: "supplement", ...timing(), state: "partial", reason: "request-failed"});
    }
    if (signal?.aborted) throw trace.failure(signal.reason, "request");
    const candidates = [...albums.values()];
    return incomplete ? {candidates, complete: false, ...(notice ? {notice} : {})} : candidates;
  }
}
