import {isSupportedCatalogUrl} from "./contracts.js";

export interface LibibEditTarget {
  readonly joinId: string;
  readonly libraryId: string;
}

export interface LibibEditSnapshot {
  readonly target: LibibEditTarget;
  readonly title: string;
  readonly titleOverride: string;
  readonly creators: readonly string[];
}

export type LibibEditOperation = "load" | "title" | "creators";
export type LibibEditErrorCode =
  | "invalid-input" | "invalid-context" | "cancelled" | "timeout"
  | "network" | "http" | "invalid-response" | "rejected";

const messages: Record<LibibEditErrorCode, string> = {
  "invalid-input": "Os dados para editar o item são inválidos.",
  "invalid-context": "Abra a biblioteca do Libib para editar o item.",
  cancelled: "A operação foi cancelada.",
  timeout: "O Libib demorou para responder.",
  network: "Não foi possível confirmar a resposta do Libib.",
  http: "O Libib não confirmou a requisição.",
  "invalid-response": "O Libib retornou uma resposta não reconhecida.",
  rejected: "O Libib não confirmou a operação.",
};

export class LibibEditError extends Error {
  constructor(
    readonly code: LibibEditErrorCode,
    readonly operation: LibibEditOperation,
    // A failed response does not prove that an update was not applied.
    readonly writeMayHaveOccurred = false,
    readonly httpStatus?: number,
  ) {
    super(messages[code]);
    this.name = "LibibEditError";
  }
}

export function isLibibEditError(value: unknown): value is LibibEditError {
  return value instanceof Error && value.name === "LibibEditError" &&
    "code" in value && typeof value.code === "string" && Object.hasOwn(messages, value.code) &&
    "operation" in value && ["load", "title", "creators"].includes(String(value.operation)) &&
    "writeMayHaveOccurred" in value && typeof value.writeMayHaveOccurred === "boolean";
}

export interface LibibFieldConfirmation {
  readonly target: LibibEditTarget;
  readonly field: "title" | "creators";
  readonly confirmed: true;
}

interface ClientOptions {
  readonly pageUrl: () => string;
  readonly isCurrent?: () => boolean;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function targetCopy(target: LibibEditTarget, operation: LibibEditOperation): LibibEditTarget {
  if (!record(target) || ![target.joinId, target.libraryId].every(
    value => typeof value === "string" && /^[1-9]\d{0,19}$/.test(value),
  )) throw new LibibEditError("invalid-input", operation);
  return {joinId: target.joinId, libraryId: target.libraryId};
}

function titleValid(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

/** Same-origin client for the native music editor; it never opens a player. */
export class LibibEditClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ClientOptions) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 20_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new TypeError("Invalid timeout");
  }

  async load(target: LibibEditTarget, signal?: AbortSignal): Promise<LibibEditSnapshot> {
    const current = targetCopy(target, "load");
    const data = await this.request(
      `/quickedit/load-fields/${current.joinId}`, new URLSearchParams({item_type: "music"}), "load", signal,
    );
    const item = data.item;
    const fields = data.input_fields;
    if (!record(item) || !record(fields)) throw new LibibEditError("invalid-response", "load");
    // The native editor represents missing creators as either [] or "".
    const creators: unknown = item.creators === "" ? [] : item.creators;
    if (!titleValid(item.title) ||
      typeof item.title_override !== "string" || item.title_override.length > 512 ||
      !Array.isArray(creators) || !creators.every(value => typeof value === "string") ||
      typeof fields.title !== "string" || typeof fields.creators !== "string") {
      throw new LibibEditError("invalid-response", "load");
    }
    // Keep only the values needed for editing; never execute returned HTML.
    return {target: current, title: item.title, titleOverride: item.title_override, creators: [...creators]};
  }

  async saveTitle(target: LibibEditTarget, title: string, signal?: AbortSignal): Promise<LibibFieldConfirmation> {
    const current = targetCopy(target, "title");
    if (!titleValid(title)) throw new LibibEditError("invalid-input", "title");
    // Read immediately before writing instead of reusing an old sort override.
    const snapshot = await this.load(current, signal);
    return this.save(current, "title", {title, title_override: snapshot.titleOverride}, signal);
  }

  async saveCreators(target: LibibEditTarget, creators: string, signal?: AbortSignal): Promise<LibibFieldConfirmation> {
    const current = targetCopy(target, "creators");
    // This is the native input's text, not an inferred array serialization.
    if (typeof creators !== "string" || !creators.trim()) throw new LibibEditError("invalid-input", "creators");
    return this.save(current, "creators", {creators}, signal);
  }

  private async save(
    target: LibibEditTarget, field: "title" | "creators", values: Record<string, string>, signal?: AbortSignal,
  ): Promise<LibibFieldConfirmation> {
    const body = new FormData();
    for (const [key, value] of Object.entries({join_id: target.joinId, item_type: "music", library_id: target.libraryId, ...values})) {
      body.set(key, value);
    }
    await this.request("/quickedit/update-field/submit", body, field, signal);
    return {target: {...target}, field, confirmed: true};
  }

  private async request(
    path: string, body: URLSearchParams | FormData, operation: LibibEditOperation, signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (!isSupportedCatalogUrl(this.options.pageUrl()) || this.options.isCurrent?.() === false) throw new LibibEditError("invalid-context", operation);
    if (signal?.aborted) throw new LibibEditError("cancelled", operation);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, {once: true});
    let timedOut = false;
    const timer = setTimeout(() => {timedOut = true; controller.abort();}, this.timeoutMs);
    const writing = operation !== "load";
    let status: number | undefined;
    try {
      const headers: Record<string, string> = {Accept: "*/*", "X-Requested-With": "XMLHttpRequest"};
      if (body instanceof URLSearchParams) headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      const response = await this.fetcher(`https://www.libib.com${path}`, {
        method: "POST", body, headers, credentials: "include", redirect: "error", signal: controller.signal,
      });
      status = response.status;
      if (!response.ok) throw new LibibEditError("http", operation, writing, status);
      let data: unknown;
      try { data = await response.json(); }
      catch {
        if (controller.signal.aborted) throw new LibibEditError(timedOut ? "timeout" : "cancelled", operation, writing, status);
        throw new LibibEditError("invalid-response", operation, writing, status);
      }
      if (controller.signal.aborted) throw new LibibEditError(timedOut ? "timeout" : "cancelled", operation, writing, status);
      if (!record(data) || typeof data.outcome !== "string") throw new LibibEditError("invalid-response", operation, writing, status);
      if (data.outcome !== "success") throw new LibibEditError("rejected", operation, writing, status);
      return data;
    } catch (error) {
      if (error instanceof LibibEditError) throw error;
      throw new LibibEditError(timedOut ? "timeout" : signal?.aborted ? "cancelled" : "network", operation, writing, status);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
}
