import {descriptionText, assertDescriptionReplacement} from "../albums/album-description.js";
import {validateArtworkFile} from "./libib-metadata.js";
import {isSupportedCatalogUrl} from "../shared/contracts.js";
import type {LibibEditErrorCode} from "./libib-edit.js";

export type NativeSaveRequest = {readonly joinId: string; readonly libraryId: string; readonly media?: "music" | "movie"} & (
  | {readonly field: "title" | "creators"; readonly value: string; readonly titleOverride?: string}
  | {readonly field: "description"; readonly value: string; readonly expectedDescription: string; readonly descriptionConfirmed: true}
  | {readonly field: "image"; readonly value: File}
);
export interface NativeSaveOutcome {
  readonly confirmed: boolean;
  readonly writeMayHaveOccurred: boolean;
  readonly code?: LibibEditErrorCode;
  readonly httpStatus?: number;
}
interface NativeXHR {
  readonly status: number;
  readonly responseText: string;
  abort(): void;
}
type AjaxHandler = (event: unknown, xhr: NativeXHR, settings: Record<string, unknown>) => void;
interface JQuerySelection {
  on(events: string, handler: AjaxHandler): JQuerySelection;
  off(events: string): JQuerySelection;
  trigger(event: string): JQuerySelection;
  data(key: string): unknown;
}
export interface LibibJQuery { (target: Document | Element): JQuerySelection; }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function parseNativeSaveRequest(value: unknown): NativeSaveRequest | undefined {
  if (!record(value) || ![value["joinId"], value["libraryId"]].every(id => typeof id === "string" && /^[1-9]\d{0,19}$/.test(id))) return undefined;
  if (value["media"] !== undefined && value["media"] !== "music" && value["media"] !== "movie") return undefined;
  const media = value["media"] === "movie" ? {media: "movie" as const} : {};
  const field = value["field"], text = value["value"], override = value["titleOverride"];
  if (field === "description") {
    try {return value["descriptionConfirmed"] === true && typeof value["expectedDescription"] === "string" && value["expectedDescription"].length <= 200_000
      ? {...media, joinId: value["joinId"] as string, libraryId: value["libraryId"] as string, field, value: descriptionText(text), expectedDescription: value["expectedDescription"], descriptionConfirmed: true} : undefined;}
    catch {return undefined;}
  }
  if (field === "image") return text instanceof File && text.size > 0 && text.size <= 20_000_000
    ? {...media, joinId: value["joinId"] as string, libraryId: value["libraryId"] as string, field, value: text} : undefined;
  if ((field !== "title" && field !== "creators") || typeof text !== "string" || !text.trim() || text.length > (field === "title" ? 512 : 52_000)) return undefined;
  if (field === "title" && (typeof override !== "string" || override.length > 512)) return undefined;
  return {...media, joinId: value["joinId"] as string, libraryId: value["libraryId"] as string, field, value: text,
    ...(field === "title" ? {titleOverride: override as string} : {})};
}
export function isNativeSaveOutcome(value: unknown): value is NativeSaveOutcome {
  if (!record(value) || typeof value["confirmed"] !== "boolean" || typeof value["writeMayHaveOccurred"] !== "boolean") return false;
  if (value["httpStatus"] !== undefined && (!Number.isInteger(value["httpStatus"]) || Number(value["httpStatus"]) < 100 || Number(value["httpStatus"]) > 599)) return false;
  return value["confirmed"] ? value["writeMayHaveOccurred"] === true :
    typeof value["code"] === "string" && ["invalid-input", "invalid-context", "cancelled", "timeout", "network", "http", "invalid-response", "rejected"].includes(value["code"]);
}
function currentEditor(document: Document, request: NativeSaveRequest): HTMLElement | undefined {
  const roots = [...document.querySelectorAll<HTMLElement>(".jump-edit")].filter(root => root.isConnected && root.getClientRects().length &&
    document.defaultView?.getComputedStyle(root).visibility !== "hidden");
  const root = roots[0];
  return roots.length === 1 && root?.dataset["itemType"] === (request.media ?? "music") && root.dataset["joinId"] === request.joinId &&
    root.dataset["libraryId"] === request.libraryId ? root : undefined;
}

/** Uses Libib's real save handler so its private item/saved state stays consistent. */
export async function saveLibibNativeField(
  page: Window, jquery: LibibJQuery | undefined, value: unknown, signal: AbortSignal, timeoutMs = 20_000,
): Promise<NativeSaveOutcome> {
  const fail = (code: LibibEditErrorCode, sent = false, httpStatus?: number): NativeSaveOutcome =>
    ({confirmed: false, writeMayHaveOccurred: sent, code, ...(httpStatus ? {httpStatus} : {})});
  const request = parseNativeSaveRequest(value);
  if (!request) return fail("invalid-input");
  if (signal.aborted) return fail("cancelled");
  if (!isSupportedCatalogUrl(page.location.href) || typeof jquery !== "function") return fail("invalid-context");
  const root = currentEditor(page.document, request);
  if (!root) return fail("invalid-context");
  if (request.field === "image") {
    try {await validateArtworkFile(request.value);} catch {return fail("invalid-input");}
    if (signal.aborted) return fail("cancelled");
  }
  if (currentEditor(page.document, request) !== root) return fail("invalid-context");
  const data = jquery(root);
  if (String(data.data("join-id")) !== request.joinId || String(data.data("library-id")) !== request.libraryId || data.data("item-type") !== (request.media ?? "music")) return fail("invalid-context");
  const field = root.querySelector<HTMLElement>(`.jump-list [data-key="${request.field}"]`);
  const save = root.querySelector<HTMLButtonElement>("#jump-cover-save");
  if (!field || !save || save.disabled || save.classList.contains("loading")) return fail("invalid-context");
  try {jquery(field).trigger("click");} catch {return fail("invalid-context");}
  const form = root.querySelector<HTMLFormElement>("#quick-edit-form");
  const selector = request.field === "description" ? 'textarea[name="description"],input[name="description"]' : `input[name="${request.field}"]`;
  const input = form?.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  const override = form?.querySelector<HTMLInputElement>('input[name="title_override"]');
  if (!form || !input || input.disabled || form.querySelectorAll(selector).length !== 1 || (request.field === "title" && !override)) return fail("invalid-context");
  if (request.field === "description") {
    try {
      if (input.readOnly || input.getClientRects && !input.getClientRects().length || input.tagName !== "TEXTAREA" && !(input.tagName === "INPUT" && input.type === "text") || input.maxLength >= 0 && request.value.length > input.maxLength) return fail("invalid-context");
      assertDescriptionReplacement(input.value, {confirmed: request.descriptionConfirmed, expected: request.expectedDescription});
    } catch {return fail("invalid-context");}
  }
  const allowed = request.field === "title" ? ["title", "title_override"] : [request.field];
  if ([...form.querySelectorAll<HTMLInputElement>("input[name],textarea[name],select[name]")].some(control => !allowed.includes(control.name))) return fail("invalid-context");
  if (currentEditor(page.document, request) !== root || signal.aborted) return fail("invalid-context");
  if (request.field === "image") {
    if (input.type !== "file" || input.form !== form || !input.isConnected || input.classList.contains("no-post")) return fail("invalid-context");
    try {
      const Transfer = page.document.defaultView?.DataTransfer;
      if (!Transfer) return fail("invalid-context");
      const transfer = new Transfer(); transfer.items.add(request.value);
      (input as HTMLInputElement).files = transfer.files;
      if ((input as HTMLInputElement).files?.length !== 1 || (input as HTMLInputElement).files?.[0]?.size !== request.value.size) return fail("invalid-context");
    } catch {return fail("invalid-context");}
  } else input.value = request.value;
  if (request.field === "title" && override) override.value = request.titleOverride!;
  const controls = [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>("input,button,select,textarea")].map(control => ({control, disabled: control.disabled}));
  const namespace = `.collectionToPlay${crypto.randomUUID().replaceAll("-", "")}`;
  const bus = jquery(page.document);
  let xhr: NativeXHR | undefined;
  return new Promise(resolve => {
    let settled = false;
    const finish = (outcome: NativeSaveOutcome, abortXHR = false): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); bus.off(namespace); signal.removeEventListener("abort", abort);
      if (abortXHR) xhr?.abort();
      if (!outcome.confirmed && currentEditor(page.document, request) === root) {
        for (const {control, disabled} of controls) control.disabled = disabled;
        save.classList.remove("loading");
        root.querySelectorAll(".jump-close.disabled").forEach(close => close.classList.remove("disabled"));
      }
      resolve(outcome);
    };
    const matches = (settings: Record<string, unknown>): boolean => {
      try {
        const url = new URL(String(settings["url"]), page.location.href);
        const body = settings["data"];
        return url.origin === page.location.origin && url.pathname === "/quickedit/update-field/submit" &&
          String(settings["type"] ?? settings["method"]).toUpperCase() === "POST" && body instanceof FormData &&
          body.get("join_id") === request.joinId && body.get("library_id") === request.libraryId && body.get("item_type") === (request.media ?? "music") &&
          (request.field === "image" ? (() => {
            const file = body.get("image-0");
            return file instanceof File && file.size === request.value.size && file.name === request.value.name && file.type === request.value.type &&
              [...body.keys()].every(key => ["join_id", "library_id", "item_type", "image-0"].includes(key));
          })() : body.get(request.field) === request.value && (request.field !== "title" || body.get("title_override") === request.titleOverride));
      } catch {return false;}
    };
    bus.on(`ajaxSend${namespace}`, (_event, candidate, settings) => {if (!xhr && matches(settings)) xhr = candidate;});
    bus.on(`ajaxComplete${namespace}`, (_event, candidate) => {
      if (candidate !== xhr) return;
      if (candidate.status < 200 || candidate.status >= 300) {finish(fail("http", true, candidate.status)); return;}
      let result: unknown;
      try {result = JSON.parse(candidate.responseText);} catch {finish(fail("invalid-response", true, candidate.status)); return;}
      if (!record(result) || typeof result["outcome"] !== "string") {finish(fail("invalid-response", true, candidate.status)); return;}
      // ajaxComplete runs after Libib's .done callback updated its private cache.
      finish(result["outcome"] === "success" ? {confirmed: true, writeMayHaveOccurred: true, httpStatus: candidate.status} : fail("rejected", true, candidate.status));
    });
    const abort = (): void => finish(fail("cancelled", Boolean(xhr)), true);
    const timer = setTimeout(() => finish(fail("timeout", Boolean(xhr)), true), timeoutMs);
    signal.addEventListener("abort", abort, {once: true});
    if (signal.aborted || currentEditor(page.document, request) !== root) {abort(); return;}
    try {jquery(save).trigger("click");} catch {finish(fail("invalid-response", Boolean(xhr)), true);}
    if (!xhr && !settled) finish(fail("invalid-context"));
  });
}

export function registerLibibNativeBridge(page: Window, getJQuery: () => LibibJQuery | undefined): void {
  let active: {requestId: string; controller: AbortController} | undefined;
  page.addEventListener("message", event => {
    if (!event.isTrusted || event.source !== page || event.origin !== page.location.origin || !isSupportedCatalogUrl(page.location.href)) return;
    const message: unknown = event.data;
    if (!record(message) || typeof message["requestId"] !== "string" || !/^[\da-f-]{36}$/i.test(message["requestId"])) return;
    if (message["type"] === "collection-to-play:native-cancel") {if (active?.requestId === message["requestId"]) active.controller.abort(); return;}
    if (message["type"] !== "collection-to-play:native-save") return;
    const requestId = message["requestId"];
    const reply = (outcome: NativeSaveOutcome): void => page.postMessage({type: "collection-to-play:native-saved", requestId, outcome}, page.location.origin);
    if (active) {reply({confirmed: false, writeMayHaveOccurred: false, code: "invalid-context"}); return;}
    const controller = new AbortController(); active = {requestId, controller};
    void saveLibibNativeField(page, getJQuery(), message["request"], controller.signal)
      .then(reply, () => reply({confirmed: false, writeMayHaveOccurred: true, code: "invalid-response"}))
      .finally(() => {if (active?.requestId === requestId) active = undefined;});
  });
}
