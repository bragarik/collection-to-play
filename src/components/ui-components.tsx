import {useState} from "preact/hooks";
import {isAlbumArtworkUrl} from "../albums/album-artwork.js";
import type {ComponentChildren} from "preact";

type ActionIconName = "search" | "album-add" | "trash" | "copy" | "check" | "save" | "bookmark" | "download" | "refresh" | "document" | "video";
export function ActionIcon({name}: {name: ActionIconName}) {
  const shapes: Record<ActionIconName, ComponentChildren> = {
    video: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/><path d="m10 9 5 3-5 3Z"/></>,
    document: <><path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    "album-add": <><circle cx="10" cy="11" r="8"/><circle cx="10" cy="11" r="2"/><path d="M18 16v6m-3-3h6"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
    copy: <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    save: <><path d="M20 21H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h13l4 4v13a1 1 0 0 1-1 1Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4Z"/>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    refresh: <><path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6"/></>,
  };
  return <svg class="action-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}

export function StreamingIcon({service = "spotify"}: {service?: string}) {
  if (service === "upcitemdb") return <img class="spotify-icon" src={chrome.runtime.getURL("assets/upcitemdb-icon.svg")} alt="" aria-hidden="true" width="24" height="24"/>;
  return <img class="spotify-icon" src={chrome.runtime.getURL(service === "discogs" ? "assets/discogs-icon.svg" : service === "tmdb" ? "assets/collection-to-play-icon.svg" : service === "lastfm" ? "assets/lastfm-icon.svg" : service === "deezer" ? "assets/deezer-icon.svg" : service === "apple-music" ? "assets/itunes-icon.svg" : service === "youtube-music" ? "assets/youtube-music-icon.png" : "assets/spotify-icon.svg")} alt="" aria-hidden="true" width="24" height="24"/>;
}
export function Feedback({id, children}: {id: string; children: ComponentChildren}) {
  return <p id={id} class="feedback" role="status" aria-live="polite">{children}</p>;
}
export async function extensionRequest<T>(message: import("../shared/contracts.js").AppRequest): Promise<T> {
  const reply: import("../shared/contracts.js").AppReply<T> | undefined = await chrome.runtime.sendMessage(message);
  if (!reply) throw new Error("A extensão não respondeu. Recarregue e tente novamente.");
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.data;
}
export function errorMessage(error: unknown): string {return error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente.";}
export function downloadJson(value: unknown, prefix: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: "application/json"}));
  const link = document.createElement("a"); link.href = url;
  link.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AlbumArtwork({album, className = "thumb"}: {album: import("../shared/contracts.js").AlbumCandidate; className?: string}) {
  const [failed, setFailed] = useState(false);
  return album.artworkUrl && isAlbumArtworkUrl(album.service, album.artworkUrl) && !failed
    ? <img class={className} src={album.artworkUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    : <span class={`${className} artwork-placeholder`} aria-hidden="true">♪</span>;
}

export function ArtworkDimensions({width, height}: {width: number; height: number}) {
  return <span class="card-artwork-size">{width} × {height} px</span>;
}

export interface ArtworkPreviewMetadata {
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly byteLength: number;
}
export function ArtworkPreview({src, alt, metadata}: {src: string; alt: string; metadata: ArtworkPreviewMetadata}) {
  const bytes = metadata.byteLength;
  const size = bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toLocaleString("pt-BR", {maximumFractionDigits: 2})} MB`
    : `${(bytes / 1000).toLocaleString("pt-BR", {maximumFractionDigits: 1})} KB`;
  return <>
    <img class="cover-preview" src={src} alt={alt} referrerPolicy="no-referrer"/>
    <p class="note">{metadata.width} × {metadata.height} px · {metadata.format.toUpperCase()} · {size}</p>
  </>;
}
