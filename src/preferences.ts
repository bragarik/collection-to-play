import type { AlbumCandidate, AlbumQuery, StreamingId } from "./contracts.js";
import { createRememberedChoice, getLookupKey, isValidCandidate, type RememberedChoice } from "./resolution.js";

interface PreferenceState {
  version: 1;
  service?: StreamingId;
  choices: RememberedChoice[];
}
export interface PreferenceStorage {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}
function isService(value: unknown): value is StreamingId {
  return ["spotify", "deezer", "apple-music", "youtube-music", "amazon-music"].includes(String(value));
}
function validChoice(value: unknown): value is RememberedChoice {
  if (!value || typeof value !== "object") return false;
  const choice = value as RememberedChoice;
  if (typeof choice.key !== "string" || choice.key.length > 4096 || !isService(choice.service) ||
    !choice.artist || typeof choice.artist.id !== "string" || !choice.artist.id.trim() ||
    typeof choice.artist.name !== "string" || !choice.artist.name.trim()) return false;
  try {
    const key: unknown = JSON.parse(choice.key);
    if (!Array.isArray(key) || key[0] !== 2 || key[1] !== choice.service) return false;
  } catch { return false; }
  return !choice.album || (isValidCandidate(choice.album, choice.service) && choice.album.artists.some(artist => artist.id === choice.artist.id));
}
function decode(value: unknown): PreferenceState {
  if (value === undefined) return {version: 1, choices: []};
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
    !("choices" in value) || !Array.isArray(value.choices)) throw new Error("Não foi possível ler as preferências salvas.");
  return {version: 1, choices: structuredClone(value.choices.filter(validChoice)),
    ...("service" in value && isService(value.service) ? {service: value.service} : {})};
}

export class LibraryPreferences {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly storage: PreferenceStorage) {}
  private async read(): Promise<PreferenceState> { await this.writes; return decode(await this.storage.load()); }
  private mutate(change: (state: PreferenceState) => void): Promise<void> {
    const operation = this.writes.then(async () => {
      const state = decode(await this.storage.load());
      change(state);
      await this.storage.save(structuredClone(state));
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async getService(): Promise<StreamingId | undefined> { return (await this.read()).service; }
  setService(service: StreamingId): Promise<void> {
    if (!isService(service)) return Promise.reject(new TypeError("Streaming inválido."));
    return this.mutate(state => { state.service = service; });
  }
  async getChoice(query: AlbumQuery, service: StreamingId): Promise<RememberedChoice | undefined> {
    const key = getLookupKey(query, service);
    return (await this.read()).choices.find(choice => choice.key === key && choice.service === service);
  }
  async listChoices(): Promise<readonly RememberedChoice[]> { return (await this.read()).choices; }
  saveChoice(query: AlbumQuery, album: AlbumCandidate, artistId: string, rememberAlbum = false): Promise<void> {
    const choice = createRememberedChoice(query, album, artistId, rememberAlbum);
    return this.mutate(state => {
      state.choices = state.choices.filter(item => item.key !== choice.key);
      state.choices.push(choice);
    });
  }
  deleteChoice(key: string): Promise<void> {
    return this.mutate(state => { state.choices = state.choices.filter(choice => choice.key !== key); });
  }
}
