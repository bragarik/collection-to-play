import type {FieldSource} from "./album-composition.js";
import type {MetadataServiceId} from "../shared/contracts.js";

export interface CopyFieldSource {readonly service: MetadataServiceId; readonly albumId: string}
export type ComparableFields = Readonly<Record<string, string | readonly string[] | undefined>>;
function comparable(field: string, value: string | readonly string[] | undefined): string {
  const text = (typeof value === "string" ? value : value?.join(", ") ?? "").replace(/\r\n?/g, "\n").trim();
  if (["artists", "directors", "ensemble", "tags"].includes(field)) {
    return text.split(/[,\n]/).map(part => part.trim()).filter(Boolean).join(",");
  }
  return text;
}
/** Recognize existing values without selecting any field for writing. */
export function matchingCatalogFields(first: CopyFieldSource | undefined, offered: ComparableFields,
  original: ComparableFields, current: ComparableFields): Readonly<Record<string, CopyFieldSource>> {
  if (!first) return {};
  return Object.fromEntries(Object.entries(offered).filter(([field, value]) => {
    const saved = comparable(field, original[field]);
    return saved && comparable(field, value) === saved && comparable(field, current[field]) === saved;
  }).map(([field]) => [field, first]));
}
export function matchingCatalogSources(cards: readonly {readonly source: CopyFieldSource; readonly values: ComparableFields}[],
  original: ComparableFields, current: ComparableFields): Readonly<Record<string, CopyFieldSource>> {
  const matches: Record<string, CopyFieldSource> = {};
  for (const card of cards) {
    for (const [field, source] of Object.entries(matchingCatalogFields(card.source, card.values, original, current))) {
      matches[field] ??= source;
    }
  }
  return matches;
}
export function hasUnusedCardData(available: Readonly<Record<string, boolean>>, included: readonly string[]): boolean {
  const used = new Set(included);
  return Object.entries(available).some(([field, supplied]) => supplied && !used.has(field));
}
export function compositionCopySources(source: FieldSource): {sources: readonly CopyFieldSource[]; edited: boolean} {
  const original = source.kind === "manual" ? source.basedOn : source;
  return {sources: original.kind === "catalog" ? [] : original.kind === "merged" ? original.sources : [original], edited: source.kind === "manual"};
}
export function fieldCopyState(target: CopyFieldSource | undefined, sources: readonly CopyFieldSource[], included: boolean): "available" | "used" | "other" {
  if (!target || !included || !sources.length) return "available";
  return sources.some(source => source.service === target.service && source.albumId === target.albumId) ? "used" : "other";
}

/** Shared by individual buttons and the action that copies only pending fields. */
export function copyButtonState(target: CopyFieldSource | undefined, sources: readonly CopyFieldSource[],
  included: boolean, matchedSource?: CopyFieldSource): "available" | "used" | "other" {
  const recognized = Boolean(matchedSource) && (!included || !sources.length);
  return fieldCopyState(target, recognized ? [matchedSource!] : sources, included || recognized);
}
