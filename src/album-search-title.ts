import type { AlbumQuery } from "./contracts.js";
import { normalizeMetadata } from "./resolution.js";

export function albumSearchTitle(query: AlbumQuery): string {
  // A manual diagnostic query is kept exactly as entered.
  if (query.source.catalogId !== "libib") return query.title;
  let title = query.title.trim();
  let previous: string;
  do {
    previous = title;
    title = title.replace(/\s*\[(?:CD|DVD|CD\s*\/\s*DVD(?:\s+Combo)?)\]\s*$/i, "").trim();
    title = title.replace(/\s+(?:Stickered|explicit_lyrics)\s*$/i, "").trim();
  } while (title !== previous);
  const prefixed = title.match(/^(.+?)\s+[-–—]\s*(.+)$/u);
  if (prefixed?.[1] && prefixed[2] && normalizeMetadata(prefixed[1]) === normalizeMetadata(query.artist)) title = prefixed[2];
  return title !== query.title ? normalizeMetadata(title) || query.title : query.title;
}
