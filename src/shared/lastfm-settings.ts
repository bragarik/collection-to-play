/** Only trusted extension contexts may access the backing storage. */
export class LastfmSettings {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly storage: {load(): Promise<unknown>;save(value: string): Promise<void>;clear(): Promise<void>}) {}
  async apiKey(): Promise<string | undefined> {
    await this.writes;const value = await this.storage.load();
    return typeof value === "string" && /^[a-f0-9]{32}$/i.test(value) ? value : undefined;
  }
  async configured(): Promise<boolean> {
    await this.writes;
    const value = await this.storage.load();
    return typeof value === "string" && /^[a-f0-9]{32}$/i.test(value);
  }
  save(value: unknown): Promise<void> {
    if (typeof value !== "string" || !/^[a-f0-9]{32}$/i.test(value.trim())) return Promise.reject(new Error("Informe uma API key Last.fm válida com 32 caracteres hexadecimais."));
    const key = value.trim().toLowerCase();
    return this.mutate(() => this.storage.save(key));
  }
  clear(): Promise<void> {return this.mutate(() => this.storage.clear());}
  private mutate(operation: () => Promise<void>): Promise<void> {
    const next = this.writes.then(operation);this.writes = next.catch(() => {});return next;
  }
}
