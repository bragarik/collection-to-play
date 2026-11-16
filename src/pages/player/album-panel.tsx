import {render} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {isSupportedCatalogUrl, streamingName, type AlbumCandidate, type AlbumOpenTarget, type AlbumSearchReply, type AppRequest, type SetupInfo} from "../../shared/contracts.js";
import {ActionIcon, AlbumArtwork, errorMessage, extensionRequest as request, StreamingIcon} from "../../components/ui-components.js";

type Query = Extract<AppRequest, {type: "spotify:search"}>;
const params = new URLSearchParams(location.search), sourceUrl = params.get("source") ?? "";
const target: AlbumOpenTarget = params.get("target") === "app" ? "app" : "web";
const originalTitle = (params.get("title") ?? "").slice(0, 200), originalArtist = (params.get("artist") ?? "").slice(0, 200);
interface Candidate {album: AlbumCandidate; selectionId: string}
function CandidateCard({album, selectionId, busy, select}: Candidate & {busy: boolean; select(album: AlbumCandidate, selectionId: string, artistId: string): Promise<void>}) {
  const [artist, setArtist] = useState(album.artists.length === 1 ? album.artists[0]!.id : "");
  const artistInput = useRef<HTMLSelectElement>(null);
  const label = album.service !== "spotify" ? `Abrir no ${streamingName(album.service)}` : target === "app" ? "Abrir no aplicativo Spotify" : "Abrir no Web Player";
  return <li class="candidate card card-border"><div class="candidate-header"><AlbumArtwork album={album} className="album-art"/><div class="candidate-info"><h2>{album.title}</h2><p class="candidate-artists">{album.artists.map(value => value.name).join(", ")}</p>{album.releaseDate && <p class="release-date">{album.releaseDate}</p>}</div></div>
    <select class="select w-full" ref={artistInput} aria-label={`Artista de ${album.title}`} hidden={album.artists.length === 1} disabled={busy} value={artist} onChange={event => setArtist(event.currentTarget.value)}><option value="" disabled>Selecione o artista para lembrar</option>{album.artists.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select>
    <div class="candidate-action"><button class="open-album btn btn-primary btn-circle" type="button" aria-label={label} title={label} disabled={busy} onClick={() => {if (!artist) artistInput.current?.focus(); void select(album, selectionId, artist);}}>{target === "app" && album.service === "spotify" ? <StreamingIcon/> : <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 3h7v7M21 3 11 13M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>}</button></div>
  </li>;
}
function AlbumPanel() {
  const [setup, setSetup] = useState<SetupInfo>(), [title, setTitle] = useState(originalTitle), [artist, setArtist] = useState(originalArtist);
  const [status, setStatus] = useState("Buscando álbuns…"), [candidates, setCandidates] = useState<readonly Candidate[]>([]), [nextPage, setNextPage] = useState<string>();
  const [remember, setRemember] = useState(false), [busy, setBusy] = useState(false), [refining, setRefining] = useState(false), [fallback, setFallback] = useState("");
  const config = useRef<SetupInfo | undefined>(undefined), currentQuery = useRef<Query | undefined>(undefined), revision = useRef(0), alive = useRef(true), active = useRef(false);
  const webOnly = setup?.preferredService === "deezer" || setup?.preferredService === "youtube-music" || setup?.preferredService === "apple-music", service = streamingName(setup?.preferredService ?? "spotify");
  const known = (): boolean => Boolean(alive.current && config.current && ["spotify", "youtube-music", "apple-music", "deezer"].includes(config.current.preferredService ?? ""));
  function query(): Query {
    return {type: "spotify:search", title: title.trim(), artist: artist.trim(), sourceUrl,
      ...(params.get("title")?.trim() && params.has("artist") ? {lookupTitle: params.get("title")!, lookupArtist: params.get("artist")!} : {}),
      ...(params.get("upc") ? {upc: params.get("upc")!} : {}), ...(params.get("ean") ? {ean: params.get("ean")!} : {})};
  }
  async function showReply(data: AlbumSearchReply, append: boolean, generation: number): Promise<void> {
    if (!alive.current || generation !== revision.current) return;
    const result = data.resolution; setNextPage(undefined); setFallback("");
    if (result.status === "failed") {setStatus(result.code === "authentication-required" ? "Conecte sua conta Spotify pelo ícone da extensão e depois tente novamente neste álbum." : result.message); return;}
    if (result.status === "not-found") {setStatus(`Nenhum álbum encontrado. Você pode ajustar a busca ou procurar no ${streamingName(config.current?.preferredService ?? "spotify")}.`); setFallback(data.searchUrl); return;}
    if (data.autoOpen && data.selectionId && !append) {
      setStatus("Álbum identificado. Abrindo…");
      try {await request({type: "spotify:open-result", selectionId: data.selectionId, target}); if (alive.current && generation === revision.current) setStatus("Álbum aberto no destino escolhido."); return;}
      catch { /* Keep candidates available for an explicit retry. */ }
    }
    if (!alive.current || generation !== revision.current) return;
    const albums = result.status === "resolved" ? [result.album] : result.candidates;
    if (data.selectionId) setCandidates(previous => [...new Map([...(append ? previous : []), ...albums.map(album => ({album, selectionId: data.selectionId!}))].map(value => [value.album.id, value])).values()]);
    const cursor = result.status === "choose" ? result.nextPage : undefined;
    setNextPage(cursor); setStatus(result.status === "choose" && result.notice ? result.notice : cursor ? "Confira os resultados ou carregue mais álbuns." : result.status === "choose" && result.incomplete ? "A busca atingiu o limite de resultados. Ajuste título ou artista para refinar, ou escolha um dos álbuns." : "Escolha o álbum que deseja abrir.");
  }
  async function search(append = false): Promise<void> {
    if (!known()) {setStatus("Escolha seu streaming pelo ícone da extensão e reabra a ação neste álbum."); return;}
    if (config.current?.preferredService === "spotify" && !config.current.spotify.connected) {setStatus("Conecte sua conta Spotify pelo ícone da extensão."); return;}
    if (active.current || append && (!currentQuery.current || !nextPage)) return;
    active.current = true; setBusy(true); const generation = ++revision.current, cursor = nextPage;
    setStatus("Buscando álbuns…");
    if (!append) {currentQuery.current = query(); setCandidates([]); setRemember(false); setNextPage(undefined);}
    try {
      const data = await request<AlbumSearchReply>({...currentQuery.current!, ...(append && cursor ? {nextPage: cursor} : {})});
      await showReply(data, append, generation);
      if (alive.current && generation === revision.current) {if (append && data.resolution.status === "failed") setNextPage(cursor); setRefining(false);}
    } catch (error) {if (alive.current && generation === revision.current) {if (append) setNextPage(cursor); setStatus(errorMessage(error));}}
    finally {active.current = false; if (alive.current) setBusy(false);}
  }
  async function select(album: AlbumCandidate, selectionId: string, artistId: string): Promise<void> {
    if (!artistId) {setStatus("Escolha qual artista deseja lembrar para este item."); return;}
    if (active.current) return;
    active.current = true; setBusy(true);
    try {await request({type: "spotify:select", selectionId, albumId: album.id, artistId, rememberAlbum: remember, target}); if (alive.current) setStatus("Álbum aberto. Sua escolha foi salva.");}
    catch (error) {if (alive.current) setStatus(errorMessage(error));}
    finally {active.current = false; if (alive.current) setBusy(false);}
  }
  useEffect(() => {
    alive.current = true;
    const initialize = async (): Promise<void> => {
      try {
        if (!isSupportedCatalogUrl(sourceUrl)) {setStatus("Abra esta ação a partir de um álbum no Libib."); return;}
        const value = await request<SetupInfo>({type: "setup:get"}); if (!alive.current) return;
        config.current = value; setSetup(value);
        document.title = `Collection to Play — ${streamingName(value.preferredService ?? "spotify")}`;
        if (!value.preferredService) {setStatus("Escolha seu streaming pelo ícone da extensão e volte a este álbum."); return;}
        if (!known()) {setStatus("O streaming escolhido ainda não está disponível nesta versão."); return;}
        if (params.get("result")) {
          const initial = await request<AlbumSearchReply | null>({type: "spotify:pending", id: params.get("result")!});
          if (!alive.current) return;
          if (initial) {currentQuery.current = query(); await showReply(initial, false, revision.current); return;}
        }
        await search();
      } catch (error) {if (alive.current) setStatus(errorMessage(error));}
      finally {if (alive.current) document.body.dataset["ready"] = "true";}
    };
    void initialize();
    return () => {alive.current = false; revision.current++;};
  }, []);
  function edit(value: string, field: "title" | "artist"): void {revision.current++; setNextPage(undefined); if (field === "title") setTitle(value); else setArtist(value);}
  return <>
    <h1>Escolher álbum{webOnly ? ` no ${service}` : ""}</h1><p id="query">{title} — {artist || "artista não informado"}</p><div id="destination" class="badge badge-soft"><StreamingIcon service={setup?.preferredService ?? "spotify"}/>{webOnly ? `${service} · navegador` : target === "app" ? "Aplicativo Spotify" : "Web Player"}</div>
    <p id="status" role="status" aria-live="polite">{status}</p><div id="remember-options" hidden={!candidates.length}><label><input id="remember-album" class="checkbox checkbox-primary checkbox-sm" type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.currentTarget.checked)}/>Lembrar decisão</label><p class="note">O artista será lembrado para este item. Marque para lembrar também este álbum.</p></div>
    <ol id="results">{candidates.map(value => <CandidateCard key={value.album.id} {...value} busy={busy} select={select}/>)}</ol>
    <button id="load-more" class="btn btn-soft" type="button" hidden={!nextPage} disabled={busy} onClick={() => void search(true)}>Carregar mais resultados</button><a id="search-fallback" href={fallback} target="_blank" rel="noopener noreferrer" hidden={!fallback}>Buscar no {service}</a>
    <details id="refine" open={refining} onToggle={event => setRefining(event.currentTarget.open)}><summary>Ajustar a busca</summary><form id="album-search" onSubmit={event => {event.preventDefault(); void search();}}><label for="album-title">Álbum</label><input id="album-title" class="input w-full" required maxLength={200} disabled={busy} value={title} onInput={event => edit(event.currentTarget.value, "title")}/><label for="album-artist">Artista (opcional)</label><input id="album-artist" class="input w-full" maxLength={200} disabled={busy} value={artist} onInput={event => edit(event.currentTarget.value, "artist")}/><button class="btn btn-primary" type="submit" disabled={busy}>{busy ? <span class="loading loading-spinner loading-xs" aria-hidden="true"/> : <ActionIcon name="search"/>}Buscar álbuns</button></form></details>
  </>;
}
const root = document.getElementById("album-panel-root");
if (params.get("mode") === "metadata") {
  const url = new URL(chrome.runtime.getURL("metadata-editor.html")); url.search = location.search;
  void request<SetupInfo>({type: "setup:get"}).then(info => {if (info.preferredService) url.searchParams.set("service", info.preferredService); location.replace(url.href);}, () => location.replace(url.href));
} else if (root) {root.replaceChildren(); render(<AlbumPanel/>, root); window.addEventListener("pagehide", () => render(null, root), {once: true});}
