import { isSupportedCatalogUrl, type AlbumQuery, type AlbumOpenTarget, type AppReply } from "./contracts.js";

import { libib, setLibibService } from "./libib.js";

let selectedService = "spotify";
async function refreshService(): Promise<void> {
  if (!isSupportedCatalogUrl(location.href)) return;
  try {
    const reply: AppReply<{service?: string}> | undefined = await chrome.runtime.sendMessage({type: "library:get-service", sourceUrl: location.href});
    if (!reply?.ok) return;
    const service = reply.data.service ?? "spotify";
    if (service === selectedService) return;
    selectedService = service; setLibibService(service);
    for (const remove of mounted.values()) remove();
    mounted.clear(); updateLibraryAction();
  } catch { /* Retry when the library receives focus. */ }
}

let openAlbum: ((query: AlbumQuery, target: AlbumOpenTarget) => Promise<void>) | undefined;
const mounted = new Map<Element, () => void>();
function syncAlbumActions(): void {
  const albums = libib.collect(document);
  const targets = new Set(albums.map((album) => album.actionTarget));
  for (const [target, remove] of mounted) {
    if (!target.isConnected || !targets.has(target)) { remove(); mounted.delete(target); }
  }
  for (const album of albums) {
    const action = album.actionTarget.querySelector("[data-collection-to-play-action]");
    if (mounted.has(album.actionTarget) && !action) mounted.delete(album.actionTarget);
    if (!mounted.has(album.actionTarget)) mounted.set(album.actionTarget, libib.mountAction(album, (query, target) => openAlbum?.(query, target)));
    else {
      action?.shadowRoot?.querySelector("button")?.setAttribute("aria-label", `Ouvir ${album.query.title} no ${selectedService === "youtube-music" ? "YouTube Music" : "Spotify"}`);
    }
  }
}
const hostId = "collection-to-play-library";

function updateLibraryAction(): void {
  const existing = document.getElementById(hostId);
  if (!isSupportedCatalogUrl(location.href)) {
    existing?.remove(); openAlbum = undefined;
    for (const remove of mounted.values()) remove();
    mounted.clear();
    return;
  }
  if (existing) {
    syncAlbumActions();
    return;
  }

  const host = document.createElement("div");
  host.id = hostId;
  const shadow = host.attachShadow({ mode: "open" });
  const styles = document.createElement("link");
  styles.rel = "stylesheet";
  styles.href = chrome.runtime.getURL("library.css");

  const panel = document.createElement("section");
  panel.id = "collection-player-panel";
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Collection to Play — buscar álbum");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "close";
  close.textContent = "Fechar";
  const frame = document.createElement("iframe");
  frame.title = "Escolher álbum — Collection to Play";
  frame.allow = "clipboard-write";
  const hide = (): void => {
    panel.hidden = true;
    frame.src = "about:blank";
  };
  const showSearchPanel = (query: AlbumQuery, target: AlbumOpenTarget, resultId?: string): void => {
    const url = new URL(chrome.runtime.getURL("album-panel.html"));
    url.searchParams.set("target", target);
    if (query) {
      url.searchParams.set("title", query.title);
      url.searchParams.set("artist", query.artist);
      url.searchParams.set("source", query.source.itemUrl);
      if (query.upc) url.searchParams.set("upc", query.upc);
      if (query.ean) url.searchParams.set("ean", query.ean);
    }
    if (resultId) url.searchParams.set("result", resultId);
    if (!frame.src || query) frame.src = url.href;
    panel.hidden = false;
    close.focus();
  };
  openAlbum = async (query, target): Promise<void> => {
    try {
      const reply: AppReply<{ opened: boolean; resultId?: string }> | undefined = await chrome.runtime.sendMessage({
        type: "spotify:open", title: query.title, artist: query.artist,
        ...(query.upc ? { upc: query.upc } : {}), ...(query.ean ? { ean: query.ean } : {}),
        sourceUrl: query.source.itemUrl, target,
      });
      if (!reply?.ok) { showSearchPanel(query, target); return; }
      if (!reply.data.opened) showSearchPanel(query, target, reply.data.resultId);
    } catch { showSearchPanel(query, target); }
  };
  close.addEventListener("click", hide);
  shadow.addEventListener("keydown", (event) => { if (event instanceof KeyboardEvent && event.key === "Escape") hide(); });
  panel.append(close, frame);
  shadow.append(styles, panel);
  document.documentElement.append(host);
  syncAlbumActions();
}

// The library can change routes without a full document reload.
let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => { scheduled = false; updateLibraryAction(); }, 100);
});
observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
window.addEventListener("popstate", updateLibraryAction);
window.addEventListener("hashchange", updateLibraryAction);
let previousUrl = location.href;
setInterval(() => {
  if (location.href !== previousUrl) { previousUrl = location.href; updateLibraryAction(); }
}, 500);
updateLibraryAction();

void refreshService();
window.addEventListener("focus", () => { void refreshService(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshService(); });
setInterval(() => { if (!document.hidden) void refreshService(); }, 5000);
