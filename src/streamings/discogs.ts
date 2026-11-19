import {normalizeProductCode, productCodesMatch} from "../albums/identifiers.js";
import {StreamingError} from "../albums/resolution.js";
import type {AlbumCandidate} from "../shared/contracts.js";

export interface DiscogsRelease {
  detailsLoaded?: boolean;
  id: string;
  title: string;
  artists: string[];
  country?: string | undefined;
  released?: string | undefined;
  formats: string[];
  labels: string[];
  catalogNumbers: string[];
  barcodes: string[];
  batchIds?: string[];
  genres: string[];
  releaseNotes?: string;
  discCount?: number;
  directors: string[];
  tracks: {title: string; number?: number; durationMs?: number}[];
}
export interface DiscogsSearch {
  title: string;
  artist?: string;
  barcode?: string;
  media: "music" | "movie";
  page?: number;
  mode?: "barcode" | "title";
}
export interface DiscogsSearchPage {
  candidates: AlbumCandidate[];
  page: number;
  pages: number;
  mode: "barcode" | "title";
}
export interface DiscogsDiagnostic {
  at: string;
  stage: "search" | "release";
  durationMs: number;
  status?: number | undefined;
  outcome: string;
  count?: number | undefined;
  page?: number;
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown, max = 1000): string =>
  typeof value === "string" && value.length <= max ? value.trim() : "";
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const strings = (value: unknown): string[] => list(value).slice(0, 100).map(item => string(item)).filter(Boolean);
export function isDiscogsSearchThumbnailUrl(value: string): boolean {
  if (value.length > 4000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["i.discogs.com", "img.discogs.com"].includes(url.hostname) &&
      !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname !== "/";
  } catch {return false;}
}
export function isDiscogsReleaseUrl(value: string, id: string): boolean {
  if (!/^[1-9]\d{0,14}$/.test(id)) return false;
  try {
    const url = new URL(value);
    return url.origin === "https://www.discogs.com" && !url.username && !url.password && !url.search && !url.hash &&
      new RegExp(`^/release/${id}(?:-[^/]+)?/?$`).test(url.pathname);
  } catch {return false;}
}
export function discogsCandidate(release: DiscogsRelease): AlbumCandidate {
  return {service: "discogs", id: release.id, title: release.title, url: `https://www.discogs.com/release/${release.id}`,
    artists: release.artists.map((name, index) => ({id: String(index + 1), name})),
    ...(release.released ? {releaseDate: release.released} : {}),
    ...Object.fromEntries(release.barcodes.map(code => [code.length === 13 ? "ean" : "upc", code])),
    discogs: release};
}
export function parseDiscogsRelease(value: unknown, expectedId: string): DiscogsRelease {
  const data = object(value);
  const title = string(data["title"]);
  const artists = list(data["artists"]).map(item => string(object(item)["name"])).filter(Boolean);
  if (String(data["id"]) !== expectedId || !/^[1-9]\d{0,14}$/.test(expectedId) || !title || !artists.length) {
    throw new StreamingError("invalid-response", "O Discogs retornou uma edição inválida.");
  }
  const formats = list(data["formats"]).slice(0, 50);
  const labels = list(data["labels"]).slice(0, 50);
  const barcodeValues = list(data["identifiers"]).filter(item => object(item)["type"] === "Barcode")
    .map(item => string(object(item)["value"])).filter(code => /^[\d\s-]+$/.test(code))
    .map(normalizeProductCode).filter((code): code is string => Boolean(code));
  const tracks: DiscogsRelease["tracks"] = [];
  function addTracks(items: unknown[], depth: number) {
    for (const raw of items.slice(0, 1000)) {
      const item = object(raw);
      if (item["type_"] === "heading") continue;
      if (Array.isArray(item["sub_tracks"]) && depth < 3) {addTracks(item["sub_tracks"], depth + 1); continue;}
      const name = string(item["title"]);
      if (!name || tracks.length >= 1000) continue;
      const duration = string(item["duration"]).match(/^(?:(\d+):)?(\d+):([0-5]\d)$/);
      const seconds = duration && (!duration[1] || Number(duration[2]) < 60)
        ? Number(duration[1] ?? 0) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : undefined;
      tracks.push({title: name, number: tracks.length + 1, ...(seconds ? {durationMs: seconds * 1000} : {})});
    }
  }
  addTracks(list(data["tracklist"]), 0);
  const discFormats = formats.filter(item => /^(CD|DVD|Blu-ray|Vinyl|SACD|HD DVD)$/i.test(string(object(item)["name"])));
  const quantities = discFormats.map(item => Number(object(item)["qty"]));
  const count = quantities.length && quantities.every(number => Number.isSafeInteger(number) && number > 0)
    ? quantities.reduce((total, number) => total + number, 0) : undefined;
  const release = string(data["released"]) || (Number.isInteger(data["year"]) && Number(data["year"]) > 0 ? String(data["year"]) : "");
  const released = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(release) && release.slice(0, 4) !== "0000"
    ? release.replace(/-00-00$/, "").replace(/-00$/, "") : undefined;
  return {detailsLoaded: true, id: expectedId, title, artists, country: string(data["country"]) || undefined, released,
    formats: formats.map(item => [string(object(item)["name"]), ...strings(object(item)["descriptions"])].filter(Boolean).join(", ")),
    labels: labels.map(item => string(object(item)["name"])).filter(Boolean),
    catalogNumbers: labels.map(item => string(object(item)["catno"])).filter(Boolean),
    barcodes: [...new Set(barcodeValues)],
    batchIds: [...new Set(list(data["identifiers"]).slice(0, 500)
      .filter(item => object(item)["type"] === "Other" && /^Batch ID(?:\s*\[[^\]]+\])?$/i.test(string(object(item)["description"])))
      .map(item => string(object(item)["value"])).filter(Boolean))],
    genres: [...new Set([...strings(data["genres"]), ...strings(data["styles"])])],
    ...(string(data["notes"], 200_000) ? {releaseNotes: data["notes"] as string} : {}),
    ...(count ? {discCount: count} : {}),
    directors: list(data["extraartists"]).filter(item => /^(Film Director|Video Director)$/i.test(string(object(item)["role"])))
      .map(item => string(object(item)["name"])).filter(Boolean), tracks};
}
export class DiscogsClient {
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;
  private minimumSpacing = 1100;
  private blockedUntil = 0;
  private readonly releases = new Map<string, {expires: number; release: DiscogsRelease}>();
  private readonly pendingReleases = new Map<string, Promise<DiscogsRelease>>();
  constructor(private readonly options: {
    token(): Promise<string | undefined>;
    fetch?: typeof fetch;
    spacingMs?: number;
    diagnostic?(event: DiscogsDiagnostic): void;
  }) {}
  private request(path: string, params: Record<string, string>, stage: "search" | "release"): Promise<unknown> {
    const operation = this.queue.catch(() => {}).then(async () => {
      const token = await this.options.token();
      if (!token) throw new StreamingError("authentication-required", "Configure seu token pessoal do Discogs.");
      if (Date.now() < this.blockedUntil) throw new StreamingError("rate-limited", "O Discogs limitou as consultas. Aguarde antes de tentar novamente.");
      const wait = (this.options.spacingMs ?? this.minimumSpacing) - (Date.now() - this.lastRequest);
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      this.lastRequest = Date.now();
      const started = Date.now();
      let status: number | undefined;
      let count: number | undefined;
      let outcome = "network";
      try {
        const url = new URL("https://api.discogs.com/" + path);
        url.search = new URLSearchParams(params).toString();
        const response = await (this.options.fetch ?? fetch)(url.href, {headers: {Authorization: `Discogs token=${token}`,
          "User-Agent": "CollectionToPlay (https://github.com/bragarik/collection-to-play)"}, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(20000)});
        status = response.status;
        const rate = Number(response.headers.get("x-discogs-ratelimit"));
        if (Number.isFinite(rate) && rate > 0) this.minimumSpacing = Math.max(1100, Math.ceil(60000 / rate));
        if (status === 429) {
          const retry = response.headers.get("retry-after");
          const seconds = Number(retry);
          const until = retry && Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000 : Date.parse(retry ?? "");
          this.blockedUntil = Number.isFinite(until) ? Math.max(Date.now() + 1000, until) : Date.now() + 60000;
        }
        outcome = "http-error";
        if (!response.ok) throw new StreamingError(status === 401 || status === 403 ? "authentication-required"
          : status === 429 ? "rate-limited" : "unavailable", status === 401 || status === 403
            ? "O Discogs recusou a credencial. Confira o token pessoal." : status === 429
              ? "O Discogs limitou as consultas. Aguarde e tente novamente." : `O Discogs retornou HTTP ${status}.`);
        outcome = "invalid-response";
        const raw = await response.text();
        if (raw.length > 2_000_000) throw new Error();
        const data: unknown = JSON.parse(raw);
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
        count = Array.isArray(object(data)["results"]) ? (object(data)["results"] as unknown[]).length : undefined;
        outcome = "success";
        return data;
      } catch (error) {
        if (error instanceof StreamingError) throw error;
        throw new StreamingError("unavailable", outcome === "invalid-response" ? "O Discogs retornou uma resposta inválida." : "Não foi possível consultar o Discogs. Tente novamente.");
      } finally {
        this.options.diagnostic?.({at: new Date().toISOString(), stage, durationMs: Date.now() - started, status, outcome, count,
          ...(params["page"] ? {page: Number(params["page"])} : {})});
      }
    });
    this.queue = operation;
    return operation;
  }
  async release(id: string): Promise<DiscogsRelease> {
    if (!/^[1-9]\d{0,14}$/.test(id)) throw new StreamingError("invalid-query", "Edição Discogs inválida.");
    const cached = this.releases.get(id);
    if (cached && cached.expires > Date.now()) return cached.release;
    const pending = this.pendingReleases.get(id);
    if (pending) return pending;
    const operation = this.request(`releases/${id}`, {}, "release").then(raw => {
      const release = parseDiscogsRelease(raw, id);
      this.releases.delete(id);
      if (this.releases.size >= 64) this.releases.delete(this.releases.keys().next().value!);
      this.releases.set(id, {expires: Date.now() + 5 * 60_000, release});
      return release;
    }).finally(() => this.pendingReleases.delete(id));
    this.pendingReleases.set(id, operation);
    return operation;
  }
  async search(query: DiscogsSearch): Promise<DiscogsSearchPage> {
    if (typeof query.title !== "string" || query.title.length > 512 || (query.artist?.length ?? 0) > 200 ||
      !["music", "movie"].includes(query.media) || query.mode !== undefined && !["barcode", "title"].includes(query.mode) || query.page !== undefined && (!Number.isInteger(query.page) || query.page < 1 || query.page > 100)) {
      throw new StreamingError("invalid-query", "Confira título, artista e código da busca Discogs.");
    }
    if (query.barcode !== undefined && (typeof query.barcode !== "string" || query.barcode.length > 32)) throw new StreamingError("invalid-query", "Código de barras inválido.");
    const barcode = query.barcode ? normalizeProductCode(query.barcode) : undefined;
    if (query.barcode && !barcode) throw new StreamingError("invalid-query", "Informe um EAN ou UPC válido.");
    if (!barcode && !query.title.trim()) throw new StreamingError("invalid-query", "Informe título ou código de barras.");
    let mode = query.mode ?? (barcode ? "barcode" : "title");
    const page = query.page ?? 1;
    const load = async () => {
      const data = object(await this.request("database/search", {type: "release", page: String(page), per_page: "25",
        ...(mode === "barcode" && barcode ? {barcode} : query.artist?.trim() ? {release_title: query.title.trim(), artist: query.artist.trim()} : {q: query.title.trim()})}, "search"));
      if (!Array.isArray(data["results"]) || !Number.isInteger(object(data["pagination"])["pages"])) {
        throw new StreamingError("invalid-response", "O Discogs retornou resultados inválidos.");
      }
      return data;
    };
    let data = await load();
    if (mode === "barcode" && !list(data["results"]).length && page === 1 && query.title.trim()) {mode = "title"; data = await load();}
    const candidates = list(data["results"]).slice(0, 25).flatMap(raw => {
      const result = object(raw), id = String(result["id"]), title = string(result["title"]);
      if (result["type"] !== "release" || !/^[1-9]\d{0,14}$/.test(id) || !title) return [];
      const formats = strings(result["format"]);
      const video = formats.some(format => /DVD|Blu-ray|VHS|Laserdisc|Video/i.test(format));
      if (query.media === "movie" && !video) return [];
      const codes = strings(result["barcode"]).map(normalizeProductCode).filter((code): code is string => Boolean(code));
      if (mode === "barcode" && barcode && !codes.some(code => productCodesMatch(code, barcode))) return [];
      const split = title.indexOf(" - ");
      const artist = split > 0 ? title.slice(0, split) : query.artist?.trim();
      if (!artist) return [];
      const release: DiscogsRelease = {id, title: split > 0 ? title.slice(split + 3) : title, artists: [artist],
        country: string(result["country"]) || undefined, released: Number(result["year"]) > 0 ? String(result["year"]) : undefined,
        formats, labels: strings(result["label"]), catalogNumbers: [string(result["catno"])].filter(Boolean),
        barcodes: codes, genres: strings(result["genre"]), directors: [], tracks: []};
      const thumbnail = string(result["thumb"], 4000);
      return [{...discogsCandidate(release), ...(isDiscogsSearchThumbnailUrl(thumbnail) ? {searchThumbnailUrl: thumbnail} : {})}];
    });
    return {candidates, page, pages: Math.min(Number(object(data["pagination"])["pages"]), 100), mode};
  }
}
