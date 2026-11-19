import {mountEditorAction, mountEditorShell, unmountEditorAction} from "../components/catalog-ui.js";
import {isSupportedCatalogUrl} from "../shared/contracts.js";
import {manualEntryFields} from "../shared/manual-entry-fields.js";
import {readLibibItemFields, prepareLibibItemFields, validateLibibItemText, libibItemFieldContext} from "./libib-item-fields.js";
import {descriptionLimit, descriptionText, assertDescriptionReplacement} from "../albums/album-description.js";
import {prepareAlbumMetadata, validateArtworkFile} from "./libib-metadata.js";

interface EntryContext {
  form: HTMLFormElement;
  collection: string;
  media: "movie" | "music";
  controls: Map<string, HTMLInputElement | HTMLTextAreaElement>;
}
const baseFields = ["title", "creators", "description", "image"];
export function readLibibManualEntry(form: HTMLFormElement): EntryContext | undefined {
  if (!form.isConnected || !form.getClientRects().length || form.id !== "manual-entry-form" || form.method.toLowerCase() !== "post") return;
  const page = form.ownerDocument.defaultView;
  if (!page || !isSupportedCatalogUrl(page.location.href)) return;
  const action = new URL(form.action, page.location.href);
  if (action.origin !== page.location.origin || action.pathname !== "/library/manual-entry/submit") return;
  const collection = form.querySelector<HTMLSelectElement>("#manual-entry-library-select")?.value;
  const media = form.querySelector<HTMLInputElement>('input[name="manual-entry-type"]:checked')?.value;
  if (!collection || !/^[1-9]\d*$/.test(collection) || (media !== "movie" && media !== "music")) return;
  const controls = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  for (const name of baseFields) {
    const nodes = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`input[name="${name}"],textarea[name="${name}"]`);
    const control = nodes[0];
    if (nodes.length !== 1 || !control || control.disabled || control.readOnly || control.form !== form) continue;
    if (name === "image" ? control.type !== "file" : control.tagName !== "TEXTAREA" && control.type !== "text") continue;
    controls.set(name, control);
  }
  for (const [name, control] of readLibibItemFields(form, media)) controls.set(name, control);
  if (!baseFields.every(name => controls.has(name))) return;
  const movieFields = Boolean(form.querySelector('[name="ensemble"]') || form.querySelector('[name="aspect_ratio"]'));
  if (media === "movie" && (!controls.has("ensemble") || !controls.has("aspect_ratio")) || media === "music" && movieFields) return;
  return {form, collection, media, controls};
}
function sameContext(context: EntryContext): boolean {
  const current = readLibibManualEntry(context.form);
  return Boolean(current && current.collection === context.collection && current.media === context.media &&
    [...context.controls].every(([key, control]) => current.controls.get(key) === control));
}
export async function fillLibibManualEntry(context: EntryContext, patch: unknown, replacement: unknown, active: () => boolean): Promise<void> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Escolha os campos para preencher.");
  const changes = Object.entries(patch);
  if (!changes.length) throw new Error("Escolha os campos para preencher.");
  const prepared = new Map<HTMLInputElement | HTMLTextAreaElement, string>();
  const extraValues: Record<string, unknown> = {};
  let image: HTMLInputElement | undefined;
  let files: FileList | undefined;
  const assertCurrent = () => {
    if (!active() || !sameContext(context)) throw new Error("A coleção, o tipo ou os campos mudaram. Reabra a busca.");
  };
  assertCurrent();
  for (const [key, value] of changes) {
    const creatorKey = context.media === "music" ? "artists" : "directors";
    const name = key === creatorKey ? "creators" : key === "artwork" ? "image" : key;
    if (![...baseFields, ...manualEntryFields(context.media).map(field => field.key)].includes(name) || key === "creators" || key === "image") {
      throw new Error("Campo não disponível para inclusão.");
    }
    const control = context.controls.get(name);
    if (!control) throw new Error("Um campo selecionado não está disponível.");
    if (key === "artwork") {
      const file = await validateArtworkFile(value);
      assertCurrent();
      const Transfer = context.form.ownerDocument.defaultView?.DataTransfer;
      if (!Transfer) throw new Error("O navegador não permitiu preparar a capa.");
      const transfer = new Transfer();
      transfer.items.add(file);
      image = control as HTMLInputElement;
      files = transfer.files;
    } else if (key === creatorKey) {
      const text = prepareAlbumMetadata({title: "Vídeo", artists: value}).creatorsText;
      if (control.maxLength >= 0 && text.length > control.maxLength) throw new Error("Diretores excedem o limite do campo.");
      prepared.set(control, text);
    } else if (key === "description") {
      const confirmation = replacement as {confirmed: boolean; expected: string} | undefined;
      assertDescriptionReplacement(control.value, confirmation);
      prepared.set(control, descriptionText(value, descriptionLimit(control.maxLength)));
    } else if (key === "title") prepared.set(control, validateLibibItemText("title", value, control.maxLength));
    else extraValues[key] = value;
  }
  for (const [control, value] of prepareLibibItemFields(readLibibItemFields(context.form, context.media), extraValues)) prepared.set(control, value);
  assertCurrent();
  const previous = [...prepared].map(([control]) => ({control, value: control.value}));
  const oldFiles = image?.files;
  try {
    if (image && files) image.files = files;
    for (const [control, value] of prepared) control.value = value;
  } catch {
    for (const {control, value} of previous) control.value = value;
    if (image && oldFiles) image.files = oldFiles;
    throw new Error("Não foi possível preencher os campos.");
  }
  if (image && files) image.dispatchEvent(new Event("change", {bubbles: true}));
}

export function createLibibManualEntry(document: Document, resourceUrl: (path: string) => string, preferredService: () => string = () => "spotify") {
  let mounted: {form: HTMLFormElement; media: "music" | "movie"; dispose(): void} | undefined;
  function stop() {mounted?.dispose(); mounted = undefined;}
  function sync() {
    const form = document.querySelector<HTMLFormElement>("#manual-entry-form");
    if (mounted && (mounted.form !== form || !form || readLibibManualEntry(form)?.media !== mounted.media)) stop();
    if (mounted || !form || !readLibibManualEntry(form)) return;
    const media = readLibibManualEntry(form)!.media;
    const submit = form.querySelector("#manual-entry-submit");
    if (!submit) return;
    const actionHost = document.createElement("span");
    const action = mountEditorAction(actionHost, true, "Buscar dados nos serviços");
    action.style.marginInlineEnd = "8px";
    submit.before(actionHost);
    const host = document.createElement("div");
    const shadow = host.attachShadow({mode: "open"});
    const ui = mountEditorShell(shadow, resourceUrl, "Preencher entrada manual");
    form.append(host);
    let context: EntryContext | undefined;
    let session = "";
    let busy = false;
    const extensionUrl = new URL(resourceUrl(""));
    const origin = `${extensionUrl.protocol}//${extensionUrl.host}`;
    const active = () => Boolean(session && ui.dialog.open && context && sameContext(context));
    function close() {
      if (busy) return;
      session = "";
      context = undefined;
      ui.dialog.close();
      ui.update({frameSrc: "about:blank"});
    }
    action.addEventListener("click", () => {
      if (ui.dialog.open) return;
      context = readLibibManualEntry(form);
      if (!context) return;
      session = crypto.randomUUID();
      const url = new URL(resourceUrl("metadata-editor.html"));
      url.search = new URLSearchParams({media: context.media, editor: "manual", selective: "true", service: preferredService(), session,
        title: context.controls.get("title")!.value, artist: context.controls.get("creators")!.value, source: document.location.href}).toString();
      ui.update({frameSrc: url.href, frameHidden: false, statusHidden: true});
      ui.dialog.showModal();
    });
    ui.close.addEventListener("click", close);
    ui.dialog.addEventListener("cancel", event => {event.preventDefault(); close();});
    async function receive(event: MessageEvent) {
      if (!event.isTrusted || event.source !== ui.frame.contentWindow || event.origin !== origin ||
        !event.data || event.data.session !== session || !active() || !context) return;
      const message = event.data;
      if (message.type === "collection-to-play:description-context-request") {
        ui.frame.contentWindow?.postMessage({type: "collection-to-play:description-context", session,
          available: true, description: context.controls.get("description")!.value,
          maxLength: descriptionLimit(context.controls.get("description")!.maxLength),
          ...libibItemFieldContext(readLibibItemFields(context.form, context.media))}, origin);
      }
      if (message.type !== "collection-to-play:apply-metadata" || typeof message.requestId !== "string" || message.requestId.length > 100 || busy) return;
      busy = true;
      ui.update({closeDisabled: true});
      try {
        await fillLibibManualEntry(context, message.patch, message.descriptionReplacement, active);
        ui.frame.contentWindow?.postMessage({type: "collection-to-play:metadata-applied", session, requestId: message.requestId, filled: true}, origin);
        busy = false;
        close();
        action.focus();
      } catch (error) {
        ui.frame.contentWindow?.postMessage({type: "collection-to-play:metadata-applied", session, requestId: message.requestId,
          error: error instanceof Error ? error.message : "Não foi possível preencher."}, origin);
      } finally {busy = false; ui.update({closeDisabled: false});}
    }
    const change = () => {
      if (context && !sameContext(context)) {
        session = "";
        context = undefined;
        if (!busy) close();
      }
      sync();
    };
    document.defaultView?.addEventListener("message", receive);
    form.addEventListener("change", change);
    mounted = {form, media, dispose() {
      session = "";
      document.defaultView?.removeEventListener("message", receive);
      form.removeEventListener("change", change);
      ui.dialog.close();
      ui.dispose();
      unmountEditorAction(actionHost);
      actionHost.remove();
      host.remove();
    }};
  }
  return {sync, stop};
}
