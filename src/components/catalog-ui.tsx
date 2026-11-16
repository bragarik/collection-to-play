import {createRef, render} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {streamingName, type AlbumOpenTarget, type AlbumQuery} from "../shared/contracts.js";
import {StreamingIcon} from "./ui-components.js";

function AlbumAction({host, service, getQuery, onOpen}: {host: HTMLElement; service: string; getQuery(): AlbumQuery | undefined; onOpen(query: AlbumQuery, target: AlbumOpenTarget): void | Promise<void>}) {
  const [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null), active = useRef(false), alive = useRef(true);
  const name = streamingName(service);
  async function open(event: MouseEvent, target: AlbumOpenTarget): Promise<void> {
    event.preventDefault(); event.stopPropagation();
    const query = getQuery(); if (!query || active.current) return;
    active.current = true; setExpanded(false); setBusy(true);
    try {await onOpen(query, target);} finally {active.current = false; if (alive.current) setBusy(false);}
  }
  useEffect(() => () => {alive.current = false;}, []);
  return <div data-theme="light" onKeyDown={event => {if (event.key === "Escape") {setExpanded(false); button.current?.focus();}}} onFocusOut={() => queueMicrotask(() => {if (alive.current && !host.matches(":focus-within")) setExpanded(false);})}>
    <link rel="stylesheet" href={chrome.runtime.getURL("ui.css")}/><link rel="stylesheet" href={chrome.runtime.getURL("library.css")}/>
    <button class="btn btn-primary btn-sm" ref={button} type="button" disabled={busy} aria-label={`Ouvir ${getQuery()?.title ?? "álbum"} no ${name}`} aria-expanded={expanded} aria-busy={busy || undefined} onClick={event => {event.preventDefault(); event.stopPropagation(); if (service !== "spotify") void open(event, "web"); else setExpanded(value => !value);}}><StreamingIcon service={service}/><span>{busy ? "Buscando…" : `Ouvir no ${name}`}</span></button>
    <div class="album-options" role="group" aria-label="Onde abrir o álbum" hidden={!expanded}><button class="btn btn-soft btn-sm" type="button" disabled={busy} onClick={event => void open(event, "web")}>Web Player</button><button class="btn btn-soft btn-sm" type="button" disabled={busy} onClick={event => void open(event, "app")}>Aplicativo Spotify</button></div>
  </div>;
}
export function mountAlbumAction(host: HTMLElement, service: string, getQuery: () => AlbumQuery | undefined, onOpen: (query: AlbumQuery, target: AlbumOpenTarget) => void | Promise<void>): () => void {
  const shadow = host.attachShadow({mode: "open"});
  render(<AlbumAction host={host} service={service} getQuery={getQuery} onOpen={onOpen}/>, shadow);
  return () => render(null, shadow);
}

export function mountPlayerShell(shadow: ShadowRoot) {
  const panel = createRef<HTMLElement>(), close = createRef<HTMLButtonElement>(), frame = createRef<HTMLIFrameElement>();
  let state = {hidden: true, src: "about:blank"};
  const paint = (): void => render(<div data-theme="light"><link rel="stylesheet" href={chrome.runtime.getURL("ui.css")}/><link rel="stylesheet" href={chrome.runtime.getURL("library.css")}/><section id="collection-player-panel" ref={panel} hidden={state.hidden} role="region" aria-label="Collection to Play — buscar álbum"><button class="close btn btn-ghost btn-sm" ref={close} type="button">Fechar</button><iframe ref={frame} title="Escolher álbum — Collection to Play" allow="clipboard-write" src={state.src}/></section></div>, shadow);
  paint();
  return {panel: panel.current!, close: close.current!, frame: frame.current!, update(value: Partial<typeof state>) {state = {...state, ...value}; paint();}, dispose() {render(null, shadow);}};
}
export function mountEditorAction(container: HTMLElement, full: boolean, label: string): HTMLButtonElement {
  const action = createRef<HTMLButtonElement>();
  render(<button ref={action} type="button" class={full ? "button no-post" : "collection-menu-action"} data-collection-to-play-edit-action="" aria-haspopup="dialog" style={full ? {} : {backgroundColor: "#edf9fb", color: "#007b92", border: "0", borderLeft: "3px solid #4bc1d2", cursor: "pointer", width: "100%", textAlign: "left", font: "inherit", padding: "8px"}}>{label}</button>, container);
  return action.current!;
}
export function unmountEditorAction(container: HTMLElement): void {render(null, container);}
export function mountEditorShell(shadow: ShadowRoot, resourceUrl: (path: string) => string, label: string) {
  const dialog = createRef<HTMLDialogElement>(), close = createRef<HTMLButtonElement>(), frame = createRef<HTMLIFrameElement>();
  let state = {status: "", statusHidden: false, frameHidden: true, frameSrc: "about:blank", closeDisabled: false};
  const paint = (): void => render(<div data-theme="light"><link rel="stylesheet" href={resourceUrl("ui.css")}/><link rel="stylesheet" href={resourceUrl("library.css")}/><dialog class="metadata-editor" ref={dialog} aria-label={label}><div class="editor-header"><h2>{label}</h2><button class="close btn btn-ghost btn-sm" type="button" ref={close} disabled={state.closeDisabled}>Fechar</button></div><p class="editor-status" role="status" hidden={state.statusHidden}>{state.status}</p><iframe ref={frame} title={label} hidden={state.frameHidden} src={state.frameSrc}/></dialog></div>, shadow);
  paint();
  return {dialog: dialog.current!, close: close.current!, frame: frame.current!, update(value: Partial<typeof state>) {state = {...state, ...value}; paint();}, dispose() {render(null, shadow);}};
}
