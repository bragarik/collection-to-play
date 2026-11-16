import {DESCRIPTION_LIMIT, descriptionText, type AlbumDescription, type DescriptionSection, type DescriptionSectionField} from "./album-description.js";
import {streamingName, type MetadataServiceId} from "../shared/contracts.js";

export interface MergeCard {
  readonly album: {readonly service: MetadataServiceId | string; readonly id: string; readonly url: string; readonly title?: string};
  readonly description?: AlbumDescription | undefined;
  readonly descriptionError?: string | undefined;
}
export interface MergeSelection extends DescriptionSection {readonly service: MetadataServiceId; readonly albumId: string}
const SECTION_ORDER: readonly DescriptionSectionField[] = ["title", "artists", "releaseType", "releaseDate", "label", "genres", "trackCount", "duration", "upc", "ean", "copyrights", "tracks", "description"];

function blockPosition(text: string, block: string): number {
  let at = text.indexOf(block);
  while (at >= 0) {
    if ((at === 0 || text[at - 1] === "\n") && (at + block.length === text.length || text[at + block.length] === "\n")) return at;
    at = text.indexOf(block, at + 1);
  }
  return -1;
}

/** Independent, unsaved draft. Only unchanged copied blocks retain source attribution. */
export class DescriptionMerge {
  readonly cards: readonly MergeCard[];
  private readonly chosen = new Map<DescriptionSectionField, MergeSelection>();
  private value = "";
  private edited = false;
  private attribution = "";
  private sourcesIncluded = false;
  private attributionEdited = false;
  includesSources(): boolean {return this.sourcesIncluded;}
  setIncludeSources(value: boolean): void {
    this.sourcesIncluded = value;this.attributionEdited = false;
    this.attribution = value ? this.sourceText() : "";
  }
  private refreshAttribution(): void {
    if (!this.attributionEdited) this.attribution = this.sourcesIncluded ? this.sourceText() : "";
  }
  constructor(cards: readonly MergeCard[]) {this.cards = structuredClone(cards);}
  sections(card: MergeCard): readonly DescriptionSection[] {
    const document = card.description;
    if (!document) return [];
    return document.sections?.length ? document.sections : [{field: "description", label: "Descrição", text: document.text.replace(/\n\nFonte: [^\n]+\nhttps?:\/\/[^\n]+\s*$/, "").trim()}];
  }
  selection(field: DescriptionSectionField): MergeSelection | undefined {
    const value = this.chosen.get(field);return value ? structuredClone(value) : undefined;
  }
  private reconcile(): void {
    for (const [field, selection] of this.chosen) if (blockPosition(this.value, selection.text) < 0) this.chosen.delete(field);
  }
  choose(service: MetadataServiceId, field: DescriptionSectionField, toggle = true): void {
    const card = this.cards.find(value => value.album.service === service && value.description);
    const section = card ? this.sections(card).find(value => value.field === field) : undefined;
    if (!card?.description || !section?.text.trim()) throw new Error("Este dado não está disponível para combinar.");
    const previous = this.chosen.get(field), remove = toggle && previous?.service === service && previous.albumId === card.album.id;
    const replacement = remove ? "" : section.text, at = previous ? blockPosition(this.value, previous.text) : -1;
    if (at >= 0 && previous) this.value = this.value.slice(0, at) + replacement + this.value.slice(at + previous.text.length);
    else if (replacement) this.value += `${this.value ? field === "tracks" ? "\n\n" : "\n" : ""}${replacement}`;
    this.value = this.value.replace(/\n{3,}/g, "\n\n").trim();
    if (remove) this.chosen.delete(field);
    else this.chosen.set(field, {...section, service, albumId: card.album.id});
    if (!this.edited) this.value = [...this.chosen.values()].sort((a, b) => SECTION_ORDER.indexOf(a.field) - SECTION_ORDER.indexOf(b.field))
      .map((section, index) => `${index && section.field === "tracks" ? "\n" : ""}${section.text}`).join("\n");
    this.reconcile();this.refreshAttribution();
  }
  chooseAll(service: MetadataServiceId): void {
    const card = this.cards.find(value => value.album.service === service && value.description);
    if (!card) throw new Error("Descrição indisponível.");
    for (const section of this.sections(card)) this.choose(service, section.field, false);
  }
  edit(value: string): void {
    const next = value.replace(/\r\n?/g, "\n"), previous = this.text(), boundary = this.value.length;
    if (next === previous) return;
    if (this.attribution) {
      let prefix = 0, suffix = 0;
      while (prefix < Math.min(previous.length, next.length) && previous[prefix] === next[prefix]) prefix++;
      while (suffix < Math.min(previous.length, next.length) - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
      if (previous.length - suffix <= boundary) {
        this.value = next.slice(0, boundary + next.length - previous.length);
      } else if (prefix >= boundary) {
        this.attribution = next.slice(boundary);this.attributionEdited = true;
        return;
      } else {
        // A replacement crossing the boundary becomes a fully manual draft.
        this.value = next;this.attribution = "";this.attributionEdited = true;
      }
    } else this.value = next;
    this.edited = true;this.reconcile();this.refreshAttribution();
  }
  text(): string {return this.value + this.attribution;}
  private sourceText(): string {
    const sources = [...this.chosen.values()];
    const albums = new Map<string, {readonly service: MetadataServiceId; readonly url: string; readonly data: MergeSelection[]}>();
    for (const source of sources) {
      const key = `${source.service}:${source.albumId}`, card = this.cards.find(card => card.album.service === source.service && card.album.id === source.albumId)!;
      const album = albums.get(key) ?? {service: source.service, url: card.album.url, data: []};
      album.data.push(source);albums.set(key, album);
    }
    const used = [...albums.values()];
    return !used.length ? "" : used.length === 1
      ? `\n\nFonte: ${streamingName(used[0]!.service)}\n${used[0]!.url}`
      : `\n\nFontes:\n${used.map(album => `${streamingName(album.service)} - ${album.data.map(source => source.label).join(", ")}\n${album.url}`).join("\n\n")}`;
  }
  result(includeSources?: boolean, maxLength = DESCRIPTION_LIMIT): {readonly text: string; readonly sources: readonly MergeSelection[]} {
    const text = includeSources === undefined ? this.text() : this.value + (includeSources ? this.sourcesIncluded && this.attributionEdited ? this.attribution : this.sourceText() : "");
    return {text: descriptionText(text, maxLength), sources: [...this.chosen.values()].map(value => structuredClone(value))};
  }
}
