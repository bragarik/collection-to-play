import {isSupportedCatalogUrl, type StreamingId} from "./contracts.js";
import {LibibEditClient, LibibEditError} from "./libib-edit.js";
import {isNativeSaveOutcome, type NativeSaveRequest, type NativeSaveOutcome} from "./libib-native.js";
import {applyLibibMetadata, describeLibibApplyResult, prepareAlbumMetadata} from "./libib-metadata.js";

interface EditorOptions {
  readonly document: Document;
  readonly pageUrl: () => string;
  readonly service: () => string;
  readonly resourceUrl: (path: string) => string;
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

/** Adds one field-menu entry to each native music editor, without submitting its form. */
export function createLibibEditor(options: EditorOptions): {sync(): void; stop(): void} {
  const document = options.document;
  const mounted = new Map<HTMLElement, MountedEditor>();
  const identity = (root: HTMLElement): string | undefined => {
    if (!isSupportedCatalogUrl(options.pageUrl()) || !visible(root) || root.dataset["itemType"] !== "music" ||
      !/^[1-9]\d{0,19}$/.test(root.dataset["joinId"] ?? "") ||
      !/^[1-9]\d{0,19}$/.test(root.dataset["libraryId"] ?? "")) return undefined;
    return JSON.stringify([options.pageUrl(), root.dataset["joinId"], root.dataset["libraryId"], options.service()]);
  };

  function mount(root: HTMLElement, menu: Element, key: string): MountedEditor {
    const service = options.service() as StreamingId;
    const name = service === "youtube-music" ? "YouTube Music" : "Spotify";
    const label = `Atualizar dados via ${name}`;
    const action = document.createElement("li");
    action.dataset["collectionToPlayEditAction"] = "";
    action.tabIndex = 0;
    action.setAttribute("role", "button");
    action.setAttribute("aria-haspopup", "dialog");
    action.textContent = label;
    action.style.setProperty("background-color", "#edf9fb");
    action.style.setProperty("color", "#007b92");
    action.style.setProperty("border-left", "3px solid #4bc1d2");
    const host = document.createElement("div");
    host.dataset["collectionToPlayEditor"] = "";
    const shadow = host.attachShadow({mode: "open"});
    const styles = document.createElement("link");
    styles.rel = "stylesheet"; styles.href = options.resourceUrl("library.css");
    const dialog = document.createElement("dialog");
    dialog.className = "metadata-editor";
    dialog.setAttribute("aria-label", label);
    const header = document.createElement("div"); header.className = "editor-header";
    const heading = document.createElement("h2"); heading.textContent = label;
    const close = document.createElement("button"); close.type = "button";
    close.className = "close"; close.textContent = "Fechar";
    const status = document.createElement("p"); status.className = "editor-status";
    status.setAttribute("role", "status");
    const frame = document.createElement("iframe"); frame.title = label; frame.hidden = true;
    header.append(heading, close); dialog.append(header, status, frame);
    shadow.append(styles, dialog); root.append(host); menu.prepend(action);
    let controller: AbortController | undefined;
    let session = "";
    let applying = false;
    const current = (): boolean => identity(root) === key && dialog.open;
    const client = new LibibEditClient({pageUrl: options.pageUrl, isCurrent: current});
    const saveNative = (request: NativeSaveRequest, signal?: AbortSignal): Promise<NativeSaveOutcome> => new Promise(resolve => {
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
    const confirmNative = async (request: NativeSaveRequest, signal?: AbortSignal) => {
      const outcome = await saveNative(request, signal);
      if (!outcome.confirmed) throw new LibibEditError(outcome.code ?? "invalid-response", request.field, outcome.writeMayHaveOccurred, outcome.httpStatus);
      return {target: {joinId: request.joinId, libraryId: request.libraryId}, field: request.field, confirmed: true as const};
    };
    const nativeClient: Pick<LibibEditClient, "saveTitle" | "saveCreators"> = {
      async saveTitle(target, title, signal) {
        const snapshot = await client.load(target, signal);
        return confirmNative({...target, field: "title", value: title, titleOverride: snapshot.titleOverride}, signal);
      },
      async saveCreators(target, creators, signal) {return confirmNative({...target, field: "creators", value: creators}, signal);},
    };
    const reset = (): void => {
      controller?.abort(); controller = undefined;
      session = "";
      frame.src = "about:blank"; frame.hidden = true;
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
      frame.hidden = true; status.hidden = false; status.textContent = "Carregando dados do item…";
      dialog.showModal();
      close.focus();
      try {
        const snapshot = await client.load({joinId: root.dataset["joinId"]!, libraryId: root.dataset["libraryId"]!}, signal);
        if (signal.aborted || !dialog.open || identity(root) !== key) {hide(); return;}
        const url = new URL(options.resourceUrl("album-panel.html"));
        url.searchParams.set("mode", "metadata");
        url.searchParams.set("session", session);
        url.searchParams.set("title", snapshot.title);
        url.searchParams.set("artist", snapshot.creators.join(", "));
        url.searchParams.set("source", options.pageUrl());
        frame.src = url.href; frame.hidden = false; status.hidden = true;
      } catch (error) {
        if (signal.aborted || !dialog.open) return;
        status.textContent = error instanceof Error ? error.message : "Não foi possível carregar o item.";
      }
    };
    const receive = async (event: MessageEvent): Promise<void> => {
      const origin = new URL(options.resourceUrl(""));
      if (!event.isTrusted || event.source !== frame.contentWindow || event.origin !== `${origin.protocol}//${origin.host}` || !current() || !session) return;
      const data: unknown = event.data;
      if (!data || typeof data !== "object") return;
      const message = data as Record<string, unknown>;
      if (message["type"] !== "collection-to-play:apply-metadata" || message["session"] !== session ||
        typeof message["requestId"] !== "string" || message["requestId"].length > 100) return;
      const reply = (value: object): void => frame.contentWindow?.postMessage({type: "collection-to-play:metadata-applied", session, requestId: message["requestId"], ...value}, `${origin.protocol}//${origin.host}`);
      if (applying) {reply({error: "Aguarde a gravação em andamento."}); return;}
      applying = true; close.disabled = true;
      try {
        const {metadata} = prepareAlbumMetadata(message["metadata"]);
        const target = {joinId: root.dataset["joinId"]!, libraryId: root.dataset["libraryId"]!};
        const applied = await applyLibibMetadata(nativeClient, target, metadata, controller?.signal);
        const result = {...applied, nativeUpdated: applied.title === "saved"};
        if (current() && session === message["session"]) {
          reply({result});
          status.textContent = describeLibibApplyResult(result);
        }
      } catch (error) {
        if (current() && session === message["session"]) reply({error: error instanceof Error ? error.message : "Não foi possível aplicar os dados."});
      } finally {applying = false; close.disabled = false;}
    };
    const onMessage = (event: MessageEvent): void => {void receive(event);};
    document.defaultView?.addEventListener("message", onMessage);
    action.addEventListener("click", event => {event.preventDefault(); event.stopImmediatePropagation(); void open();});
    action.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault(); event.stopImmediatePropagation(); void open();
    });
    return {identity: key, menu, action, host, close: hide, remove() {document.defaultView?.removeEventListener("message", onMessage); hide(); action.remove(); host.remove();}};
  }

  return {
    sync(): void {
      for (const [root, item] of mounted) {
        if (identity(root) !== item.identity || !item.menu.isConnected || !item.action.isConnected || !item.host.isConnected) {
          item.remove(); mounted.delete(root);
        }
      }
      if (!isSupportedCatalogUrl(options.pageUrl())) return;
      for (const root of document.querySelectorAll<HTMLElement>(".jump-edit")) {
        if (mounted.has(root)) continue;
        const key = identity(root);
        const menu = root.querySelector(".jump-list");
        if (!key || !menu?.querySelector('[data-key="title"]') || !menu.querySelector('[data-key="creators"]')) continue;
        mounted.set(root, mount(root, menu, key));
      }
    },
    stop(): void {for (const item of mounted.values()) item.remove(); mounted.clear();},
  };
}
