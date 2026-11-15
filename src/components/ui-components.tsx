import {useState} from "preact/hooks";
import {isAlbumArtworkUrl} from "../albums/album-artwork.js";
import type {ComponentChildren} from "preact";

export function StreamingIcon({service = "spotify"}: {service?: string}) {
  return <img class="spotify-icon" src={chrome.runtime.getURL(service === "youtube-music" ? "assets/youtube-music-icon.png" : "assets/spotify-icon.svg")} alt="" aria-hidden="true" width="24" height="24"/>;
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
