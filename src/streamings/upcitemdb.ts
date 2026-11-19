import {normalizeProductCode, productCodesMatch} from "../albums/identifiers.js";
import {StreamingError} from "../albums/resolution.js";
import {createRequestDiagnostics, type RequestFailure, type SearchTiming} from "./request-diagnostics.js";

export interface UpcitemdbProduct {
  readonly id: string;
  readonly title: string;
  readonly ean: string;
  readonly upc?: string;
  readonly description?: string;
  readonly brand?: string;
  readonly model?: string;
  readonly category?: string;
  readonly images: readonly string[];
  readonly media: "music" | "movie" | "unknown";
  readonly unrelated: boolean;
}
export interface UpcitemdbQuery {
  readonly title: string;
  readonly artist?: string;
  readonly barcode?: string;
  readonly media: "music" | "movie";
  readonly nextPage?: string;
}
export interface UpcitemdbPage {
  readonly products: readonly UpcitemdbProduct[];
  readonly total: number;
  readonly mode: "barcode" | "title";
  readonly nextPage?: string;
}
interface ProductPage {products: UpcitemdbProduct[]; total: number; offset: number}
type Method = "lookup" | "search";
export type UpcitemdbDiagnostic = RequestFailure | (SearchTiming & (
  {readonly kind: "request"; readonly method: Method} |
  {readonly kind: "cache"; readonly method: Method} |
  {readonly kind: "waiting"; readonly method: Method; readonly waitMs: number} |
  {readonly kind: "blocked"; readonly method: Method; readonly code: "rate-limited"; readonly retryAfterSeconds: number} |
  {readonly kind: "response"; readonly method: Method; readonly status: number; readonly remaining?: number} |
  {readonly kind: "results"; readonly method: Method; readonly returned: number}));
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, maximum: number): string => typeof value === "string" && value.length <= maximum ? value.trim() : "";
const invalid = (): never => {throw new StreamingError("invalid-response", "O UPCitemdb retornou dados inválidos.");};
const dayMs = 86_400_000;
const normalized = (value: string): string => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function isUpcitemdbImageUrl(value: string): boolean {
  if (value.length > 4000) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/\.$/, "");
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash &&
      hostname.includes(".") && !hostname.endsWith(".local") && !hostname.endsWith(".localhost") &&
      hostname !== "discogs.com" && !hostname.endsWith(".discogs.com") &&
      !/^[\d.]+$/.test(hostname) && !hostname.includes(":") &&
      ![...url.searchParams.keys()].some(key => /^(?:token|key|api_key|authorization|access_token)$/i.test(key));
  } catch {return false;}
}

export function parseUpcitemdbResponse(value: unknown, requestedOffset = 0): ProductPage {
  if (!Number.isInteger(requestedOffset) || requestedOffset < 0 || requestedOffset >= 1000) invalid();
  const body = object(value);
  if (body["code"] === "NOT_FOUND") return {products: [], total: 0, offset: 0};
  if (body["code"] !== "OK" || !Array.isArray(body["items"]) || body["items"].length > 10 ||
    !Number.isSafeInteger(body["total"]) || Number(body["total"]) < 0 ||
    !Number.isInteger(body["offset"]) || Number(body["offset"]) < 0 || Number(body["offset"]) > 1000 ||
    Number(body["total"]) < requestedOffset + body["items"].length ||
    Number(body["offset"]) !== 0 && (Number(body["offset"]) < requestedOffset + body["items"].length ||
      Number(body["offset"]) <= requestedOffset || Number(body["offset"]) >= Number(body["total"]))) invalid();
  const products = new Map<string, UpcitemdbProduct>();
  for (const raw of body["items"] as unknown[]) {
    const item = object(raw), title = text(item["title"], 512);
    const ean = normalizeProductCode(text(item["ean"], 32));
    const upc = normalizeProductCode(text(item["upc"], 32));
    const code = ean?.length === 13 ? ean : upc?.length === 12 ? `0${upc}` : undefined;
    if (!title || !code || upc && (!productCodesMatch(code, upc) || upc.length !== 12)) continue;
    const category = text(item["category"], 1000), words = normalized(title), taxonomy = normalized(category);
    const video = /\b(?:dvd|blu[ -]?ray|vhs|laserdisc)\b/.test(words);
    const music = /\b(?:cd|vinyl|lp|sacd)\b/.test(words);
    const media = video ? "movie" : music || /music & sound recordings|music recordings/.test(taxonomy) ? "music"
      : /movies|films|television/.test(taxonomy) ? "movie" : "unknown";
    const images = Array.isArray(item["images"]) ? [...new Set(item["images"].slice(0, 20)
      .map(image => text(image, 4000)).filter(image => image && isUpcitemdbImageUrl(image)))].slice(0, 8) : [];
    products.set(code, {id: code, title, ean: code, ...(upc ? {upc} : {}), images, media,
      unrelated: !video && !music && /^(?:apparel|animals|baby|furniture|food|hardware|home & garden|health & beauty)|\bbooks\b/.test(taxonomy),
      ...Object.fromEntries(["description", "brand", "model", "category"].flatMap(field => {
        const value = text(item[field], field === "description" ? 5000 : 1000);
        return value ? [[field, value]] : [];
      }))});
  }
  return {products: [...products.values()], total: Number(body["total"]), offset: Number(body["offset"])};
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {reject(new StreamingError("cancelled", "Busca no UPCitemdb cancelada.")); return;}
    const abort = () => {clearTimeout(timer); reject(new StreamingError("cancelled", "Busca no UPCitemdb cancelada."));};
    const timer = setTimeout(() => {signal?.removeEventListener("abort", abort); resolve();}, ms);
    signal?.addEventListener("abort", abort, {once: true});
  });
}

export class UpcitemdbClient {
  private queue: Promise<void> = Promise.resolve();
  private readonly cache = new Map<string, {expires: number; page: ProductPage}>();
  private lastRequest: number | undefined;
  private lastSearch: number | undefined;
  private blockedUntil = 0;
  private quotaDay = -1;
  private dailyRequests = 0;
  private dailySearches = 0;
  constructor(private readonly options: {
    fetch?: typeof fetch;
    now?(): number;
    sleep?(ms: number, signal?: AbortSignal): Promise<void>;
    diagnostic?(event: UpcitemdbDiagnostic): void;
  } = {}) {}
  private now(): number {return this.options.now?.() ?? Date.now();}
  private active(signal?: AbortSignal): void {
    if (signal?.aborted) throw new StreamingError("cancelled", "Busca no UPCitemdb cancelada.");
  }
  private quota(method: Method): void {
    const now = this.now(), day = Math.floor(now / dayMs);
    if (day !== this.quotaDay) {this.quotaDay = day; this.dailyRequests = 0; this.dailySearches = 0;}
    const until = Math.max(this.blockedUntil, this.dailyRequests >= 100 || method === "search" && this.dailySearches >= 20 ? (day + 1) * dayMs : 0);
    if (until > now) {
      const retryAfterSeconds = Math.ceil((until - now) / 1000);
      this.emit({kind: "blocked", method, code: "rate-limited", retryAfterSeconds, at: new Date(now).toISOString(), durationMs: 0});
      throw new StreamingError("rate-limited", "O UPCitemdb atingiu o limite de consultas. Aguarde antes de tentar novamente.", retryAfterSeconds);
    }
  }
  private emit(event: UpcitemdbDiagnostic): void {try {this.options.diagnostic?.(event);} catch { /* Diagnostics must not break a request. */ }}
  private request(method: Method, params: Record<string, string>, signal?: AbortSignal): Promise<ProductPage> {
    const operation = this.queue.then(async () => {
      this.active(signal);
      const key = JSON.stringify([method, params]), started = this.now();
      const timing = () => ({at: new Date(this.now()).toISOString(), durationMs: Math.max(0, this.now() - started)});
      const cached = this.cache.get(key);
      if (cached && cached.expires > this.now()) {
        this.emit({kind: "cache", method, ...timing()});return structuredClone(cached.page);
      }
      this.quota(method);
      const waitMs = Math.max(0, (this.lastRequest ?? -Infinity) + 10_000 - this.now(),
        method === "search" ? (this.lastSearch ?? -Infinity) + 15_000 - this.now() : 0);
      if (waitMs) {
        this.emit({kind: "waiting", method, waitMs, ...timing()});
        await (this.options.sleep ?? delay)(waitMs, signal);
      }
      this.active(signal);this.quota(method);
      this.lastRequest = this.now();this.dailyRequests++;
      if (method === "search") {this.lastSearch = this.now();this.dailySearches++;}
      const trace = createRequestDiagnostics("UPCitemdb", signal, event => this.emit(event));
      let phase: "request" | "http" | "response-body" | "parse" = "request";
      let response: Response | undefined;
      try {
        const url = new URL(`https://api.upcitemdb.com/prod/trial/${method}`);
        url.search = new URLSearchParams(params).toString();
        this.emit({kind: "request", method, ...timing()});
        response = await (this.options.fetch ?? fetch)(url.href, {headers: {Accept: "application/json"},
          credentials: "omit", redirect: "error", signal: trace.signal});
        phase = "http";
        const rawRemaining = response.headers.get("x-ratelimit-remaining");
        const remaining = rawRemaining && /^\d+$/.test(rawRemaining) ? Number(rawRemaining) : undefined;
        const retry = response.headers.get("retry-after");
        const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
        if (response.status === 429 || remaining === 0) {
          const retryAt = retry && /^\d+$/.test(retry) ? this.now() + Number(retry) * 1000 : Date.parse(retry ?? "");
          this.blockedUntil = Math.max(this.blockedUntil, retryAt > this.now() ? retryAt : 0, reset > this.now() ? reset : 0, this.now() + 1000);
          if (!(retryAt > this.now()) && !(reset > this.now())) this.blockedUntil = Math.max(this.blockedUntil, this.now() + 60_000);
        }
        this.emit({kind: "response", method, status: response.status, ...(remaining !== undefined ? {remaining} : {}), ...timing()});
        if (response.status === 429) this.quota(method);
        if (!response.ok && response.status !== 404) throw new StreamingError("unavailable", `O UPCitemdb retornou HTTP ${response.status}.`);
        phase = "response-body";
        const raw = await response.text();trace.signal.throwIfAborted();
        if (raw.length > 2_000_000) invalid();
        const value: unknown = JSON.parse(raw);
        phase = "parse";
        if (["TOO_FAST", "EXCEED_LIMIT"].includes(String(object(value)["code"]))) {
          this.blockedUntil = Math.max(this.blockedUntil, this.now() + 60_000);this.quota(method);
        }
        if (!response.ok && object(value)["code"] !== "NOT_FOUND") invalid();
        const page = parseUpcitemdbResponse(value, Number(params["offset"] ?? 0));
        this.cache.delete(key);
        if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, {expires: this.now() + 300_000, page: structuredClone(page)});
        this.emit({kind: "results", method, returned: page.products.length, ...timing()});
        return page;
      } catch (error) {throw trace.failure(error, phase, response);}
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  async search(query: UpcitemdbQuery, signal?: AbortSignal): Promise<UpcitemdbPage> {
    if (typeof query?.title !== "string" || query.title.length > 512 || query.artist !== undefined && (typeof query.artist !== "string" || query.artist.length > 200) ||
      !["music", "movie"].includes(query.media) || query.barcode !== undefined && (typeof query.barcode !== "string" || query.barcode.length > 32)) {
      throw new StreamingError("invalid-query", "Confira título, artista e código da busca UPCitemdb.");
    }
    const barcode = normalizeProductCode(query.barcode), term = `${query.title.trim()} ${query.artist?.trim() ?? ""}`.trim();
    if (query.barcode && !barcode || !barcode && !term || term.length > 512) throw new StreamingError("invalid-query", "Informe título ou EAN/UPC válido para o UPCitemdb.");
    const signature = JSON.stringify([term, barcode ?? "", query.media]);
    let offset = 0;
    if (query.nextPage !== undefined) {
      try {
        if (typeof query.nextPage !== "string" || query.nextPage.length > 4000) throw Error();
        const cursor: unknown = JSON.parse(query.nextPage);
        if (!Array.isArray(cursor) || cursor.length !== 3 || cursor[0] !== 1 || cursor[1] !== signature ||
          !Number.isInteger(cursor[2]) || cursor[2] < 1 || cursor[2] >= 1000 || !term) throw Error();
        offset = cursor[2] as number;
      } catch {throw new StreamingError("invalid-query", "Esta página não pertence à busca UPCitemdb atual.");}
    }
    if (barcode && !offset) {
      const page = await this.request("lookup", {upc: barcode}, signal);
      const products = page.products.filter(product => productCodesMatch(product.ean, barcode));
      if (products.length || !term) return {products, total: products.length, mode: "barcode"};
    }
    const page = await this.request("search", {s: term, ...(offset ? {offset: String(offset)} : {})}, signal);
    const products = page.products.filter(product => !product.unrelated);
    const words = normalized(term).split(/\s+/).filter(Boolean);
    const score = (product: UpcitemdbProduct) => words.filter(word => normalized(product.title).includes(word)).length * 10 + Number(product.media === query.media);
    products.sort((a, b) => score(b) - score(a));
    return {products, total: page.total, mode: "title", ...(page.offset > 0 && page.offset < 1000 ? {nextPage: JSON.stringify([1, signature, page.offset])} : {})};
  }
}
