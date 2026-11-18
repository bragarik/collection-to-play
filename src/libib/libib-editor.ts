import {DESCRIPTION_LIMIT, descriptionLimit, descriptionText, assertDescriptionReplacement, type DescriptionReplacement} from "../albums/album-description.js";
import {mountEditorAction, mountEditorShell, unmountEditorAction} from "../components/catalog-ui.js";
import {isSupportedCatalogUrl} from "../shared/contracts.js";
import {LibibEditClient, LibibEditError} from "./libib-edit.js";
import {isNativeSaveOutcome, type NativeSaveRequest, type NativeSaveOutcome} from "./libib-native.js";
import {applyLibibMetadata, applyLibibPatch, describeLibibPatchResult, describeLibibApplyResult, prepareAlbumMetadata} from "./libib-metadata.js";
import {readLibibFullEditor, fillLibibFullEditor, fillLibibFullEditorPatch} from "./libib-full-editor.js";
import {createLibibEditDiagnostics} from "./libib-edit-diagnostics.js";
import type {LibibEditDiagnostic} from "./libib-diagnostics.js";

interface EditorOptions {
  readonly document: Document;
  readonly pageUrl: () => string;
  readonly service: () => string;
  readonly resourceUrl: (path: string) => string;
  readonly recordDiagnostic?: (event: LibibEditDiagnostic) => Promise<unknown>;
}

interface MountedEditor {
  readonly identity: string;
  readonly menu: Element;
  readonly action: HTMLElement;
  readonly host: HTMLElement;
  close(): void;
  remove(): void;
}

function visible(root: HTMLElement): boolean {
  return root.isConnected && root.getClientRects().length > 0 &&
    root.ownerDocument.defaultView?.getComputedStyle(root).visibility !== "hidden";
}

/** Adds streaming metadata selection to quick and full native music editors. */
export function createLibibEditor(options: EditorOptions): {sync(): void; stop(): void} {
  const document = options.document;
  const mounted = new Map<HTMLElement, MountedEditor>();
  const identity = (root: HTMLElement): string | undefined => {
    if (root.matches("#edit-item-form")) {
      const context = readLibibFullEditor(root as HTMLFormElement, options.pageUrl(), true);
      return context ? JSON.stringify([options.pageUrl(), "full", context.media, context.joinId]) : undefined;
    }
    if (!isSupportedCatalogUrl(options.pageUrl()) || !visible(root) || !["music", "movie"].includes(root.dataset["itemType"] ?? "") ||
      !/^[1-9]\d{0,19}$/.test(root.dataset["joinId"] ?? "") ||
      !/^[1-9]\d{0,19}$/.test(root.dataset["libraryId"] ?? "")) return undefined;
    return JSON.stringify([options.pageUrl(), root.dataset["itemType"], root.dataset["joinId"], root.dataset["libraryId"]]);
  };

  function mount(root: HTMLElement, menu: Element, key: string): MountedEditor {
    const full = root.matches("#edit-item-form");
    const diagnostics = createLibibEditDiagnostics(full ? "full" : "quick", options.recordDiagnostic);
    const movie = full ? readLibibFullEditor(root as HTMLFormElement, options.pageUrl(), true)?.media === "movie" : root.dataset["itemType"] === "movie";
    const label = movie ? "Atualizar dados via TMDb" : "Atualizar dados via streaming";
    const actionHost = document.createElement(full ? "span" : "li");
    const action = mountEditorAction(actionHost, full, label);
    const host = document.createElement("div");
    host.dataset["collectionToPlayEditor"] = "";
    const shadow = host.attachShadow({mode: "open"});
    const ui = mountEditorShell(shadow, options.resourceUrl, label);
    const {dialog, close, frame} = ui;
    root.append(host);
    if (full) {
      const cancel = [...root.querySelectorAll<HTMLElement>('[id="edit-item-cancel"]')].at(-1);
      const save = root.querySelector<HTMLElement>("#edit-item-submit") ?? root.querySelector<HTMLElement>('input[type="submit"]:not([id="edit-item-cancel"]), button[type="submit"]:not([id="edit-item-cancel"])');
      if (cancel) {
        const nativeStyle = document.defaultView?.getComputedStyle(cancel);
        if (nativeStyle) for (const property of ["background-color", "color", "border", "border-radius", "padding", "font", "line-height", "letter-spacing", "text-transform", "text-decoration", "box-shadow", "vertical-align", "display"]) {
          action.style.setProperty(property, nativeStyle.getPropertyValue(property));
        }
        action.style.setProperty("margin-inline-end", "8px");
        if (save) save.before(actionHost); else cancel.after(actionHost);
      }
    } else menu.prepend(actionHost);
    let controller: AbortController | undefined;
    let session = "";
    let descriptionBaseline: string | undefined;
    let descriptionMaxLength = DESCRIPTION_LIMIT;
    let applying = false;
    const current = (): boolean => identity(root) === key && dialog.open;
    const client = new LibibEditClient({pageUrl: options.pageUrl, isCurrent: current, media: movie ? "movie" : "music"});
    const saveNative = (originalRequest: NativeSaveRequest, signal?: AbortSignal): Promise<NativeSaveOutcome> => new Promise(resolve => {
      const request = movie ? {...originalRequest, media: "movie" as const} : originalRequest;
      const page = document.defaultView;
      if (!page || !current() || !signal || signal.aborted) {
        resolve({confirmed: false, writeMayHaveOccurred: false, code: "invalid-context"}); return;
      }
      const requestId = crypto.randomUUID();
      const finish = (outcome: NativeSaveOutcome): void => {
        clearTimeout(timer); page.removeEventListener("message", receive); signal.removeEventListener("abort", abort);
        resolve(outcome);
      };
      const receive = (event: MessageEvent): void => {
        if (!event.isTrusted || event.source !== page || event.origin !== page.location.origin || !event.data || typeof event.data !== "object") return;
        const message = event.data as Record<string, unknown>;
        if (message["type"] === "collection-to-play:native-saved" && message["requestId"] === requestId && isNativeSaveOutcome(message["outcome"])) finish(message["outcome"]);
      };
      const cancel = (): void => page.postMessage({type: "collection-to-play:native-cancel", requestId}, page.location.origin);
      const abort = (): void => {cancel(); finish({confirmed: false, writeMayHaveOccurred: true, code: "cancelled"});};
      const timer = setTimeout(() => {cancel(); finish({confirmed: false, writeMayHaveOccurred: true, code: "timeout"});}, 25_000);
      page.addEventListener("message", receive); signal.addEventListener("abort", abort, {once: true});
      page.postMessage({type: "collection-to-play:native-save", requestId, request}, page.location.origin);
    });
    const confirmNative = async (request: Extract<NativeSaveRequest, {field: "title" | "creators"}>, signal?: AbortSignal) => {
      const outcome = await saveNative(request, signal);
      diagnostics.native(request.field, outcome);
      if (!outcome.confirmed) throw new LibibEditError(outcome.code ?? "invalid-response", request.field, outcome.writeMayHaveOccurred, outcome.httpStatus);
      return {target: {joinId: request.joinId, libraryId: request.libraryId}, field: request.field, confirmed: true as const};
    };
    const nativeClient: Pick<LibibEditClient, "saveTitle" | "saveCreators"> = {
      async saveTitle(target, title, signal) {
        const snapshot = await diagnostics.read(() => client.load(target, signal));
        return confirmNative({...target, field: "title", value: title, titleOverride: snapshot.titleOverride}, signal);
      },
      async saveCreators(target, creators, signal) {return confirmNative({...target, field: "creators", value: creators}, signal);},
    };
    const reset = (): void => {
      controller?.abort(); controller = undefined;
      session = "";descriptionBaseline = undefined;descriptionMaxLength = DESCRIPTION_LIMIT;
      ui.update({frameSrc: "about:blank", frameHidden: true});
    };
    const hide = (): void => {if (dialog.open) dialog.close(); reset();};
    dialog.addEventListener("close", reset);
    dialog.addEventListener("cancel", event => {if (applying) event.preventDefault();});
    close.addEventListener("click", hide);
    const open = async (): Promise<void> => {
      if (dialog.open || identity(root) !== key) return;
      controller = new AbortController();
      session = crypto.randomUUID();
      const signal = controller.signal;
      ui.update({frameHidden: true, statusHidden: false, status: "Carregando dados do item…"});
      dialog.showModal();
      close.focus();
      try {
        const context = full ? readLibibFullEditor(root as HTMLFormElement, options.pageUrl(), true) : undefined;
        if (full && !context) throw new Error("A edição mudou. Reabra a busca neste item.");
        const snapshot = context ? {title: context.title.value, artist: context.creators.value, description: context.description?.value, maxLength: context.description?.maxLength} : await diagnostics.read(() => client.load({joinId: root.dataset["joinId"]!, libraryId: root.dataset["libraryId"]!}, signal)).then(item => ({title: item.title, artist: item.creators.join(", "), description: item.description, maxLength: item.descriptionMaxLength}));
        descriptionMaxLength = descriptionLimit(snapshot.maxLength);
        descriptionBaseline = typeof snapshot.description === "string" && snapshot.description.length <= 200_000 ? snapshot.description : undefined;
        if (signal.aborted || !dialog.open || identity(root) !== key) {hide(); return;}
        const url = new URL(options.resourceUrl("metadata-editor.html"));
        url.searchParams.set("mode", "metadata");
        url.searchParams.set("selective", "true");
        if (full) url.searchParams.set("editor", "full");
        if (movie) url.searchParams.set("media", "movie");
        url.searchParams.set("session", session);
        url.searchParams.set("service", options.service());
        url.searchParams.set("title", snapshot.title);
        url.searchParams.set("artist", snapshot.artist);
        url.searchParams.set("source", options.pageUrl());
        ui.update({frameSrc: url.href, frameHidden: false, statusHidden: true});
      } catch (error) {
        if (signal.aborted || !dialog.open) return;
        ui.update({status: error instanceof Error ? error.message : "Não foi possível carregar o item."});
      }
    };
    const receive = async (event: MessageEvent): Promise<void> => {
      const origin = new URL(options.resourceUrl(""));
      if (!event.isTrusted || event.source !== frame.contentWindow || event.origin !== `${origin.protocol}//${origin.host}` || !session) return;
      const data: unknown = event.data;
      if (!data || typeof data !== "object") return;
      const message = data as Record<string, unknown>;
      if (message["type"] === "collection-to-play:description-context-request" && message["session"] === session && current()) {
        frame.contentWindow?.postMessage({type: "collection-to-play:description-context", session, available: descriptionBaseline !== undefined,
          ...(descriptionBaseline !== undefined ? {description: descriptionBaseline, maxLength: descriptionMaxLength} : {})}, `${origin.protocol}//${origin.host}`);return;
      }
      if (message["type"] !== "collection-to-play:apply-metadata" || message["session"] !== session ||
        typeof message["requestId"] !== "string" || message["requestId"].length > 100) return;
      const reply = (value: object): void => frame.contentWindow?.postMessage({type: "collection-to-play:metadata-applied", session, requestId: message["requestId"], ...value}, `${origin.protocol}//${origin.host}`);
      if (!current()) {reply({error: "A edição mudou. Reabra a busca no item que deseja alterar."}); return;}
      if (applying) {reply({error: "Aguarde a gravação em andamento."}); return;}
      applying = true; ui.update({closeDisabled: true});
      try {
        const rawPatch = message["patch"], rawReplacement = message["descriptionReplacement"];
        const hasDescription = rawPatch && typeof rawPatch === "object" && "description" in rawPatch;
        let replacement: DescriptionReplacement | undefined;
        if (hasDescription) {
          if (!rawReplacement || typeof rawReplacement !== "object" || !("confirmed" in rawReplacement) || !("expected" in rawReplacement) || rawReplacement.confirmed !== true || typeof rawReplacement.expected !== "string") throw new Error("Confirme a substituição da descrição atual.");
          replacement = {confirmed: true, expected: rawReplacement.expected};
          assertDescriptionReplacement(descriptionBaseline, replacement);
          if (!full) {
            const fresh = await diagnostics.read(() => client.load({joinId: root.dataset["joinId"]!, libraryId: root.dataset["libraryId"]!}, controller?.signal));
            assertDescriptionReplacement(fresh.description, replacement);
          }
        }
        if (full && message["patch"] !== undefined) {
          const context = readLibibFullEditor(root as HTMLFormElement, options.pageUrl(), true);
          if (!context) throw new Error("A edição mudou. Reabra a busca neste item.");
          await diagnostics.fillAsync(() => fillLibibFullEditorPatch(context, options.pageUrl(), message["patch"], {isCurrent: current, ...(replacement ? {descriptionReplacement: replacement} : {}),
            ...(controller ? {signal: controller.signal} : {})}));
          if (current() && session === message["session"]) {reply({filled: true}); hide(); action.focus();}
          return;
        }
        if (!full && message["patch"] !== undefined) {
          const target = {joinId: root.dataset["joinId"]!, libraryId: root.dataset["libraryId"]!};
          const signal = controller?.signal;
          const videoPatch = message["patch"];
          let quickPatch = videoPatch;
          if (movie && videoPatch && typeof videoPatch === "object" && !Array.isArray(videoPatch)) {
            const fields = videoPatch as Record<string, unknown>;
            if ("artists" in fields) throw new Error("Escolha diretores para este vídeo.");
            const {directors, ...rest} = fields;
            quickPatch = {...rest, ...("directors" in fields ? {artists: directors} : {})};
          }
          const result = await applyLibibPatch(quickPatch, async (field, value) => {
            if (!current() || session !== message["session"] || signal?.aborted) return {confirmed: false, writeMayHaveOccurred: false, code: "cancelled"};
            let request: NativeSaveRequest;
            if (field === "image" && value instanceof File) request = {...target, field, value};
            else if (field === "description" && typeof value === "string" && replacement) {
              const fresh = await diagnostics.read(() => client.load(target, signal));assertDescriptionReplacement(fresh.description, replacement);
              request = {...target, field, value: descriptionText(value, fresh.descriptionMaxLength), expectedDescription: replacement.expected, descriptionConfirmed: true};
            }
            else if ((field === "title" || field === "creators") && typeof value === "string") {
              const titleOverride = field === "title" ? (await diagnostics.read(() => client.load(target, signal))).titleOverride : undefined;
              request = {...target, field, value, ...(titleOverride !== undefined ? {titleOverride} : {})};
            } else throw new LibibEditError("invalid-input", field);
            const outcome = await saveNative(request, signal);
            diagnostics.native(field, outcome);
            return outcome;
          });
          if (current() && session === message["session"]) {
            reply({patchResult: result}); ui.update({status: describeLibibPatchResult(result)});
            if (Object.values(result.fields).every(state => state === "saved")) {hide(); action.focus();}
          }
          return;
        }
        if (movie) throw new Error("Escolha os campos de vídeo que deseja preencher.");
        const {metadata} = prepareAlbumMetadata(message["metadata"]);
        if (full) {
          diagnostics.fill(() => {
            const context = readLibibFullEditor(root as HTMLFormElement, options.pageUrl(), true);
            if (!context) throw new Error("A edição mudou. Reabra a busca neste item.");
            fillLibibFullEditor(context, options.pageUrl(), metadata);
          });
          reply({filled: true});
          hide();
          action.focus();
          return;
        }
        const target = {joinId: root.dataset["joinId"]!, libraryId: root.dataset["libraryId"]!};
        const applied = await applyLibibMetadata(nativeClient, target, metadata, controller?.signal);
        const result = {...applied, nativeUpdated: applied.title === "saved"};
        if (current() && session === message["session"]) {
          reply({result});
          ui.update({status: describeLibibApplyResult(result)});
          if (result.title === "saved" && result.creators === "saved") {hide(); action.focus();}
        }
      } catch (error) {
        if (current() && session === message["session"]) reply({error: error instanceof Error ? error.message : "Não foi possível aplicar os dados."});
      } finally {applying = false; ui.update({closeDisabled: false});}
    };
    const onMessage = (event: MessageEvent): void => {void receive(event);};
    document.defaultView?.addEventListener("message", onMessage);
    action.addEventListener("click", event => {event.preventDefault(); event.stopImmediatePropagation(); void open();});
    action.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault(); event.stopImmediatePropagation(); void open();
    });
    return {identity: key, menu, action, host, close: hide, remove() {document.defaultView?.removeEventListener("message", onMessage); hide(); unmountEditorAction(actionHost); actionHost.remove(); ui.dispose(); host.remove();}};
  }

  return {
    sync(): void {
      for (const [root, item] of mounted) {
        if (identity(root) !== item.identity || !item.menu.isConnected || !item.action.isConnected || !item.host.isConnected) {
          item.remove(); mounted.delete(root);
        }
      }
      if (!isSupportedCatalogUrl(options.pageUrl())) return;
      for (const root of document.querySelectorAll<HTMLElement>(".jump-edit, #edit-item-details #edit-item-form")) {
        if (mounted.has(root)) continue;
        const key = identity(root);
        if (key && root.matches("#edit-item-form") && root.querySelector('[id="edit-item-cancel"]')) {mounted.set(root, mount(root, root, key)); continue;}
        const menu = root.querySelector(".jump-list");
        if (!key || !menu?.querySelector('[data-key="title"]') || !menu.querySelector('[data-key="creators"]')) continue;
        mounted.set(root, mount(root, menu, key));
      }
    },
    stop(): void {for (const item of mounted.values()) item.remove(); mounted.clear();},
  };
}
