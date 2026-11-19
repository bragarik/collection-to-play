import {isLastfmSourceId} from "./lastfm.js";
import {normalizeProductCode} from "../albums/identifiers.js";
import {METADATA_SERVICE_IDS, type AlbumCandidate, type MetadataSearchInput, type MetadataSearchReply, type MetadataServiceId, type MetadataServicesReply} from "../shared/contracts.js";
import {isValidCandidate, StreamingError} from "../albums/resolution.js";

export function isMetadataService(value: unknown): value is MetadataServiceId {
  return METADATA_SERVICE_IDS.some(service => service === value);
}
export function metadataUsesProductCode(service: MetadataServiceId): boolean {return service === "spotify" || service === "discogs" || service === "upcitemdb";}
export function metadataProductCode(service: MetadataServiceId, value: string): {upc?: string; ean?: string} {
  if (!metadataUsesProductCode(service) || !value.trim()) return {};
  const code = value.trim();
  return code.replace(/[\s-]/g, "").length === 12 ? {upc: code} : {ean: code};
}
export function isMetadataAlbumId(service: MetadataServiceId, value: unknown): value is string {
  if (service === "upcitemdb") return typeof value === "string" && value.length === 13 && normalizeProductCode(value) === value;
  if(service === "lastfm")return isLastfmSourceId(value);
  return typeof value === "string" && (service === "spotify" ? /^[a-zA-Z0-9]{22}$/ :
    service === "discogs" || service === "apple-music" || service === "deezer" ? /^[1-9]\d{0,15}$/ : /^MPRE[a-zA-Z0-9_-]{4,200}$/).test(value);
}
export function metadataQueryKey(query: MetadataSearchInput): string {
  return JSON.stringify([query.title.trim(), query.artist.trim(), query.sourceUrl, query.upc ?? "", query.ean ?? "", query.language ?? ""]);
}
/** Binds an adapter's continuation to the service and exact normalized query, without worker-local state. */
export function bindMetadataPage(service: MetadataServiceId, query: MetadataSearchInput, cursor: string): string {
  return JSON.stringify([1, service, metadataQueryKey(query), cursor]);
}
export function readMetadataPage(service: MetadataServiceId, query: MetadataSearchInput, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== "string" || value.length > 32768) throw new Error();
    const page: unknown = JSON.parse(value);
    if (!Array.isArray(page) || page.length !== 4 || page[0] !== 1 || page[1] !== service || page[2] !== metadataQueryKey(query) ||
      typeof page[3] !== "string" || !page[3] || page[3].length > 8192) throw new Error();
    return page[3];
  } catch {throw new StreamingError("invalid-query", "Esta continuação não pertence ao serviço e à busca atuais. Faça uma nova busca.");}
}

export interface MetadataSearchState {
  readonly query?: MetadataSearchInput;
  readonly albums: readonly AlbumCandidate[];
  readonly nextPage?: string;
}

/** Search state is independent of selected cards, composed fields and the preferred playback service. */
export class MetadataSearchSession {
  private revision = 0;
  private refreshRevision = 0;
  private services: MetadataServicesReply | undefined;
  private readonly results = new Map<MetadataServiceId, MetadataSearchState>();
  constructor(private selected: MetadataServiceId, private readonly environment: {
    services(): Promise<MetadataServicesReply>;
    search(service: MetadataServiceId, query: MetadataSearchInput, nextPage?: string): Promise<MetadataSearchReply>;
  }) {
    if (!isMetadataService(selected)) throw new TypeError("Streaming indisponível para buscar metadados.");
  }
  get service(): MetadataServiceId {return this.selected;}
  selectService(service: MetadataServiceId): void {
    if (!isMetadataService(service)) throw new TypeError("Streaming indisponível para buscar metadados.");
    if (service !== this.selected) {this.selected = service; this.invalidate();}
  }
  invalidate(): void {this.revision++;}
  clearResults(): void {this.invalidate();this.results.delete(this.selected);}
  snapshot(service = this.selected): MetadataSearchState {
    return structuredClone(this.results.get(service) ?? {albums: []});
  }
  async refreshServices(): Promise<MetadataServicesReply> {
    const revision = ++this.refreshRevision;
    const reply = await this.environment.services();
    if (revision === this.refreshRevision) this.services = structuredClone(reply);
    return structuredClone(this.services ?? reply);
  }
  async search(input: MetadataSearchInput, append = false): Promise<MetadataSearchReply | undefined> {
    const revision = ++this.revision, service = this.selected;
    const query: MetadataSearchInput = {...input, title: input.title.trim(), artist: input.artist.trim()};
    const previous = this.snapshot(service);
    if (append && (!previous.nextPage || !previous.query || metadataQueryKey(previous.query) !== metadataQueryKey(query))) {
      throw new StreamingError("invalid-query", "Faça uma nova busca antes de carregar outra página.");
    }
    try {
      const services = await this.refreshServices();
      if (revision !== this.revision) return undefined;
      const connection = services.services.find(item => item.id === service);
      if (!connection) throw new StreamingError("unavailable", "O streaming escolhido não está disponível.");
      const reply: MetadataSearchReply = connection.requiresAuthentication && !connection.connected
        ? {service, configurationUrl: services.configurationUrl, connectionRequired: true, searchUrl: "",
          resolution: {status: "failed", code: "authentication-required", message: "Conecte sua conta nas configurações e tente novamente."}}
        : await this.environment.search(service, query, append ? previous.nextPage : undefined);
      if (revision !== this.revision) return undefined;
      if (reply.service !== service) throw new StreamingError("invalid-response", "A resposta pertence a outro streaming.");
      const resolution = reply.resolution;
      if (resolution.status !== "failed") {
        const albums = resolution.status === "resolved" ? [resolution.album] : resolution.status === "choose" ? resolution.candidates : [];
        if (!albums.every(album => isValidCandidate(album, service))) throw new StreamingError("invalid-response", "O serviço retornou álbuns inválidos.");
        const unique = new Map((append ? previous.albums : []).map(album => [album.id, album]));
        for (const album of albums) unique.set(album.id, album);
        this.results.set(service, {query, albums: structuredClone([...unique.values()]),
          ...(resolution.status === "choose" && resolution.nextPage ? {nextPage: resolution.nextPage} : {})});
      }
      return reply;
    } catch (error) {
      if (revision !== this.revision) return undefined;
      throw error;
    }
  }
}
