import type { AlbumCandidate, AlbumQuery, StreamingAdapter, StreamingId } from "./contracts.js";
import { normalizeProductCode, productCodesMatch } from "./identifiers.js";

export interface RememberedChoice {
  readonly key: string;
  readonly service: StreamingId;
  readonly query?: AlbumQuery;
  readonly artist: { readonly id: string; readonly name: string };
  readonly album?: AlbumCandidate;
}

export type FailureCode =
  | "configuration-required"
  | "invalid-query"
  | "invalid-response"
  | "authentication-required"
  | "rate-limited"
  | "network"
  | "unavailable"
  | "cancelled"
  | "unexpected";

export class StreamingError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "StreamingError";
  }
}

export function isStreamingError(value: unknown): value is StreamingError {
  return value instanceof Error && value.name === "StreamingError" && "code" in value &&
    ["configuration-required", "invalid-query", "invalid-response", "authentication-required", "rate-limited", "network", "unavailable", "cancelled", "unexpected"].includes(String(value.code));
}

export type AlbumResolution =
  | {
      readonly status: "resolved";
      readonly album: AlbumCandidate;
      readonly reason: "remembered-album" | "remembered-artist" | "exact-match" | "identifier";
    }
  | {
      readonly status: "choose";
      readonly candidates: readonly AlbumCandidate[];
      readonly rememberAlbumByDefault: false;
      readonly incomplete?: boolean;
      readonly nextPage?: string;
    }
  | {
      readonly status: "not-found";
      readonly query: AlbumQuery;
      readonly service: StreamingId;
      readonly offerSearch: true;
    }
  | {
      readonly status: "failed";
      readonly code: FailureCode;
      readonly message: string;
      readonly retryAfterSeconds?: number;
    };

export function normalizeMetadata(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isValidQuery(query: AlbumQuery): boolean {
  return Boolean(
    normalizeMetadata(query.title) &&
    typeof query.artist === "string" &&
    query.source.catalogId.trim() &&
    isHttpsUrl(query.source.itemUrl),
  );
}

export function getLookupKey(query: AlbumQuery, service: StreamingId): string {
  if (!isValidQuery(query)) throw new TypeError("Título e origem do álbum são necessários.");

  const itemId = query.source.itemId?.trim();
  return JSON.stringify([
    2,
    service,
    query.source.catalogId.trim(),
    ...(itemId
      ? ["item", itemId]
      : [
          "metadata",
          new URL(query.source.itemUrl).href,
          normalizeMetadata(query.title),
          normalizeMetadata(query.artist),
          [...new Set([query.upc, query.ean].map(normalizeProductCode).filter((code): code is string => Boolean(code)).map((code) => code.padStart(13, "0")))].sort(),
        ]),
  ]);
}

export function isValidCandidate(album: AlbumCandidate, service: StreamingId): boolean {
  return Boolean(
    album &&
    album.service === service &&
    typeof album.id === "string" && album.id.trim() &&
    typeof album.title === "string" && normalizeMetadata(album.title) &&
    typeof album.url === "string" && isHttpsUrl(album.url) &&
    Array.isArray(album.artists) && album.artists.length > 0 &&
    album.artists.every((artist) =>
      artist && typeof artist.id === "string" && artist.id.trim() &&
      typeof artist.name === "string" && normalizeMetadata(artist.name),
    ),
  );
}

function matchingChoice(
  query: AlbumQuery,
  service: StreamingId,
  choice?: RememberedChoice,
): RememberedChoice | undefined {
  if (
    !choice || choice.service !== service || choice.key !== getLookupKey(query, service) ||
    !choice.artist.id.trim() || !normalizeMetadata(choice.artist.name)
  ) return undefined;

  if (choice.album && (
    !isValidCandidate(choice.album, service) ||
    !choice.album.artists.some((artist) => artist.id === choice.artist.id)
  )) return undefined;

  return choice;
}

export function createRememberedChoice(
  query: AlbumQuery,
  album: AlbumCandidate,
  artistId: string,
  rememberAlbum = false,
): RememberedChoice {
  if (!isValidCandidate(album, album.service)) throw new TypeError("Álbum selecionado inválido.");
  const artist = album.artists.find((item) => item.id === artistId);
  if (!artist) throw new TypeError("O artista selecionado precisa pertencer ao álbum.");

  return {
    key: getLookupKey(query, album.service),
    service: album.service,
    query: {...query, source: {...query.source}},
    artist: { ...artist },
    ...(rememberAlbum ? { album: { ...album, artists: album.artists.map((item) => ({ ...item })) } } : {}),
  };
}

export function resolveCandidates(
  query: AlbumQuery,
  service: StreamingId,
  candidates: readonly AlbumCandidate[],
  remembered?: RememberedChoice,
  allowAutomatic = true,
): AlbumResolution {
  if (!isValidQuery(query)) {
    return { status: "failed", code: "invalid-query", message: "Título e origem do álbum são necessários." };
  }

  const choice = matchingChoice(query, service, remembered);
  if (choice?.album) return { status: "resolved", album: choice.album, reason: "remembered-album" };

  if (!Array.isArray(candidates)) {
    return { status: "failed", code: "invalid-response", message: "O serviço não retornou uma lista de álbuns válida." };
  }

  const unique = new Map<string, AlbumCandidate>();
  for (const candidate of candidates) {
    if (isValidCandidate(candidate, service) && !unique.has(candidate.id)) unique.set(candidate.id, candidate);
  }
  const valid = [...unique.values()];
  if (candidates.length > 0 && valid.length === 0) {
    return { status: "failed", code: "invalid-response", message: "O serviço retornou somente álbuns inválidos." };
  }

  let options = valid;
  if (choice) {
    options = valid.filter((album) => album.artists.some((artist) => artist.id === choice.artist.id));
    if (allowAutomatic && options.length === 1 && options[0]) {
      return { status: "resolved", album: options[0], reason: "remembered-artist" };
    }
  } else {
    const identified = valid.filter((album) =>
      [query.upc, query.ean].some((code) =>
        productCodesMatch(code, album.upc) || productCodesMatch(code, album.ean),
      ),
    );
    if (allowAutomatic && identified.length === 1 && identified[0]) {
      return { status: "resolved", album: identified[0], reason: "identifier" };
    }
    if (identified.length > 0) {
      return { status: "choose", candidates: identified, rememberAlbumByDefault: false };
    }
    const namedArtists = new Set(valid.flatMap((album) =>
      album.artists
        .filter((artist) => normalizeMetadata(artist.name) === normalizeMetadata(query.artist))
        .map((artist) => artist.id),
    ));
    // A name alone must not merge distinct artists with the same name.
    if (namedArtists.size === 1) {
      options = valid.filter((album) => album.artists.some((artist) => namedArtists.has(artist.id)));
      if (allowAutomatic && options.length === 1 && options[0] &&
        normalizeMetadata(options[0].title) === normalizeMetadata(query.title)) {
        return { status: "resolved", album: options[0], reason: "exact-match" };
      }
    }
  }

  if (options.length === 0) return { status: "not-found", query, service, offerSearch: true };

  const title = normalizeMetadata(query.title);
  return {
    status: "choose",
    candidates: [...options].sort((a, b) =>
      Number(normalizeMetadata(b.title) === title) - Number(normalizeMetadata(a.title) === title),
    ),
    rememberAlbumByDefault: false,
  };
}

export async function searchAlbums(
  adapter: StreamingAdapter,
  query: AlbumQuery,
  remembered?: RememberedChoice,
  signal?: AbortSignal,
): Promise<AlbumResolution> {
  if (!isValidQuery(query)) return resolveCandidates(query, adapter.id, []);
  if (signal?.aborted) return { status: "failed", code: "cancelled", message: "Busca cancelada." };

  const choice = matchingChoice(query, adapter.id, remembered);
  if (choice?.album) return { status: "resolved", album: choice.album, reason: "remembered-album" };

  try {
    const candidates = await adapter.search(query, signal);
    if (signal?.aborted) return { status: "failed", code: "cancelled", message: "Busca cancelada." };
    if ("candidates" in candidates) {
      const result = resolveCandidates(query, adapter.id, candidates.candidates, choice, false);
      if (result.status === "failed") return result;
      return { status: "choose", candidates: result.status === "choose" ? result.candidates : [],
        rememberAlbumByDefault: false, incomplete: true,
        ...(candidates.nextPage ? { nextPage: candidates.nextPage } : {}) };
    }
    return resolveCandidates(query, adapter.id, candidates, choice);
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      return { status: "failed", code: "cancelled", message: "Busca cancelada." };
    }
    if (isStreamingError(error)) {
      return {
        status: "failed",
        code: error.code,
        message: error.message,
        ...(error.retryAfterSeconds !== undefined && Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds >= 0
          ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      };
    }
    return {
      status: "failed",
      code: error instanceof TypeError ? "network" : "unexpected",
      message: error instanceof TypeError ? "Não foi possível consultar o serviço." : "O serviço não concluiu a busca.",
    };
  }
}
