import {descriptionFromSearch, descriptionText, type AlbumDescription} from "./album-description.js";
import {isDeezerAlbumUrl} from "../streamings/deezer.js";
import {isItunesAlbumUrl} from "../streamings/itunes.js";
import type {AlbumCandidate, MetadataServiceId} from "../shared/contracts.js";
import {AlbumArtworkResource, ArtworkError, isArtworkError, type AlbumArtworkFile} from "./album-artwork.js";
import {isMetadataService, isMetadataAlbumId} from "../streamings/metadata-search.js";

export type CompositionField = "title" | "artists" | "artwork" | "description";
export type AlbumSource = Pick<AlbumCandidate, "service" | "id" | "url"> & Partial<Omit<AlbumCandidate, "service" | "id" | "url">>;
type OriginalFieldSource = {readonly kind: "catalog"} | {
  readonly kind: "streaming"; readonly service: MetadataServiceId; readonly albumId: string; readonly albumUrl: string; readonly albumTitle?: string;
} | {readonly kind: "merged"; readonly sources: readonly {readonly service: MetadataServiceId; readonly albumId: string; readonly albumUrl: string; readonly albumTitle?: string}[]};
export type FieldSource = OriginalFieldSource | {readonly kind: "manual"; readonly basedOn: OriginalFieldSource};
export interface ComposedField<T> {
  readonly value: T;
  readonly source: FieldSource;
  readonly included: boolean;
}
export interface ArtworkView {
  readonly metadata: Omit<AlbumArtworkFile, "dataBase64">;
  readonly file: File;
  readonly previewUrl: string;
}
export interface CompositionPatch {
  readonly title?: string;
  readonly artists?: readonly string[];
  readonly artwork?: File;
  readonly description?: string;
}
interface Card {
  description: AlbumDescription | undefined;
  descriptionError: string | undefined;
  descriptionPending: Promise<boolean> | undefined;
  descriptionController: AbortController | undefined;
  readonly album: AlbumSource;
  artwork: AlbumArtworkResource | undefined;
  error: {readonly code: ArtworkError["code"]; readonly message: string} | undefined;
  pending: Promise<boolean> | undefined;
  controller: AbortController | undefined;
}
function artworkView(value: AlbumArtworkResource | undefined): ArtworkView | undefined {
  return value ? {metadata: structuredClone(value.metadata), file: value.file, previewUrl: value.previewUrl} : undefined;
}
function manualSource(previous: FieldSource): FieldSource {
  return {kind: "manual", basedOn: structuredClone(previous.kind === "manual" ? previous.basedOn : previous)};
}
function readAlbum(value: AlbumSource): AlbumSource {
  if (!value || !isMetadataService(value.service) || !isMetadataAlbumId(value.service, value.id)) throw new TypeError("Selecione um álbum de um streaming disponível.");
  try {
    const url = new URL(value.url);
    const valid = value.service === "deezer" ? isDeezerAlbumUrl(value.url, value.id) : value.service === "apple-music" ? isItunesAlbumUrl(value.url, value.id) : value.service === "spotify" ? url.origin === "https://open.spotify.com" && new RegExp(`^/(?:intl-[a-z]{2}/)?album/${value.id}/?$`).test(url.pathname) :
      url.origin === "https://music.youtube.com" && url.pathname === `/browse/${value.id}`;
    if (!valid || url.username || url.password || url.port) throw new Error();
  } catch {throw new TypeError("O endereço não corresponde ao álbum escolhido.");}
  if (value.title !== undefined && typeof value.title !== "string" || value.artists !== undefined &&
    (!Array.isArray(value.artists) || !value.artists.every(artist => artist && typeof artist.id === "string" && typeof artist.name === "string"))) {
    throw new TypeError("Os dados do álbum são inválidos.");
  }
  return structuredClone(value);
}

/** Independent state for source cards and the draft; it never searches or persists catalog data. */
export class AlbumComposition {
  private readonly cards = new Map<MetadataServiceId, Card>();
  private readonly listeners = new Set<() => void>();
  private selected: MetadataServiceId | undefined;
  private disposed = false;
  private title: ComposedField<string>;
  private artists: ComposedField<readonly string[]>;
  private artwork: ComposedField<AlbumArtworkResource | undefined>;
  private description: ComposedField<string>;
  private readonly initial: {title: string; artists: readonly string[]; description: string; artwork: AlbumArtworkResource | undefined};

  constructor(initial: {readonly title?: string; readonly artists?: readonly string[]; readonly description?: string; readonly artwork?: AlbumArtworkResource} = {},
    private readonly environment: {loadDescription?(album: AlbumSource, signal: AbortSignal): Promise<AlbumDescription>; loadArtwork?(album: AlbumSource, signal: AbortSignal): Promise<AlbumArtworkResource>} = {}) {
    if (initial.description !== undefined && typeof initial.description !== "string" || initial.title !== undefined && typeof initial.title !== "string" || initial.artists !== undefined &&
      (!Array.isArray(initial.artists) || !initial.artists.every(name => typeof name === "string"))) throw new TypeError("Os dados iniciais são inválidos.");
    this.initial = {title: initial.title ?? "", artists: [...initial.artists ?? []], description: initial.description ?? "", artwork: initial.artwork?.retain()};
    this.description = {value: initial.description ?? "", source: {kind: "catalog"}, included: false};
    this.title = {value: initial.title ?? "", source: {kind: "catalog"}, included: false};
    this.artists = {value: [...initial.artists ?? []], source: {kind: "catalog"}, included: false};
    this.artwork = {value: initial.artwork?.retain(), source: {kind: "catalog"}, included: false};
  }
  private active(): void {if (this.disposed) throw new Error("A composição já foi encerrada.");}
  private changed(): void {
    for (const listener of [...this.listeners]) {
      try {listener();} catch { /* A view must not interrupt draft changes or resource cleanup. */ }
    }
  }
  subscribe(listener: () => void): () => void {
    this.active(); this.listeners.add(listener); return () => {this.listeners.delete(listener);};
  }
  snapshot() {
    this.active();
    return {
      selectedService: this.selected,
      cards: [...this.cards.values()].map(card => ({album: structuredClone(card.album), artwork: artworkView(card.artwork),
        description: card.description ? structuredClone(card.description) : undefined, loadingDescription: Boolean(card.descriptionPending), descriptionError: card.descriptionError,
        loadingArtwork: Boolean(card.pending), artworkError: card.error ? {...card.error} : undefined})),
      fields: {description: structuredClone(this.description), title: structuredClone(this.title), artists: structuredClone(this.artists),
        artwork: {value: artworkView(this.artwork.value), source: structuredClone(this.artwork.source), included: this.artwork.included}},
    };
  }
  addAlbum(value: AlbumSource): void {
    this.active(); const album = readAlbum(value);
    if (!isMetadataService(album.service)) throw new TypeError("Streaming indisponível.");
    if (this.cards.has(album.service)) throw new Error("Remova o álbum deste streaming antes de escolher outro.");
    this.cards.set(album.service, {album, artwork: undefined, error: undefined, pending: undefined, controller: undefined, description: descriptionFromSearch(album), descriptionError: undefined, descriptionPending: undefined, descriptionController: undefined});
    this.changed();
  }
  selectAlbum(service: MetadataServiceId): void {
    this.active(); if (!this.cards.has(service)) throw new Error("Selecione um álbum da lista.");
    this.selected = service; this.changed();
  }
  removeAlbum(service: MetadataServiceId): boolean {
    this.active(); const card = this.cards.get(service); if (!card) return false;
    this.cards.delete(service); card.controller?.abort(); card.descriptionController?.abort(); card.artwork?.release();
    if (this.selected === service) this.selected = undefined;
    this.changed(); return true;
  }
  private card(service = this.selected): Card {
    this.active(); const card = service ? this.cards.get(service) : undefined;
    if (!card) throw new Error("Selecione um álbum da lista."); return card;
  }
  private source(card: Card): OriginalFieldSource {
    return {kind: "streaming", service: card.album.service as MetadataServiceId, albumId: card.album.id, albumUrl: card.album.url,
      ...(card.album.title ? {albumTitle: card.album.title} : {})};
  }
  private copy(card: Card, fields: readonly CompositionField[]): boolean {
    const title = fields.includes("title") && card.album.title?.trim() ? card.album.title : undefined;
    const names = card.album.artists?.map(artist => artist.name);
    const artists = fields.includes("artists") && names?.length && names.every(name => name.trim()) ? names : undefined;
    const artwork = fields.includes("artwork") ? card.artwork?.retain() : undefined;
    const description = fields.includes("description") && card.description ? descriptionText(card.description.text) : undefined;
    const source = this.source(card);
    if (description !== undefined) this.description = {value: description, source, included: true};
    if (title !== undefined) this.title = {value: title, source, included: true};
    if (artists !== undefined) this.artists = {value: [...artists], source, included: true};
    if (artwork) {const previous = this.artwork.value; this.artwork = {value: artwork, source, included: true}; previous?.release();}
    return title !== undefined || artists !== undefined || Boolean(artwork) || description !== undefined;
  }
  copyField(field: CompositionField, service = this.selected): boolean {
    if (!["title", "artists", "artwork", "description"].includes(field)) throw new TypeError("Campo inválido.");
    const copied = this.copy(this.card(service), [field]); if (copied) this.changed(); return copied;
  }
  copyAll(service = this.selected): boolean {
    const copied = this.copy(this.card(service), ["title", "artists", "artwork", "description"]); if (copied) this.changed(); return copied;
  }
  initializeDescription(value: string): void {
    this.active();if (typeof value !== "string") return;
    this.initial.description = value;
    if (this.description.included) return;
    this.description = {value, source: {kind: "catalog"}, included: false};this.changed();
  }
  resetField(field: CompositionField): void {
    this.active();
    if (field === "title") this.title = {value: this.initial.title, source: {kind: "catalog"}, included: false};
    else if (field === "artists") this.artists = {value: [...this.initial.artists], source: {kind: "catalog"}, included: false};
    else if (field === "description") this.description = {value: this.initial.description, source: {kind: "catalog"}, included: false};
    else if (field === "artwork") {
      const previous = this.artwork.value;
      this.artwork = {value: this.initial.artwork?.retain(), source: {kind: "catalog"}, included: false};
      previous?.release();
    } else throw new TypeError("Campo inválido.");
    this.changed();
  }
  editDescription(value: string): void {
    this.active();if (typeof value !== "string") throw new TypeError("Descrição inválida.");
    this.description = {value, source: manualSource(this.description.source), included: true};this.changed();
  }
  useMergedDescription(value: string, sources: readonly {readonly service: MetadataServiceId; readonly albumId: string}[]): void {
    this.active();const text = descriptionText(value);
    const origins = sources.map(source => {
      const card = this.cards.get(source.service);
      if (!card?.description || card.album.id !== source.albumId) throw new Error("Os álbuns escolhidos mudaram. Reabra a combinação de descrições.");
      return {service: source.service, albumId: source.albumId, albumUrl: card.album.url, ...(card.album.title ? {albumTitle: card.album.title} : {})};
    });
    this.description = {value: text, source: {kind: "merged", sources: [...new Map(origins.map(source => [source.service, source])).values()]}, included: true};
    this.changed();
  }
  editTitle(value: string): void {
    this.active(); if (typeof value !== "string") throw new TypeError("Título inválido.");
    this.title = {value, source: manualSource(this.title.source), included: true}; this.changed();
  }
  editArtists(value: readonly string[]): void {
    this.active(); if (!Array.isArray(value) || !value.every(name => typeof name === "string")) throw new TypeError("Artistas inválidos.");
    this.artists = {value: [...value], source: manualSource(this.artists.source), included: true}; this.changed();
  }
  editArtwork(value: AlbumArtworkResource): void {
    this.active(); const resource = value.retain(), previous = this.artwork.value;
    const {service, albumId} = resource.metadata;
    this.artwork = {value: resource, source: {kind: "manual", basedOn: {kind: "streaming", service, albumId,
      albumUrl: this.cards.get(service)?.album.id === albumId ? this.cards.get(service)!.album.url : service === "deezer" ? `https://www.deezer.com/album/${albumId}` : service === "apple-music" ? `https://music.apple.com/br/album/${albumId}` : service === "spotify" ? `https://open.spotify.com/album/${albumId}` : `https://music.youtube.com/browse/${albumId}`}}, included: true};
    previous?.release(); this.changed();
  }
  setIncluded(field: CompositionField, included: boolean): void {
    this.active(); if (!["title", "artists", "artwork", "description"].includes(field) || typeof included !== "boolean") throw new TypeError("Campo inválido.");
    if (field === "artwork" && included && !this.artwork.value) throw new Error("Escolha uma capa antes de aplicá-la.");
    if (field === "title") this.title = {...this.title, included};
    else if (field === "artists") this.artists = {...this.artists, included};
    else if (field === "description") this.description = {...this.description, included};
    else this.artwork = {...this.artwork, included};
    this.changed();
  }
  changes(): CompositionPatch {
    this.active();
    return {...(this.description.included ? {description: this.description.value} : {}), ...(this.title.included ? {title: this.title.value} : {}), ...(this.artists.included ? {artists: [...this.artists.value]} : {}),
      ...(this.artwork.included && this.artwork.value ? {artwork: this.artwork.value.file} : {})};
  }
  async prepareDescriptions(): Promise<void> {
    this.active();
    await Promise.all([...this.cards].map(([service]) => this.loadDescription(service)));
  }
  loadDescription(service: MetadataServiceId): Promise<boolean> {
    const card = this.card(service);if (card.descriptionPending) return card.descriptionPending;if (card.description) return Promise.resolve(true);
    const controller = new AbortController();card.descriptionController = controller;card.descriptionError = undefined;
    const current = (): boolean => !this.disposed && !controller.signal.aborted && this.cards.get(service) === card;
    const pending = Promise.resolve().then(async () => {
      try {
        if (!current() || !this.environment.loadDescription) return false;
        const result = await this.environment.loadDescription(structuredClone(card.album), controller.signal);
        if (!current()) return false;
        if (result.service !== service || result.albumId !== card.album.id) throw new Error("Descrição de outro álbum.");
        descriptionText(result.text);card.description = structuredClone(result);return true;
      } catch {if (current()) card.descriptionError = "Não foi possível gerar a descrição. Tente novamente.";return false;}
      finally {if (current()) {card.descriptionPending = undefined;card.descriptionController = undefined;this.changed();}}
    });
    card.descriptionPending = pending;this.changed();return pending;
  }
  loadArtwork(service: MetadataServiceId): Promise<boolean> {
    const card = this.card(service); if (card.pending) return card.pending; if (card.artwork) return Promise.resolve(true);
    const controller = new AbortController(); card.controller = controller; card.error = undefined;
    const current = (): boolean => !this.disposed && !controller.signal.aborted && this.cards.get(service) === card;
    const pending = Promise.resolve().then(async () => {
      if (!current()) return false;
      try {
        if (!this.environment.loadArtwork) throw new ArtworkError("unavailable");
        // A successful loader transfers one resource reference to this card.
        const resource = await this.environment.loadArtwork(structuredClone(card.album), controller.signal);
        if (!current()) {resource.release(); return false;}
        if (resource.metadata.service !== service || resource.metadata.albumId !== card.album.id) {resource.release(); throw new ArtworkError("invalid-input");}
        card.artwork = resource; return true;
      } catch (error) {
        if (current()) {const known = new ArtworkError(isArtworkError(error) ? error.code : "network"); card.error = {code: known.code, message: known.message};}
        return false;
      } finally {
        if (current()) {card.pending = undefined; card.controller = undefined; this.changed();}
      }
    });
    card.pending = pending; this.changed(); return pending;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const card of this.cards.values()) {card.controller?.abort(); card.descriptionController?.abort(); card.artwork?.release();}
    this.cards.clear(); const previous = this.artwork.value; this.artwork = {...this.artwork, value: undefined, included: false};
    previous?.release(); this.initial.artwork?.release(); this.listeners.clear(); this.selected = undefined;
  }
}
