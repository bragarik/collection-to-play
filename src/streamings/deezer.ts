import {createRequestDiagnostics, type RequestFailure, type SearchTiming} from "./request-diagnostics.js";
import type {AlbumCandidate, AlbumQuery, AlbumSearchPage, StreamingAdapter} from "../shared/contracts.js";
import {StreamingError} from "../albums/resolution.js";
import {albumSearchTitle} from "../albums/album-search-title.js";

const endpoint = "https://api.deezer.com/search/album";
const limit = 25;
export type DeezerSearchEvent = RequestFailure | (SearchTiming & {readonly kind: "response"; readonly status: number; readonly contentType: string})
  | {readonly kind: "request"; readonly at: string; readonly timeoutMs: number; readonly endpoint: string; readonly query: string; readonly offset: number}
  | (SearchTiming & {readonly kind: "results"; readonly returned: number; readonly incomplete: boolean})
  | (SearchTiming & {readonly kind: "api-error"; readonly code?: number});
function object(value: unknown): Record<string, unknown> {return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};}
function identifier(value: unknown): string | undefined {return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;}
function text(value: unknown): value is string {return typeof value === "string" && Boolean(value.trim());}
function invalid(): never {throw new StreamingError("invalid-response", "O Deezer retornou uma resposta de busca inválida.");}
export function deezerSearchUrl(title: string, artist: string): string {return `https://www.deezer.com/search/${encodeURIComponent(`${title} ${artist}`.trim())}/album`;}
export function isDeezerAlbumUrl(value: string, id: string): boolean {
  try {const url = new URL(value); return /^[1-9]\d{0,15}$/.test(id) && url.origin === "https://www.deezer.com" && !url.username && !url.password && !url.port && !url.hash && !url.search && new RegExp(`^/(?:[a-z]{2}/)?album/${id}/?$`).test(url.pathname);} catch {return false;}
}
export function isDeezerArtwork(value: string): boolean {
  try {const url = new URL(value); return url.origin === "https://cdn-images.dzcdn.net" && !url.username && !url.password && !url.port && !url.hash && url.pathname.startsWith("/images/cover/");} catch {return false;}
}
export function parseDeezerAlbums(value: unknown, term: string, offset = 0): readonly AlbumCandidate[] | AlbumSearchPage {
  const body = object(value), data = body["data"], total = body["total"];
  if (body["error"] !== undefined || !Array.isArray(data) || data.length > limit || typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 || total < offset + data.length) invalid();
  const albums = new Map<string, AlbumCandidate>();
  for (const raw of data) {
    const item = object(raw), artist = object(item["artist"]), id = identifier(item["id"]), artistId = identifier(artist["id"]);
    const title = item["title"], name = artist["name"], url = item["link"];
    if (item["type"] !== "album" || !id || !artistId || !text(title) || !text(name) || !text(url) || !isDeezerAlbumUrl(url, id)) invalid();
    const artworkVariants = ([["small", 56], ["medium", 250], ["big", 500], ["xl", 1000]] as const).flatMap(([key, size]) => {
      const image = item[`cover_${key}`]; return typeof image === "string" && isDeezerArtwork(image) ? [{url: image, width: size, height: size}] : [];
    });
    const artworkUrl = artworkVariants.find(image => image.width === 250)?.url ?? artworkVariants.at(-1)?.url;
    albums.set(id, {service: "deezer", id, title, artists: [{id: artistId, name}], url, ...(artworkUrl ? {artworkUrl, artworkVariants} : {})});
  }
  let nextPage: string | undefined;
  if (body["next"] !== undefined) {
    try {
      if (!text(body["next"])) invalid();
      const next = new URL(body["next"]), index = next.searchParams.get("index");
      if (next.origin !== "https://api.deezer.com" || next.pathname !== "/search/album" || next.username || next.password || next.port || next.hash || next.searchParams.get("q") !== term || !index || !/^\d+$/.test(index) || Number(index) !== offset + data.length || !data.length || Number(index) > 100000 || Number(index) >= total ||
        [...next.searchParams.keys()].some(key => !["q", "index", "limit"].includes(key) || next.searchParams.getAll(key).length !== 1) || (next.searchParams.has("limit") && next.searchParams.get("limit") !== String(limit))) invalid();
      nextPage = JSON.stringify([1, term, Number(index)]);
    } catch {invalid();}
  }
  const candidates = [...albums.values()];
  return nextPage || total > offset + data.length ? {candidates, complete: false, ...(nextPage ? {nextPage} : {})} : candidates;
}
export class DeezerClient implements StreamingAdapter {
  readonly id = "deezer" as const;
  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}
  async search(query: AlbumQuery, signal?: AbortSignal, cursor?: string, onDiagnostic?: (event: DeezerSearchEvent) => void): Promise<readonly AlbumCandidate[] | AlbumSearchPage> {
    if (!query.title.trim() || query.title.length > 200 || query.artist.length > 200) throw new StreamingError("invalid-query", "Informe um álbum válido para buscar no Deezer.");
    const term = `${albumSearchTitle(query)} ${query.artist}`.trim();
    let offset = 0;
    if (cursor !== undefined) {
      try {const value: unknown = JSON.parse(cursor); if (cursor.length > 8192 || !Array.isArray(value) || value.length !== 3 || value[0] !== 1 || value[1] !== term || !Number.isSafeInteger(value[2]) || value[2] <= 0 || value[2] > 100000) throw Error(); offset = value[2] as number;}
      catch {throw new StreamingError("invalid-query", "Continuação inválida. Faça uma nova busca.");}
    }
    const trace = createRequestDiagnostics("Deezer", signal, onDiagnostic), url = new URL(endpoint);
    url.search = new URLSearchParams({q: term, limit: String(limit), index: String(offset)}).toString();
    onDiagnostic?.({kind: "request", ...trace.requestInfo, endpoint, query: term, offset});
    let response: Response;
    try {trace.signal.throwIfAborted(); response = await this.fetcher(url.href, {method: "GET", credentials: "omit", redirect: "error", signal: trace.signal});}
    catch (error) {throw trace.failure(error, "request");}
    onDiagnostic?.({kind: "response", ...trace.timing(), status: response.status, contentType: (response.headers.get("content-type") ?? "").split(";")[0]!.slice(0, 100)});
    if (!response.ok) {
      const retry = response.headers.get("Retry-After");
      throw trace.failure(new StreamingError(response.status === 429 ? "rate-limited" : "unavailable", response.status === 429 ? "O Deezer limitou as consultas. Aguarde antes de tentar novamente." : "Deezer indisponível para esta consulta.", retry && /^\d+$/.test(retry) ? Number(retry) : undefined), "http", response);
    }
    let data: unknown;
    try {data = await response.json(); trace.signal.throwIfAborted();} catch (error) {throw trace.failure(error, "response-body", response);}
    let result: readonly AlbumCandidate[] | AlbumSearchPage;
    try {
      const body = object(data);
      if (body["error"] !== undefined) {
        const code = object(body["error"])["code"];
        onDiagnostic?.({kind: "api-error", ...trace.timing(), ...(typeof code === "number" && Number.isSafeInteger(code) ? {code} : {})});
        throw new StreamingError(code === 4 ? "rate-limited" : "unavailable", code === 4 ? "O Deezer limitou as consultas. Aguarde antes de tentar novamente." : "O Deezer não conseguiu concluir esta consulta. Tente novamente.");
      }
      result = parseDeezerAlbums(data, term, offset);
    } catch (error) {throw trace.failure(error, "parse", response);}
    onDiagnostic?.({kind: "results", ...trace.timing(), returned: (object(data)["data"] as unknown[]).length, incomplete: !Array.isArray(result)});
    return result;
  }
}
