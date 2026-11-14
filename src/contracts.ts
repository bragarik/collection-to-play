import type { AlbumResolution } from "./resolution.js";
import type { LibibObservation } from "./libib-diagnostics.js";

export type StreamingId =
  | "spotify"
  | "deezer"
  | "apple-music"
  | "youtube-music"
  | "amazon-music";

export const STREAMINGS: readonly {readonly id: StreamingId; readonly name: string; readonly available: boolean}[] = [
  {id: "spotify", name: "Spotify", available: true},
  {id: "deezer", name: "Deezer", available: false},
  {id: "apple-music", name: "Apple Music", available: false},
  {id: "youtube-music", name: "YouTube Music", available: true},
  {id: "amazon-music", name: "Amazon Music", available: false},
];

export interface AlbumQuery {
  readonly title: string;
  readonly artist: string;
  readonly upc?: string;
  readonly ean?: string;
  readonly source: {
    readonly catalogId: string;
    readonly itemUrl: string;
    readonly itemId?: string;
  };
}

export interface AlbumCandidate {
  readonly service: StreamingId;
  readonly id: string;
  readonly title: string;
  readonly artists: readonly { readonly id: string; readonly name: string }[];
  readonly url: string;
  readonly artworkUrl?: string;
  readonly releaseDate?: string;
  readonly upc?: string;
  readonly ean?: string;
}

export interface CatalogAlbum {
  readonly query: AlbumQuery;
  readonly actionTarget: Element;
}

export type AlbumOpenTarget = "web" | "app";

export interface CatalogAdapter {
  readonly id: string;
  supports(url: URL): boolean;
  collect(root: Document): readonly CatalogAlbum[];
  mountAction(album: CatalogAlbum, onOpen: (query: AlbumQuery, target: AlbumOpenTarget) => void | Promise<void>): () => void;
}

export interface AlbumSearchPage {
  readonly candidates: readonly AlbumCandidate[];
  readonly complete: false;
  readonly nextPage?: string;
}

export interface StreamingAdapter {
  readonly id: StreamingId;
  search(query: AlbumQuery, signal?: AbortSignal): Promise<readonly AlbumCandidate[] | AlbumSearchPage>;
}

export const SPOTIFY = Object.freeze({
  clientId: "01d0cd78291843148ab40eca4b386479",
  redirectPath: "spotify",
});

export const LIBIB = Object.freeze({
  id: "libib",
  name: "Libib",
  libraryUrl: "https://www.libib.com/library",
});

export function isSupportedCatalogUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://www.libib.com" &&
      (url.pathname === "/library" || url.pathname.startsWith("/library/"))
    );
  } catch {
    return false;
  }
}

export const SETUP_REQUEST = "setup:get";

export type AppRequest =
  | { readonly type: typeof SETUP_REQUEST }
  | { readonly type: "library:get-service"; readonly sourceUrl: string }
  | { readonly type: "library:observe"; readonly sourceUrl: string; readonly observation: LibibObservation }
  | { readonly type: "libib:diagnostics" }
  | { readonly type: "preferences:get" }
  | { readonly type: "preferences:set-service"; readonly service: StreamingId }
  | { readonly type: "preferences:delete"; readonly key: string }
  | { readonly type: "spotify:connect" }
  | { readonly type: "spotify:disconnect" }
  | { readonly type: "spotify:diagnostics" }
  | { readonly type: "spotify:open-result"; readonly selectionId: string; readonly target: AlbumOpenTarget }
  | { readonly type: "spotify:select"; readonly selectionId: string; readonly albumId: string; readonly artistId: string; readonly rememberAlbum: boolean; readonly target: AlbumOpenTarget }
  | { readonly type: "spotify:pending"; readonly id: string }
  | { readonly type: "spotify:open"; readonly title: string; readonly artist: string; readonly upc?: string; readonly ean?: string; readonly sourceUrl: string; readonly target: AlbumOpenTarget }
  | { readonly type: "spotify:search"; readonly title: string; readonly artist: string; readonly upc?: string; readonly ean?: string; readonly nextPage?: string; readonly sourceUrl?: string; readonly lookupTitle?: string; readonly lookupArtist?: string; readonly purpose?: "metadata" };

export interface AlbumSearchReply {
  readonly resolution: AlbumResolution;
  readonly searchUrl: string;
  readonly selectionId?: string;
  readonly autoOpen?: boolean;
}

export type AppReply<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export interface SetupInfo {
  readonly preferredService?: StreamingId;
  readonly extensionId: string;
  readonly version: string;
  readonly spotify: {
    readonly clientId: string;
    readonly redirectUrl: string;
    readonly connected: boolean;
  };
  readonly catalog: typeof LIBIB;
}
