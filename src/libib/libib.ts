import {mountAlbumAction} from "../components/catalog-ui.js";
import { isSupportedCatalogUrl, LIBIB, type AlbumQuery, type CatalogAdapter, type CatalogAlbum } from "../shared/contracts.js";

import { normalizeProductCode } from "../albums/identifiers.js";

let selectedService = "spotify";
export function setLibibService(service: string): void { selectedService = service; }

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
    const dispose = mountAlbumAction(host, selectedService, () => readAlbum(album.actionTarget), onOpen);
    const author = album.actionTarget.matches(".details-view")
      ? album.actionTarget.querySelector(".summary-right-col .item-author") : undefined;
    if (author) author.insertAdjacentElement("afterend", host);
    else album.actionTarget.append(host);
    return () => {dispose(); host.remove();};
  },
};
