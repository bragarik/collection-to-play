import {SpotifyClient, type SpotifyEnvironment} from "./spotify.js";
import {StreamingError} from "../albums/resolution.js";

/** Local application settings and sessions must change together. */
export class SpotifyApplication {
  private current!: SpotifyClient;
  private clientId = "";
  private generation = 0;
  private changes: Promise<void> = Promise.resolve();
  private sessionWrites: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;
  constructor(private readonly environment: Omit<SpotifyEnvironment, "clientId">, private readonly configuration: {
    load(): Promise<unknown>;
    save(clientId: string): Promise<void>;
  }) {
    this.ready = configuration.load().then(value => {
      if (value !== undefined && (typeof value !== "string" || !/^[a-f0-9]{32}$/i.test(value))) throw new Error("A configuração Spotify salva é inválida.");
      this.clientId = typeof value === "string" ? value.toLowerCase() : "";
      this.current = this.createClient();
    });
  }
  private createClient(): SpotifyClient {
    const generation = ++this.generation, clientId = this.clientId;
    const current = (): boolean => generation === this.generation;
    const write = (operation: () => Promise<void>): Promise<void> => {
      const next = this.sessionWrites.then(async () => {
        if (!current()) throw new StreamingError("cancelled", "O aplicativo Spotify mudou. Conecte novamente.");
        await operation();
      });
      this.sessionWrites = next.catch(() => {});return next;
    };
    return new SpotifyClient({...this.environment, clientId, store: {
      load: async () => {
        await this.sessionWrites;
        if (!clientId || !current()) return undefined;
        const session = await this.environment.store.load();
        return current() ? session : undefined;
      },
      save: session => write(() => this.environment.store.save(session)),
      clear: () => write(() => this.environment.store.clear()),
    }});
  }
  async get(): Promise<SpotifyClient> {await this.ready;await this.changes;return this.current;}
  async configuredClientId(): Promise<string> {await this.get();return this.clientId;}
  setClientId(value: unknown): Promise<void> {
    if (typeof value !== "string" || !/^[a-f0-9]{32}$/i.test(value.trim())) return Promise.reject(new StreamingError("invalid-query", "Informe um Client ID Spotify válido com 32 caracteres hexadecimais."));
    const clientId = value.trim().toLowerCase();
    const operation = this.changes.then(async () => {
      await this.ready;
      if (clientId === this.clientId) return;
      await this.current.disconnect();
      await this.configuration.save(clientId);
      this.clientId = clientId;this.current = this.createClient();
    });
    this.changes = operation.catch(() => {});return operation;
  }
}
