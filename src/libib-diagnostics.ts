export type LibibOperation = "read-collection" | "read-details" | "update-item";
export type LibibCompatibilityState = "recognized" | "changed" | "unverified" | "not-applicable";
export interface LibibCompatibilityCheck {
  readonly operation: LibibOperation;
  readonly state: LibibCompatibilityState;
  readonly reason: "structure-found" | "title-element-missing" | "editor-fields-missing" |
    "loading" | "outside-library" | "not-observed" | "no-music-items" | "other-media" | "invalid-observation";
}
export interface LibibObservation {
  readonly page: "loading" | "ready" | "outside-library";
  readonly collection?: {readonly containerFound: boolean; readonly musicItems: number; readonly itemsWithTitleElement: number};
  readonly details?: {readonly music: boolean; readonly titleElementFound: boolean};
  readonly editor?: {readonly music: boolean; readonly titleFieldFound: boolean; readonly creatorFieldFound: boolean; readonly saveActionFound: boolean};
}

// These checks describe observed structure, never a guarantee that saving works.
export function assessLibibCompatibility(observation: LibibObservation): readonly LibibCompatibilityCheck[] {
  const operations: readonly LibibOperation[] = ["read-collection", "read-details", "update-item"];
  if (observation.page !== "ready") return operations.map(operation => ({operation,
    state: observation.page === "outside-library" ? "not-applicable" : "unverified",
    reason: observation.page === "outside-library" ? "outside-library" : "loading"}));
  const check = (operation: LibibOperation, state: LibibCompatibilityState, reason: LibibCompatibilityCheck["reason"]): LibibCompatibilityCheck => ({operation, state, reason});
  const collection = observation.collection;
  const validCounts = collection && [collection.musicItems, collection.itemsWithTitleElement].every(count => Number.isInteger(count) && count >= 0 && count <= 100000) && collection.itemsWithTitleElement <= collection.musicItems;
  const library = !collection ? check("read-collection", "unverified", "not-observed")
    : !validCounts ? check("read-collection", "unverified", "invalid-observation")
    : !collection.containerFound ? check("read-collection", "unverified", "not-observed")
    : collection.musicItems === 0 ? check("read-collection", "unverified", "no-music-items")
    : collection.itemsWithTitleElement < collection.musicItems ? check("read-collection", "changed", "title-element-missing")
    : check("read-collection", "recognized", "structure-found");
  const details = !observation.details ? check("read-details", "unverified", "not-observed")
    : !observation.details.music ? check("read-details", "not-applicable", "other-media")
    : !observation.details.titleElementFound ? check("read-details", "changed", "title-element-missing")
    : check("read-details", "recognized", "structure-found");
  const editor = !observation.editor ? check("update-item", "unverified", "not-observed")
    : !observation.editor.music ? check("update-item", "not-applicable", "other-media")
    : !observation.editor.titleFieldFound || !observation.editor.creatorFieldFound || !observation.editor.saveActionFound
      ? check("update-item", "changed", "editor-fields-missing") : check("update-item", "recognized", "structure-found");
  return [library, details, editor];
}

const codes = ["structure-recognized", "structure-changed", "structure-unverified", "request-failed", "response-invalid", "save-unconfirmed", "save-confirmed"] as const;
export type LibibDiagnosticCode = typeof codes[number];
export interface LibibDiagnosticEvent {
  readonly at: string;
  readonly operation: LibibOperation;
  readonly code: LibibDiagnosticCode;
  readonly extensionVersion?: string;
  readonly httpStatus?: number;
  readonly responseFormat?: "json" | "html" | "other";
  readonly reason?: LibibCompatibilityCheck["reason"];
}
export interface LibibDiagnosticReport {
  readonly format: "collection-to-play-libib";
  readonly schemaVersion: 1;
  readonly events: readonly LibibDiagnosticEvent[];
}
export const LIBIB_DIAGNOSTIC_LIMIT = 100;
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// An allowlist prevents caller-supplied bodies, URLs, messages and secrets from entering the report.
export function sanitizeLibibDiagnosticEvent(value: unknown): LibibDiagnosticEvent | undefined {
  const event = object(value);
  const at = event["at"], operation = event["operation"], code = event["code"];
  if (typeof at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) || !Number.isFinite(Date.parse(at))) return undefined;
  if (new Date(at).toISOString() !== at) return undefined;
  if (operation !== "read-collection" && operation !== "read-details" && operation !== "update-item") return undefined;
  if (typeof code !== "string" || !codes.includes(code as LibibDiagnosticCode)) return undefined;
  if (code.startsWith("save-") && operation !== "update-item") return undefined;
  const version = event["extensionVersion"], status = event["httpStatus"], responseFormat = event["responseFormat"];
  const reason = event["reason"];
  const allowedReasons: readonly string[] = ["structure-found", "title-element-missing", "editor-fields-missing", "loading", "outside-library", "not-observed", "no-music-items", "other-media", "invalid-observation"];
  return {at, operation, code: code as LibibDiagnosticCode,
    ...(typeof version === "string" && /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(version) ? {extensionVersion: version} : {}),
    ...(typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? {httpStatus: status} : {}),
    ...(responseFormat === "json" || responseFormat === "html" || responseFormat === "other" ? {responseFormat} : {}),
    ...(typeof reason === "string" && allowedReasons.includes(reason) ? {reason: reason as LibibCompatibilityCheck["reason"]} : {}),
  };
}

export function appendLibibDiagnostic(previous: unknown, value: unknown): LibibDiagnosticReport {
  const event = sanitizeLibibDiagnosticEvent(value);
  if (!event) throw new TypeError("Evento de diagnóstico Libib inválido.");
  let events: LibibDiagnosticEvent[] = [];
  if (previous !== undefined && previous !== null) {
    const report = object(previous);
    if (report["format"] !== "collection-to-play-libib" || report["schemaVersion"] !== 1 || !Array.isArray(report["events"])) {
      throw new TypeError("Formato de diagnóstico Libib desconhecido. Preserve o registro antes de atualizar.");
    }
    events = report["events"].slice(-(LIBIB_DIAGNOSTIC_LIMIT - 1)).flatMap(item => {
      const clean = sanitizeLibibDiagnosticEvent(item);
      return clean ? [clean] : [];
    });
  }
  return {format: "collection-to-play-libib", schemaVersion: 1, events: [...events, event]};
}
