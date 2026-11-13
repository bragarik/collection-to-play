import { spotifyIcon, youtubeMusicIcon } from "./spotify-brand.js";
import { isSupportedCatalogUrl, LIBIB, type AlbumQuery, type CatalogAdapter, type CatalogAlbum } from "./contracts.js";

import { normalizeProductCode } from "./identifiers.js";

let selectedService = "spotify";
export function setLibibService(service: string): void { selectedService = service; }
function serviceName(): string { return selectedService === "youtube-music" ? "YouTube Music" : "Spotify"; }

const actionAttribute = "data-collection-to-play-action";

function readAlbum(card: Element): AlbumQuery | undefined {
  const source = card.ownerDocument.location?.href;
  if (!source || !isSupportedCatalogUrl(source)) return undefined;
  if (card.matches(".details-view") && ![...card.querySelectorAll(".media-tag")].some((tag) => /^(music|música|musica)$/i.test(tag.textContent?.trim() ?? ""))) return undefined;
  const title = card.querySelector(".item-title")?.textContent?.trim().replace(/\s+/g, " ") ?? "";
  const artist = card.querySelector(".item-author")?.textContent?.trim().replace(/\s+/g, " ") ?? "";
  if (!title) return undefined;
  const identifiers: { upc?: string; ean?: string } = {};
  if (card.matches(".details-view")) {
    for (const meta of card.querySelectorAll(".summary-right-col .meta")) {
      const raw = meta.textContent?.trim() ?? "";
      const upc = raw.match(/^UPC\s*\/\s*ISBN10\s*:\s*([\d\s-]+)$/i)?.[1];
      const ean = raw.match(/^EAN\s*\/\s*ISBN13\s*:\s*([\d\s-]+)$/i)?.[1];
      const validUpc = normalizeProductCode(upc);
      const validEan = normalizeProductCode(ean);
      if (validUpc) identifiers.upc = validUpc;
      if (validEan) identifiers.ean = validEan;
    }
  }
  return { title, artist, ...identifiers, source: { catalogId: LIBIB.id, itemUrl: source } };
}

export const libib: CatalogAdapter = {
  id: LIBIB.id,
  supports: (url) => isSupportedCatalogUrl(url.href),
  collect(root: Document): readonly CatalogAlbum[] {
    return [...root.querySelectorAll("#library-items-wrapper .item.music, #item-details-info .item-dv.details-view")].flatMap((card) => {
      const query = readAlbum(card);
      return query ? [{ query, actionTarget: card }] : [];
    });
  },
  mountAction(album, onOpen): () => void {
    if (album.actionTarget.querySelector(`[${actionAttribute}]`)) return () => {};
    const host = document.createElement("span");
    host.setAttribute(actionAttribute, "");
    host.dataset["kind"] = "card";
    const shadow = host.attachShadow({ mode: "open" });
    const styles = document.createElement("link");
    styles.rel = "stylesheet";
    styles.href = chrome.runtime.getURL("library.css");
    const button = document.createElement("button");
    button.type = "button";
    const buttonLabel = document.createElement("span");
    buttonLabel.textContent = `Ouvir no ${serviceName()}`;
    button.append(selectedService === "youtube-music" ? youtubeMusicIcon() : spotifyIcon());
    button.append(buttonLabel);
    button.setAttribute("aria-label", `Ouvir ${album.query.title} no ${serviceName()}`);
    button.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "album-options";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "Onde abrir o álbum");
    menu.hidden = true;
    const web = document.createElement("button");
    web.type = "button";
    web.textContent = "Web Player";
    const app = document.createElement("button");
    app.type = "button";
    app.textContent = "Aplicativo Spotify";
    const closeMenu = (): void => { menu.hidden = true; button.setAttribute("aria-expanded", "false"); };
    button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      if (selectedService === "youtube-music") { void open(event, "web"); return; }
      menu.hidden = !menu.hidden;
      button.setAttribute("aria-expanded", String(!menu.hidden));
    });
    shadow.addEventListener("keydown", event => {
      if (event instanceof KeyboardEvent && event.key === "Escape") { closeMenu(); button.focus(); }
    });
    shadow.addEventListener("focusout", () => { queueMicrotask(() => { if (!host.matches(":focus-within")) closeMenu(); }); });
    const open = async (event: MouseEvent, target: "web" | "app"): Promise<void> => {
      event.preventDefault(); event.stopPropagation();
      const query = readAlbum(album.actionTarget);
      if (!query || button.disabled) return;
      closeMenu();
      button.disabled = true; web.disabled = true; app.disabled = true;
      buttonLabel.textContent = "Buscando…";
      button.setAttribute("aria-busy", "true");
      try { await onOpen(query, target); }
      finally { button.disabled = false; web.disabled = false; app.disabled = false;
        buttonLabel.textContent = `Ouvir no ${serviceName()}`; button.removeAttribute("aria-busy"); }
    };
    web.addEventListener("click", event => { void open(event, "web"); });
    app.addEventListener("click", event => { void open(event, "app"); });
    menu.append(web, app);
    shadow.append(styles, button, menu);
    const author = album.actionTarget.matches(".details-view")
      ? album.actionTarget.querySelector(".summary-right-col .item-author") : undefined;
    if (author) author.insertAdjacentElement("afterend", host);
    else album.actionTarget.append(host);
    return () => host.remove();
  },
};
