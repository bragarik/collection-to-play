import type {DescriptionField} from "./description-completeness.js";
import type {AlbumCandidate, MetadataServiceId} from "../shared/contracts.js";
import {streamingName} from "../shared/contracts.js";
import {isMetadataService, isMetadataAlbumId} from "../streamings/metadata-search.js";
import {StreamingError} from "./resolution.js";
import {normalizeProductCode} from "./identifiers.js";

export const DESCRIPTION_LIMIT = 5_000;
export type DescriptionSectionField = "title" | "artists" | "releaseType" | "releaseDate" | "label" | "genres" | "trackCount" | "duration" | "upc" | "ean" | "copyrights" | "tracks" | "description";
export interface DescriptionSection {readonly field: DescriptionSectionField; readonly label: string; readonly text: string}
export interface DescriptionTrack {readonly title: string; readonly number?: number; readonly disc?: number; readonly durationMs?: number}
export interface AlbumDescriptionData {
  readonly album: AlbumCandidate;
  readonly label?: string;
  readonly genres?: readonly string[];
  readonly tracks?: readonly DescriptionTrack[];
  readonly trackCount?: number;
  readonly tracksComplete?: boolean;
  readonly releaseType?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly upc?: string | undefined;
  readonly ean?: string | undefined;
  readonly copyrights?: readonly string[];
  readonly notes?: readonly string[];
}
export interface AlbumDescription {
  readonly service: MetadataServiceId;
  readonly albumId: string;
  readonly text: string;
  readonly listedTracks: number;
  readonly notes: readonly string[];
  readonly fields?: readonly DescriptionField[];
  readonly sections?: readonly DescriptionSection[];
}
export interface DescriptionReplacement {readonly confirmed: boolean; readonly expected: string}
function normalizedLines(value: string): string {return value.replace(/\r\n?/g, "\n");}
/** Use the documented CSV limit, or a smaller limit declared by the native field. */
export function descriptionLimit(value?: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, DESCRIPTION_LIMIT) : DESCRIPTION_LIMIT;
}
export function descriptionText(value: unknown, maxLength = DESCRIPTION_LIMIT): string {
  if (typeof value !== "string") throw new Error("Informe uma descrição válida.");
  const normalized = normalizedLines(value), limit = descriptionLimit(maxLength);
  if (!normalized.trim() || normalized.length > limit) throw new Error(`Informe uma descrição com até ${limit.toLocaleString("pt-BR")} caracteres.`);
  return normalized.trim();
}
export function assertDescriptionReplacement(current: unknown, replacement: DescriptionReplacement | undefined): void {
  if (typeof current !== "string" || !replacement || replacement.confirmed !== true || typeof replacement.expected !== "string") throw new Error("Confirme a substituição da descrição atual antes de aplicar.");
  // Native textareas and multipart serialization use different line endings.
  if (normalizedLines(current) !== normalizedLines(replacement.expected)) throw new Error("A descrição mudou. Reabra o editor para conferir antes de substituir.");
}

function invalid(): never {throw new StreamingError("invalid-response", "O serviço retornou dados de descrição inválidos.");}
function object(value: unknown): Record<string, unknown> {return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};}
function text(value: unknown): string | undefined {return typeof value === "string" && value.trim() ? value.trim().slice(0, 512) : undefined;}
function integer(value: unknown): number | undefined {return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;}
function duration(value: unknown, unit = 1): number | undefined {
  const number = integer(value);
  return number !== undefined && number > 0 && Number.isSafeInteger(number * unit) ? number * unit : undefined;
}
function releaseType(value: unknown): string | undefined {
  return typeof value === "string" ? ({album: "Álbum", single: "Single", ep: "EP", compilation: "Coletânea"} as Record<string, string>)[value] : undefined;
}
function productCode(value: unknown): string | undefined {return typeof value === "string" ? normalizeProductCode(value) : undefined;}
function formattedDuration(value: number | undefined): string | undefined {
  const valid = duration(value); if (valid === undefined) return undefined;
  const seconds = Math.floor(valid / 1000); if (!seconds) return undefined;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function totalDuration(data: AlbumDescriptionData): number | undefined {
  const direct = duration(data.durationMs); if (direct !== undefined) return direct;
  const tracks = data.tracks ?? [];
  if (!data.tracksComplete || !tracks.length || data.trackCount !== tracks.length || tracks.some(item => duration(item.durationMs) === undefined)) return undefined;
  return duration(tracks.reduce((sum, item) => sum + item.durationMs!, 0));
}
function date(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const found = value.match(/^(\d{4}(?:-\d{2})?(?:-\d{2})?)(?:T|$)/)?.[1];
  if (!found) return undefined;
  const [year, month = "01", day = "01"] = found.split("-");
  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(`${year}-${month}-${day}`) ? found : undefined;
}
export function validateDescriptionAlbum(value: unknown): AlbumCandidate {
  const album = object(value), service = album["service"], id = album["id"], artists = album["artists"];
  if (!isMetadataService(service) || !isMetadataAlbumId(service, id) || !text(album["title"]) || !Array.isArray(artists) || !artists.length || artists.length > 100 ||
    !artists.every(raw => typeof object(raw)["id"] === "string" && Boolean((object(raw)["id"] as string).trim()) && text(object(raw)["name"])) || typeof album["url"] !== "string") invalid();
  try {
    const url = new URL(album["url"]);
    const valid = service === "spotify" ? url.origin === "https://open.spotify.com" && new RegExp(`^/(?:intl-[a-z]{2}/)?album/${id}/?$`).test(url.pathname)
      : service === "youtube-music" ? url.origin === "https://music.youtube.com" && url.pathname === `/browse/${id}`
      : service === "deezer" ? url.origin === "https://www.deezer.com" && new RegExp(`^/(?:[a-z]{2}/)?album/${id}/?$`).test(url.pathname)
      : url.origin === "https://music.apple.com" && new RegExp(`^/br/album/(?:[^/]+/)?${id}/?$`).test(url.pathname);
    if (!valid || url.username || url.password || url.port || url.hash) invalid();
  } catch {invalid();}
  return structuredClone(value) as AlbumCandidate;
}
function namedAlbum(source: AlbumCandidate, title: unknown, values: readonly unknown[], release: unknown): AlbumCandidate {
  const titleText = text(title);
  const artists = values.map(raw => {
    const value = object(raw), name = text(value["name"] ?? value["artistName"]), rawId = value["id"] ?? value["artistId"];
    const id = typeof rawId === "string" && rawId.trim() ? rawId : typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0 ? String(rawId)
      : source.artists.find(artist => artist.name === name)?.id;
    return name && id ? {id, name} : undefined;
  });
  if (!titleText || !artists.length || artists.some(artist => !artist)) invalid();
  const releaseDate = date(release);
  const {releaseDate: _previousDate, ...base} = source;
  return {...base, title: titleText, artists: artists as {id: string; name: string}[], ...(releaseDate ? {releaseDate} : {})};
}

function track(title: unknown, number: unknown, disc: unknown, rawDuration?: unknown, unit = 1): DescriptionTrack {
  const name = text(title); if (!name) invalid();
  const position = integer(number), disk = integer(disc);
  const durationMs = duration(rawDuration, unit);
  return {title: name, ...(position ? {number: position} : {}), ...(disk ? {disc: disk} : {}), ...(durationMs !== undefined ? {durationMs} : {})};
}
export function deezerDescription(source: AlbumCandidate, value: unknown): AlbumDescriptionData {
  const data = object(value);
  if (String(data["id"]) !== source.id || data["type"] !== "album") invalid();
  const album = namedAlbum(source, data["title"], [data["artist"]], data["release_date"]);
  const genres = object(data["genres"])["data"], tracks = object(data["tracks"])["data"];
  if (tracks !== undefined && !Array.isArray(tracks) || genres !== undefined && !Array.isArray(genres)) invalid();
  const all = (tracks as unknown[] | undefined) ?? [], count = integer(data["nb_tracks"]);
  const label = text(data["label"]);
  return {album, releaseType: releaseType(data["record_type"]), durationMs: duration(data["duration"], 1000), upc: productCode(data["upc"]), ...(label ? {label} : {}), genres: ((genres as unknown[] | undefined) ?? []).map(raw => text(object(raw)["name"])).filter((name): name is string => Boolean(name)),
    tracks: all.slice(0, 200).map(raw => {const item = object(raw);return track(item["title"], item["track_position"], item["disk_number"], item["duration"], 1000);}),
    ...(count !== undefined ? {trackCount: count} : {}), tracksComplete: all.length <= 200 && !object(data["tracks"])["next"] && (count === undefined || count <= all.length)};
}
export function itunesDescription(source: AlbumCandidate, value: unknown): AlbumDescriptionData {
  const data = object(value), results = data["results"];
  if (!Array.isArray(results) || data["resultCount"] !== results.length || results.length > 201) invalid();
  const collections = results.filter(raw => object(raw)["wrapperType"] === "collection" && object(raw)["collectionType"] === "Album");
  if (collections.length !== 1) invalid();
  const collection = object(collections[0]);if (String(collection["collectionId"]) !== source.id) invalid();
  const album = namedAlbum(source, collection["collectionName"], [collection], collection["releaseDate"]);
  const songs = results.filter(raw => object(raw)["wrapperType"] === "track" && object(raw)["kind"] === "song");
  if (songs.some(raw => String(object(raw)["collectionId"]) !== source.id)) invalid();
  const genre = text(collection["primaryGenreName"]), count = integer(collection["trackCount"]);
  const copyright = text(collection["copyright"]);
  return {album, ...(copyright ? {copyrights: [copyright]} : {}), ...(genre ? {genres: [genre]} : {}), tracks: songs.map(raw => {const item=object(raw);return track(item["trackName"],item["trackNumber"],item["discNumber"],item["trackTimeMillis"]);}),
    ...(count !== undefined ? {trackCount: count} : {}), tracksComplete: songs.length < 200 && (count === undefined || count <= songs.length)};
}
export function spotifyDescription(source: AlbumCandidate, value: unknown): AlbumDescriptionData {
  const data = object(value), artists = data["artists"], page = object(data["tracks"]), items = page["items"];
  if (data["id"] !== source.id || !Array.isArray(artists) || items !== undefined && !Array.isArray(items)) invalid();
  const album = namedAlbum(source, data["name"], artists, data["release_date"]);
  const label = text(data["label"]), genres = data["genres"], tracks = (items as unknown[] | undefined) ?? [], count = integer(data["total_tracks"]);
  const identifiers = object(data["external_ids"]), copyrights = data["copyrights"];
  return {album, releaseType: releaseType(data["album_type"]), upc: productCode(identifiers["upc"]), ean: productCode(identifiers["ean"]),
    copyrights: Array.isArray(copyrights) ? copyrights.slice(0, 10).flatMap(raw => {
      const item = object(raw), value = text(item["text"]); if (!value) return [];
      const symbol = item["type"] === "P" ? "℗" : item["type"] === "C" ? "©" : "";
      return [symbol && !/^[©℗]/.test(value) ? `${symbol} ${value}` : value];
    }) : [], ...(label ? {label} : {}), genres: Array.isArray(genres) ? genres.map(text).filter((name): name is string => Boolean(name)) : [],
    tracks: tracks.slice(0,200).map(raw => {const item=object(raw);return track(item["name"],item["track_number"],item["disc_number"],item["duration_ms"]);}),
    ...(count !== undefined ? {trackCount: count} : {}), tracksComplete: tracks.length <= 200 && !page["next"] && (count === undefined || count <= tracks.length)};
}
/** These sources already provide all fields used by their current description. */
export function descriptionUsesDetails(service: string): boolean {return service !== "youtube-music";}
export function descriptionFromSearch(value: unknown): AlbumDescription | undefined {
  const album = object(value);
  if (descriptionUsesDetails(String(album["service"]))) return undefined;
  const artists = album["artists"];
  if (!text(album["title"]) || !Array.isArray(artists) || !artists.length || !artists.every(artist => text(object(artist)["name"]))) return undefined;
  return formatAlbumDescription({album: validateDescriptionAlbum(value),
    notes: ["YouTube Music: descrição baseada somente nos dados disponíveis na busca; gravadora, gêneros e faixas não são fornecidos por esta integração."]});
}

export function formatAlbumDescription(data: AlbumDescriptionData): AlbumDescription {
  const album = validateDescriptionAlbum(data.album);
  const lines: string[] = [], sections: DescriptionSection[] = [];
  const add = (field: DescriptionSectionField, label: string, value: string): void => {
    const text = `${label}: ${value}`;lines.push(text);sections.push({field, label, text});
  };
  add("title", "Álbum", album.title);add("artists", "Artistas", album.artists.map(artist => artist.name).join(", "));
  if (data.releaseType) add("releaseType", "Tipo", data.releaseType);
  if (date(album.releaseDate)) add("releaseDate", "Lançamento", album.releaseDate!);
  if (data.label) add("label", "Gravadora", data.label);
  if (data.genres?.length) add("genres", "Gêneros", [...new Set(data.genres)].join(", "));
  if (data.trackCount !== undefined) add("trackCount", "Total de faixas", String(data.trackCount));
  const total = formattedDuration(totalDuration(data));
  if (total) add("duration", "Duração", total);
  if (data.upc) add("upc", "UPC", data.upc);
  if (data.ean && data.ean !== data.upc) add("ean", "EAN", data.ean);
  if (data.copyrights?.length) add("copyrights", "Direitos autorais", [...new Set(data.copyrights)].join("; "));
  const notes = [...data.notes ?? []], tracks = [...data.tracks ?? []].sort((a,b)=>(a.disc ?? 0)-(b.disc ?? 0)||(a.number ?? 0)-(b.number ?? 0));
  const footer = `Fonte: ${streamingName(album.service)}\n${album.url}`;
  const trackStart = lines.length;
  let listedTracks = 0;
  if (tracks.length) {
    lines.push("", "Faixas:");
    for (const item of tracks) {
      const length = formattedDuration(item.durationMs);
      const line = `${item.disc && item.disc > 1 ? `${item.disc}.` : ""}${item.number ? `${item.number}. ` : "- "}${item.title}${length ? ` — ${length}` : ""}`;
      if (lines.join("\n").length + line.length + footer.length + 300 > DESCRIPTION_LIMIT) break;
      lines.push(line);listedTracks++;
    }
  }
  if (data.tracksComplete === false || listedTracks < tracks.length) {
    notes.push("A lista de faixas é parcial; somente os dados retornados foram incluídos.");
    lines.push("", `Lista parcial de faixas: ${listedTracks}${data.trackCount !== undefined ? ` de ${data.trackCount}` : ""}.`);
  }
  const trackText = lines.slice(trackStart).join("\n").trim();
  if (trackText) sections.push({field: "tracks", label: "Faixas", text: trackText});
  lines.push("", footer);
  const fields: DescriptionField[] = ["title", "artists"];
  if (date(album.releaseDate)) fields.push("releaseDate");
  if (data.label?.trim()) fields.push("label");
  if (data.genres?.some(genre => genre.trim())) fields.push("genres");
  if (listedTracks > 0 && data.tracksComplete === true && listedTracks === tracks.length) fields.push("tracks");
  return {service: album.service as MetadataServiceId, albumId: album.id, text: descriptionText(lines.join("\n")), listedTracks, notes, fields, sections};
}
