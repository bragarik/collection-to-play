import { appendLibibDiagnostic, assessLibibCompatibility, sanitizeLibibDiagnosticEvent, LIBIB_DIAGNOSTIC_LIMIT, type LibibCompatibilityCheck, type LibibDiagnosticReport, type LibibObservation } from "./libib-diagnostics.js";

export interface LibibDiagnosticsState {
  readonly format: "collection-to-play-libib-state";
  readonly schemaVersion: 1;
  readonly latest: {readonly at: string; readonly extensionVersion: string; readonly checks: readonly LibibCompatibilityCheck[]};
  readonly report: LibibDiagnosticReport;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function sanitizeLibibDiagnosticsState(value: unknown): LibibDiagnosticsState | undefined {
  if (value === undefined || value === null) return undefined;
  const data = object(value), report = object(data["report"]), latest = object(data["latest"]);
  const invalid = (): never => {throw new TypeError("Formato de diagnóstico Libib desconhecido ou inválido.");};
  if (data["format"] !== "collection-to-play-libib-state" || data["schemaVersion"] !== 1 ||
    report["format"] !== "collection-to-play-libib" || report["schemaVersion"] !== 1 || !Array.isArray(report["events"]) || !Array.isArray(latest["checks"]) || latest["checks"].length !== 3) return invalid();
  const metadata = sanitizeLibibDiagnosticEvent({at: latest["at"], extensionVersion: latest["extensionVersion"], operation: "read-collection", code: "structure-unverified"});
  if (!metadata?.extensionVersion) return invalid();
  const operations = ["read-collection", "read-details", "update-item"] as const;
  const checks: LibibCompatibilityCheck[] = latest["checks"].map(value => {
    const check = object(value);
    const operation = operations.find(operation => operation === check["operation"]);
    const state = check["state"], reason = check["reason"];
    const known = sanitizeLibibDiagnosticEvent({at: metadata.at, code: "structure-unverified", operation, reason});
    if (!operation || !known?.reason ||
      !(state === "recognized" && reason === "structure-found" ||
        state === "changed" && (reason === "title-element-missing" || reason === "editor-fields-missing") ||
        state === "unverified" && ["loading", "not-observed", "no-music-items", "invalid-observation"].includes(String(reason)) ||
        state === "not-applicable" && (reason === "outside-library" || reason === "other-media"))) return invalid();
    if (reason === "editor-fields-missing" && operation !== "update-item" || reason === "title-element-missing" && operation === "update-item") return invalid();
    return {operation, state, reason: known.reason};
  });
  if (checks.length !== operations.length || operations.some(operation => checks.filter(check => check.operation === operation).length !== 1)) return invalid();
  const events = report["events"].slice(-LIBIB_DIAGNOSTIC_LIMIT).flatMap(value => {
    const event = sanitizeLibibDiagnosticEvent(value);
    return event ? [event] : [];
  });
  return {format: "collection-to-play-libib-state", schemaVersion: 1,
    latest: {at: metadata.at, extensionVersion: metadata.extensionVersion, checks},
    report: {format: "collection-to-play-libib", schemaVersion: 1, events}};
}
function observationFrom(value: unknown): LibibObservation {
  const data = object(value);
  const collection = object(data["collection"]);
  if ((data["page"] !== "loading" && data["page"] !== "ready") || typeof collection["containerFound"] !== "boolean" ||
    ![collection["musicItems"], collection["itemsWithTitleElement"]].every(count => typeof count === "number" && Number.isInteger(count) && count >= 0 && count <= 100000) ||
    (collection["itemsWithTitleElement"] as number) > (collection["musicItems"] as number)) throw new TypeError("Observação Libib inválida.");
  const details = object(data["details"]);
  if (data["details"] !== undefined && (typeof details["music"] !== "boolean" || typeof details["titleElementFound"] !== "boolean")) throw new TypeError("Observação Libib inválida.");
  return {page: data["page"], collection: {containerFound: collection["containerFound"],
    musicItems: collection["musicItems"] as number, itemsWithTitleElement: collection["itemsWithTitleElement"] as number},
    ...(data["details"] !== undefined ? {details: {music: details["music"] as boolean, titleElementFound: details["titleElementFound"] as boolean}} : {}),
  };
}

export class LibibDiagnosticsStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly storage: {load(): Promise<unknown>; save(value: LibibDiagnosticsState): Promise<void>},
    private readonly extensionVersion: string, private readonly now: () => Date = () => new Date()) {}

  async read(): Promise<LibibDiagnosticsState | undefined> {
    await this.queue;
    return sanitizeLibibDiagnosticsState(await this.storage.load());
  }

  record(value: unknown): Promise<{recorded: boolean}> {
    const work = this.queue.then(async () => {
      const observation = observationFrom(value);
      const stored = await this.storage.load();
      const previous = object(stored);
      const reportValue = object(previous["report"]);
      if (stored !== undefined && stored !== null && (previous["format"] !== "collection-to-play-libib-state" || previous["schemaVersion"] !== 1 ||
        reportValue["format"] !== "collection-to-play-libib" || reportValue["schemaVersion"] !== 1 || !Array.isArray(reportValue["events"]))) {
        throw new TypeError("Versão de diagnóstico Libib desconhecida. Preserve o registro antes de atualizar.");
      }
      const latest = object(previous["latest"]);
      const oldChecks = Array.isArray(latest["checks"]) ? latest["checks"] : [];
      const checks = assessLibibCompatibility(observation);
      const changed = checks.filter(check => !oldChecks.some(value => {
        const old = object(value);
        return old["operation"] === check.operation && old["state"] === check.state && old["reason"] === check.reason;
      }));
      if (changed.length === 0 && latest["extensionVersion"] === this.extensionVersion) return {recorded: false};
      const at = this.now().toISOString();
      let report = previous["report"] as LibibDiagnosticReport | undefined;
      for (const check of changed.length ? changed : checks) {
        report = appendLibibDiagnostic(report, {at, operation: check.operation, reason: check.reason,
          code: check.state === "recognized" ? "structure-recognized" : check.state === "changed" ? "structure-changed" : "structure-unverified",
          extensionVersion: this.extensionVersion});
      }
      await this.storage.save({format: "collection-to-play-libib-state", schemaVersion: 1,
        latest: {at, extensionVersion: this.extensionVersion, checks}, report: report!});
      return {recorded: true};
    });
    this.queue = work.then(() => undefined, () => undefined);
    return work;
  }
}
