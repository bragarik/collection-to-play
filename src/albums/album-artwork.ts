import {isLastfmSourceId} from "../streamings/lastfm.js";
import {isMetadataService, isMetadataAlbumId} from "../streamings/metadata-search.js";
import {browserErrorDetails, type BrowserErrorDetails} from "../streamings/request-diagnostics.js";
import type {AlbumArtworkVariant, MetadataServiceId, StreamingId} from "../shared/contracts.js";

export const ARTWORK_BYTE_LIMIT = 20_000_000;
const mimeTypes = {jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp"} as const;
type ImageFormat = keyof typeof mimeTypes;
type ArtworkErrorCode = "invalid-input" | "unavailable" | "too-large" | "unsupported-format" | "invalid-image" | "network" | "cancelled" | "timeout";
export interface ArtworkDiagnosticEvent {
  readonly kind: "request" | "response" | "decoded" | "failure" | "selected";
  readonly at: string;
  readonly durationMs: number;
  readonly timeoutMs: number;
  readonly url: string;
  readonly attempt: number;
  readonly phase: "request" | "response-body" | "format" | "decode" | "selection";
  readonly status?: number;
  readonly contentType?: string;
  readonly byteLength?: number;
  readonly width?: number;
  readonly height?: number;
  readonly code?: ArtworkErrorCode;
  readonly hasHttpResponse?: boolean;
  readonly aborted?: boolean;
  readonly callerAborted?: boolean;
  readonly browserError?: BrowserErrorDetails;
}
const messages: Record<ArtworkErrorCode, string> = {
  "invalid-input": "Selecione um álbum e uma capa válidos.", unavailable: "Nenhuma capa disponível para este álbum.",
  "too-large": "A capa excede o limite de 20 MB.", "unsupported-format": "A capa precisa ser JPEG, PNG, GIF ou WebP.",
  "invalid-image": "O arquivo da capa não é uma imagem válida.", network: "Não foi possível obter a capa do streaming.",
  cancelled: "A obtenção da capa foi cancelada.", timeout: "O streaming demorou para fornecer a capa.",
};
export class ArtworkError extends Error {
  constructor(readonly code: ArtworkErrorCode) {super(messages[code]); this.name = "ArtworkError";}
}
export function isArtworkError(value: unknown): value is ArtworkError {
  return value instanceof Error && value.name === "ArtworkError" && "code" in value &&
    typeof value.code === "string" && Object.hasOwn(messages, value.code);
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function isAlbumArtworkUrl(service: unknown, value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.pathname === "/") return false;
    return service === "lastfm" ? ["lastfm.freetls.fastly.net", "lastfm-img2.akamaized.net"].includes(url.hostname) && url.pathname.startsWith("/i/u/") :
      service === "spotify" ? url.hostname === "i.scdn.co" && /^\/image\/[\w-]+$/.test(url.pathname) :
      service === "deezer" ? url.hostname === "cdn-images.dzcdn.net" && url.pathname.startsWith("/images/cover/") :
      service === "apple-music" ? url.hostname.endsWith(".mzstatic.com") && url.pathname.startsWith("/image/") :
      service === "youtube-music" && ["lh3.googleusercontent.com", "yt3.googleusercontent.com", "i.ytimg.com"].includes(url.hostname);
  } catch {return false;}
}
export type ArtworkServiceId = MetadataServiceId | "lastfm";
export interface ArtworkInput {readonly service: StreamingId | "lastfm";readonly id: string;readonly artworkUrl?: string;readonly artworkVariants?: readonly AlbumArtworkVariant[]}
export function albumArtworkVariants(service: ArtworkServiceId, value: unknown): readonly AlbumArtworkVariant[] {
  if (!Array.isArray(value)) return [];
  const variants = new Map<string, AlbumArtworkVariant>();
  for (const raw of value) {
    const item = object(raw);
    if (!isAlbumArtworkUrl(service, item["url"])) continue;
    const size = (name: string): number | undefined => typeof item[name] === "number" && Number.isSafeInteger(item[name]) && item[name] > 0 ? item[name] : undefined;
    const width = size("width"), height = size("height");
    variants.set(item["url"], {url: item["url"], ...(width ? {width} : {}), ...(height ? {height} : {})});
  }
  return [...variants.values()];
}
function originalYouTubeUrl(value: string): string | undefined {
  const url = new URL(value);
  if (!["lh3.googleusercontent.com", "yt3.googleusercontent.com"].includes(url.hostname) || url.search) return undefined;
  const path = url.pathname.replace(/=(?:w\d+(?:-h\d+)?|s\d+)(?:-[\w]+)*$/, "=s0");
  if (path === url.pathname) return undefined;
  url.pathname = path; return url.href;
}
export interface AlbumArtworkFile {
  readonly service: ArtworkServiceId;
  readonly albumId: string;
  readonly sourceUrl: string;
  readonly format: ImageFormat;
  readonly mimeType: typeof mimeTypes[ImageFormat];
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly dataBase64: string;
  readonly warnings: readonly ("low-resolution" | "unavailable-variants")[];
}
export function imageFormat(bytes: Uint8Array): ImageFormat {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  const prefix = (offset: number, text: string): boolean => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "png";
  if (prefix(0, "GIF87a") || prefix(0, "GIF89a")) return "gif";
  if (prefix(0, "RIFF") && prefix(8, "WEBP")) return "webp";
  throw new ArtworkError("unsupported-format");
}
async function limitedBody(response: Response): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > ARTWORK_BYTE_LIMIT) {
    void response.body?.cancel().catch(() => undefined); throw new ArtworkError("too-large");
  }
  if (!response.body) throw new ArtworkError("invalid-image");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > ARTWORK_BYTE_LIMIT) throw new ArtworkError("too-large");
      chunks.push(value);
    }
  } catch (error) {void reader.cancel().catch(() => undefined); throw error;}
  finally {reader.releaseLock();}
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  return bytes;
}
function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 32768) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32768)));
  return btoa(chunks.join(""));
}

/** Retrieves public image bytes only; never touches the catalog, authentication or composition state. */
export async function fetchAlbumArtwork(value: unknown, environment: {
  readonly fetch?: typeof fetch;
  readonly decode?: (blob: Blob) => Promise<{readonly width: number; readonly height: number; close(): void}>;
  readonly signal?: AbortSignal;
  readonly onDiagnostic?: (event: ArtworkDiagnosticEvent) => void;
} = {}): Promise<AlbumArtworkFile> {
  const album = object(value), service = album["service"] as ArtworkServiceId, id = album["id"] as string;
  if (service === "lastfm" ? !isLastfmSourceId(id) : !isMetadataService(service) || !isMetadataAlbumId(service, id)) throw new ArtworkError("invalid-input");
  const variants = albumArtworkVariants(service, album["artworkVariants"]);
  const urls = new Set(variants.map(variant => variant.url));
  if (isAlbumArtworkUrl(service, album["artworkUrl"])) urls.add(album["artworkUrl"]);
  if (service === "youtube-music") for (const url of [...urls]) {const original = originalYouTubeUrl(url); if (original) urls.add(original);}
  if (!urls.size) throw new ArtworkError("unavailable");
  const timeout = AbortSignal.timeout(20_000);
  const signal = environment.signal ? AbortSignal.any([environment.signal, timeout]) : timeout;
  const started = performance.now();
  const emit = (event: Omit<ArtworkDiagnosticEvent, "at" | "durationMs" | "timeoutMs">): void => {
    // A public image URL may include a signed query; do not persist it.
    const url = new URL(event.url);
    environment.onDiagnostic?.({...event, url: url.origin + url.pathname, at: new Date().toISOString(),
      durationMs: Math.max(0, Math.round(performance.now() - started)), timeoutMs: 20000});
  };
  const fetcher = environment.fetch ?? fetch;
  const decode = environment.decode ?? (blob => createImageBitmap(blob));
  let best: {url: string; attempt: number; bytes: Uint8Array; format: ImageFormat; width: number; height: number} | undefined;
  let rejected = false, lastError: ArtworkError = new ArtworkError("unavailable");
  let attempt = 0;
  for (const url of urls) {
    if (signal.aborted) throw new ArtworkError(environment.signal?.aborted ? "cancelled" : "timeout");
    attempt++;
    let phase: ArtworkDiagnosticEvent["phase"] = "request";
    let response: Response | undefined;
    emit({kind: "request", url, attempt, phase});
    try {
      response = await fetcher(url, {method: "GET", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal});
      emit({kind: "response", url, attempt, phase, status: response.status,
        contentType: (response.headers.get("content-type") ?? "").split(";")[0]!.slice(0, 100)});
      if (!response.ok) {void response.body?.cancel().catch(() => undefined); throw new ArtworkError("network");}
      phase = "response-body";
      const bytes = await limitedBody(response);
      phase = "format";
      const format = imageFormat(bytes);
      phase = "decode";
      let bitmap;
      try {bitmap = await decode(new Blob([new Uint8Array(bytes)], {type: mimeTypes[format]}));}
      catch {throw new ArtworkError("invalid-image");}
      const {width, height} = bitmap; bitmap.close();
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new ArtworkError("invalid-image");
      emit({kind: "decoded", url, attempt, phase, status: response.status, byteLength: bytes.length, width, height});
      if (!best || width * height > best.width * best.height) best = {url, attempt, bytes, format, width, height};
    } catch (error) {
      const code = signal.aborted ? environment.signal?.aborted ? "cancelled" : "timeout" : error instanceof ArtworkError ? error.code : "network";
      emit({kind: "failure", url, attempt, phase, code, hasHttpResponse: Boolean(response),
        ...(response ? {status: response.status} : {}), aborted: signal.aborted, callerAborted: Boolean(environment.signal?.aborted), browserError: browserErrorDetails(error)});
      if (signal.aborted) throw new ArtworkError(environment.signal?.aborted ? "cancelled" : "timeout");
      rejected = true;
      const failure = error instanceof ArtworkError ? error : new ArtworkError("network");
      if (lastError.code !== "too-large" || failure.code === "too-large") lastError = failure;
    }
  }
  if (!best) throw lastError;
  if (signal.aborted) throw new ArtworkError(environment.signal?.aborted ? "cancelled" : "timeout");
  emit({kind: "selected", url: best.url, attempt: best.attempt, phase: "selection", byteLength: best.bytes.length, width: best.width, height: best.height});
  return {service, albumId: id, sourceUrl: best.url, format: best.format, mimeType: mimeTypes[best.format],
    width: best.width, height: best.height, byteLength: best.bytes.length, dataBase64: base64(best.bytes),
    warnings: [...(best.width < 300 || best.height < 300 ? ["low-resolution" as const] : []), ...(rejected ? ["unavailable-variants" as const] : [])]};
}

/** A composed form can retain a resource even after its source card is removed. */
export class AlbumArtworkResource {
  private references = 1;
  readonly file: File;
  readonly previewUrl: string;
  constructor(readonly metadata: Omit<AlbumArtworkFile, "dataBase64">, bytes: Uint8Array,
    private readonly urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL) {
    this.metadata = Object.freeze({...metadata, warnings: Object.freeze([...metadata.warnings])});
    this.file = new File([new Uint8Array(bytes)], `${metadata.service}-${metadata.service === "lastfm" ? "album" : metadata.albumId}.${metadata.format === "jpeg" ? "jpg" : metadata.format}`, {type: metadata.mimeType});
    this.previewUrl = urls.createObjectURL(this.file);
  }
  retain(): this {
    if (!this.references) throw new ArtworkError("invalid-input");
    this.references++; return this;
  }
  release(): void {
    if (this.references && --this.references === 0) this.urls.revokeObjectURL(this.previewUrl);
  }
}
export async function loadAlbumArtworkResource<T extends ArtworkInput>(album: T, request: (album: T) => Promise<AlbumArtworkFile>, options: {
  readonly signal?: AbortSignal;
  readonly urls?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
} = {}): Promise<AlbumArtworkResource> {
  if (options.signal?.aborted) throw new ArtworkError("cancelled");
  const reply = await request(structuredClone(album));
  if (options.signal?.aborted) throw new ArtworkError("cancelled");
  if (reply.service !== album.service || reply.albumId !== album.id || !isAlbumArtworkUrl(reply.service, reply.sourceUrl) ||
    !Number.isSafeInteger(reply.byteLength) || reply.byteLength <= 0 || reply.byteLength > ARTWORK_BYTE_LIMIT ||
    !Number.isSafeInteger(reply.width) || !Number.isSafeInteger(reply.height) || reply.width <= 0 || reply.height <= 0 ||
    typeof reply.dataBase64 !== "string" || reply.dataBase64.length > Math.ceil(ARTWORK_BYTE_LIMIT / 3) * 4) throw new ArtworkError("invalid-image");
  let bytes: Uint8Array;
  try {bytes = Uint8Array.from(atob(reply.dataBase64), char => char.charCodeAt(0));}
  catch {throw new ArtworkError("invalid-image");}
  if (bytes.length !== reply.byteLength || imageFormat(bytes) !== reply.format || mimeTypes[reply.format] !== reply.mimeType) throw new ArtworkError("invalid-image");
  const {dataBase64: _data, ...metadata} = reply;
  return new AlbumArtworkResource(metadata, bytes, options.urls);
}
