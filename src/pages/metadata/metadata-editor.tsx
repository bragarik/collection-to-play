import {AlbumArtwork} from "../../components/ui-components.js";
import {render} from "preact";
import {useEffect, useMemo, useRef, useState} from "preact/hooks";
import {AlbumComposition, type CompositionField, type CompositionPatch, type FieldSource} from "../../albums/album-composition.js";
import {loadAlbumArtworkResource, type AlbumArtworkFile} from "../../albums/album-artwork.js";
import {MetadataSearchSession, isMetadataService, metadataQueryKey} from "../../streamings/metadata-search.js";
import {isSupportedCatalogUrl, type AlbumCandidate, type AppReply, type AppRequest, type MetadataServiceId, type MetadataServicesReply} from "../../shared/contracts.js";
import {describeLibibApplyResult, isLibibApplyResult, describeLibibPatchResult, isLibibPatchResult, type LibibPatchResult, type LibibApplyResult} from "../../libib/libib-metadata.js";

const params = new URLSearchParams(location.search);
const sourceUrl = params.get("source") ?? "", session = params.get("session") ?? "";
const full = params.get("editor") === "full", selective = params.get("selective") === "true";
const initialTitle = (params.get("title") ?? "").slice(0, 512), initialArtist = (params.get("artist") ?? "").slice(0, 2000);
const initialService = params.get("service");
const names = {spotify: "Spotify", "youtube-music": "YouTube Music"};
const labels = {title: "Título", artists: "Artistas", artwork: "Capa"};
async function request<T>(message: AppRequest): Promise<T> {
  const reply: AppReply<T> | undefined = await chrome.runtime.sendMessage(message);
  if (!reply) throw new Error("A extensão não respondeu. Reabra o editor.");
  if (!reply.ok) {const error = new Error(reply.error.message); error.name = message.type === "metadata:artwork" ? "ArtworkError" : "Error"; Object.assign(error, {code: reply.error.code}); throw error;}
  return reply.data;
}
function origin(source: FieldSource): string {
  const value = source.kind === "manual" ? source.basedOn : source;
  const name = value.kind === "catalog" ? "Libib" : `${names[value.service]}${value.albumTitle ? ` · ${value.albumTitle}` : ""}`;
  return source.kind === "manual" ? `Edição manual · ${name}` : name;
}
function size(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toLocaleString("pt-BR", {maximumFractionDigits: 2})} MB` : `${(bytes / 1000).toLocaleString("pt-BR", {maximumFractionDigits: 1})} KB`;
}
function applyToLibib(patch: CompositionPatch, signal: AbortSignal): Promise<LibibApplyResult | LibibPatchResult | {filled: true}> {
  return new Promise((resolve, reject) => {
    if (!session || window.parent === window || signal.aborted) {reject(new Error("Reabra esta ação no editor do Libib.")); return;}
    const requestId = crypto.randomUUID(), parentOrigin = new URL(sourceUrl).origin;
    const finish = (): void => {clearTimeout(timer); window.removeEventListener("message", receive); signal.removeEventListener("abort", abort);};
    const receive = (event: MessageEvent): void => {
      if (!event.isTrusted || event.source !== window.parent || event.origin !== parentOrigin || !event.data || typeof event.data !== "object") return;
      const data = event.data as Record<string, unknown>;
      if (data["type"] !== "collection-to-play:metadata-applied" || data["session"] !== session || data["requestId"] !== requestId) return;
      finish();
      if (full && data["filled"] === true) resolve({filled: true});
      else if (!full && isLibibPatchResult(data["patchResult"])) resolve(data["patchResult"]);
      else if (!full && isLibibApplyResult(data["result"])) resolve(data["result"]);
      else reject(new Error(typeof data["error"] === "string" ? data["error"].slice(0, 300) : "Confira o item no Libib antes de tentar novamente."));
    };
    const abort = (): void => {finish(); reject(new Error("Editor encerrado."));};
    const timer = setTimeout(() => {finish(); reject(new Error("A confirmação demorou. Confira o item no Libib."));}, 75_000);
    window.addEventListener("message", receive); signal.addEventListener("abort", abort, {once: true});
    window.parent.postMessage({type: "collection-to-play:apply-metadata", session, requestId,
      ...(selective ? {patch} : {metadata: {title: patch.title, artists: patch.artists}})}, parentOrigin);
  });
}

function MetadataEditor() {
  const alive = useRef(true), applyingRef = useRef(false), revision = useRef(0), applyController = useRef(new AbortController());
  const [service, setService] = useState<MetadataServiceId>(isMetadataService(initialService) ? initialService : "spotify");
  const [title, setTitle] = useState(initialTitle.slice(0, 200)), [artist, setArtist] = useState(initialArtist.slice(0, 200));
  const [connections, setConnections] = useState<MetadataServicesReply>(), [required, setRequired] = useState(false);
  const [results, setResults] = useState<readonly AlbumCandidate[]>([]), [searching, setSearching] = useState(false);
  const [status, setStatus] = useState(""), [feedback, setFeedback] = useState(""), [applying, setApplying] = useState(false), [applied, setApplied] = useState(false);
  const [, update] = useState(0);
  const drafts = useRef(new Map<MetadataServiceId, {title: string; artist: string}>());
  const searchSession = useMemo(() => new MetadataSearchSession(service, {
    services: () => request({type: "metadata:services"}),
    search: (selected, query, nextPage) => request({type: "metadata:search", service: selected, ...query, ...(nextPage ? {nextPage} : {})}),
  }), []);
  const model = useMemo(() => new AlbumComposition({title: initialTitle, artists: initialArtist ? [initialArtist] : []}, {
    loadArtwork: (album, signal) => loadAlbumArtworkResource({...album, title: album.title ?? "", artists: album.artists ?? []},
      value => request<AlbumArtworkFile>({type: "metadata:artwork", album: value, sourceUrl}), {signal}),
  }), []);
  const snapshot = model.snapshot(), selected = snapshot.cards.find(card => card.album.service === snapshot.selectedService);
  const patch = model.changes(), hasChanges = Object.keys(patch).length > 0;
  const legacyAllowed = patch.title !== undefined && patch.artists !== undefined && patch.artwork === undefined;
  const canApply = hasChanges && (selective || legacyAllowed) && window.parent !== window && Boolean(session);
  const connection = connections?.services.find(item => item.id === service);
  const connectionNeeded = required || Boolean(connection?.requiresAuthentication && !connection.connected);
  const cached = searchSession.snapshot();
  const query = {title: title.trim(), artist: artist.trim(), sourceUrl};
  const more = Boolean(cached.nextPage && cached.query && metadataQueryKey(cached.query) === metadataQueryKey(query));
  async function refreshConnections(): Promise<void> {
    try {const value = await searchSession.refreshServices(); if (alive.current) {setConnections(value); setRequired(false);}}
    catch {if (alive.current) setStatus("Não foi possível verificar a conexão. Tente novamente.");}
  }
  async function search(append = false): Promise<void> {
    const generation = ++revision.current; setSearching(true); setStatus("Buscando álbuns…");
    try {
      const reply = await searchSession.search(query, append);
      if (!alive.current || generation !== revision.current || !reply) return;
      if (reply.connectionRequired) setRequired(true);
      if (reply.resolution.status === "failed") setStatus(reply.resolution.message);
      else {setResults(searchSession.snapshot().albums); setStatus(searchSession.snapshot().albums.length ? "Adicione um álbum à lista para consultar seus dados." : "Nenhum álbum encontrado. Ajuste a busca.");}
    } catch (error) {if (alive.current && generation === revision.current) setStatus(error instanceof Error ? error.message : "Não foi possível buscar.");}
    finally {if (alive.current && generation === revision.current) setSearching(false);}
  }
  useEffect(() => {
    alive.current = true;
    const unsubscribe = model.subscribe(() => {if (alive.current) {update(value => value + 1); setApplied(false);}});
    const refresh = (): void => {void refreshConnections();};
    const visible = (): void => {if (!document.hidden) refresh();};
    const storage = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {if (area === "local" && changes["spotify.session"]) refresh();};
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visible); chrome.storage.onChanged.addListener(storage);
    void refreshConnections().then(() => {if (alive.current) void search();}); document.body.dataset["ready"] = "true";
    return () => {alive.current = false; revision.current++; searchSession.invalidate(); applyController.current.abort(); unsubscribe(); model.dispose();
      window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible); chrome.storage.onChanged.removeListener(storage);};
  }, []);
  function changeService(next: string): void {
    if (!isMetadataService(next) || applyingRef.current) return;
    drafts.current.set(service, {title, artist}); searchSession.selectService(next); revision.current++; setSearching(false); setService(next); setRequired(false);
    const previous = drafts.current.get(next) ?? {title: initialTitle.slice(0, 200), artist: initialArtist.slice(0, 200)};
    setTitle(previous.title); setArtist(previous.artist); setResults(searchSession.snapshot().albums); setStatus("Escolha os termos e busque neste streaming.");
  }
  function editQuery(value: string, field: "title" | "artist"): void {
    searchSession.invalidate(); revision.current++; setSearching(false); setResults([]);
    if (field === "title") setTitle(value); else setArtist(value);
  }
  function add(album: AlbumCandidate): void {
    try {model.addAlbum(album); model.selectAlbum(album.service as MetadataServiceId); void model.loadArtwork(album.service as MetadataServiceId);
      requestAnimationFrame(() => document.getElementById(`source-${album.service}`)?.focus()); setFeedback("Álbum adicionado. Use + para copiar cada campo.");}
    catch (error) {setFeedback(error instanceof Error ? error.message : "Não foi possível adicionar.");}
  }
  function copy(field?: CompositionField): void {
    if (applyingRef.current) return;
    const copied = field ? model.copyField(field) : model.copyAll();
    setFeedback(copied ? `${field ? labels[field] : "Campos disponíveis"} copiados para o formulário. Nenhuma alteração foi salva.` : "Este campo ainda não está disponível.");
    if (copied) requestAnimationFrame(() => document.getElementById(field === "artwork" ? "include-artwork" : field === "artists" ? "composed-artists" : "composed-title")?.focus());
  }
  async function apply(): Promise<void> {
    if (!canApply || applyingRef.current || applied) return;
    applyingRef.current = true; setApplying(true); setFeedback(full ? "Preenchendo campos…" : "Salvando os campos escolhidos…");
    try {
      const result = await applyToLibib(model.changes(), applyController.current.signal);
      if (!alive.current) return;
      if ("filled" in result) {setApplied(true); setFeedback("Campos preenchidos. Salve pelo botão do Libib.");}
      else if ("fields" in result) {
        for (const [field, state] of Object.entries(result.fields)) if (state === "saved") model.setIncluded(field === "image" ? "artwork" : field === "creators" ? "artists" : "title", false);
        setApplied(Object.values(result.fields).every(state => state === "saved")); setFeedback(describeLibibPatchResult(result));
      }
      else {setApplied(result.title === "saved" && result.creators === "saved"); setFeedback(describeLibibApplyResult(result));}
    } catch (error) {if (alive.current) setFeedback(error instanceof Error ? error.message : "Confira o item no Libib.");}
    finally {applyingRef.current = false; if (alive.current) setApplying(false);}
  }
  return <>
    <h1>Compor dados do álbum</h1><p class="intro">Escolha até um álbum por streaming e copie os campos que deseja usar.</p>
    <div class="workspace"><section class="panel card card-border bg-base-100" aria-label="Buscar e escolher fontes">
      <form class="search-form" id="metadata-search" onSubmit={event => {event.preventDefault(); void search();}}>
        <div class="wide"><label for="streaming-service">Streaming</label><select class="select w-full" id="streaming-service" value={service} disabled={applying} onChange={event => changeService(event.currentTarget.value)}><option value="spotify">Spotify</option><option value="youtube-music">YouTube Music</option></select></div>
        <div><label for="search-title">Álbum</label><input class="input w-full" id="search-title" required maxLength={200} value={title} disabled={applying} onInput={event => editQuery(event.currentTarget.value, "title")}/></div>
        <div><label for="search-artist">Artista (opcional)</label><input class="input w-full" id="search-artist" maxLength={200} value={artist} disabled={applying} onInput={event => editQuery(event.currentTarget.value, "artist")}/></div>
        <div class="wide search-actions"><button type="submit" class="btn btn-primary" disabled={searching || applying}>{searching && <span class="loading loading-spinner loading-xs" aria-hidden="true"/>}Buscar álbuns</button><span class="note">{names[service]}</span></div>
      </form>
      {connectionNeeded && <div class="connection alert alert-warning alert-soft" id="connection-required"><p>Conecte sua conta {names[service]} para buscar. Os dados montados serão mantidos.</p><a href={connections?.configurationUrl ?? chrome.runtime.getURL("setup.html")} target="_blank" rel="noopener noreferrer">Abrir configurações</a><br/><button class="btn btn-sm" type="button" disabled={applying} onClick={() => void refreshConnections()}>Verificar conexão</button></div>}
      <p class="status" id="search-status" role="status" aria-live="polite">{status}</p>
      {results.length > 0 && <><span class="results-title">Resultados no {names[service]}</span><ul class="results">{results.map(album => <li class="result card card-border" key={`${album.service}:${album.id}`}>
        <AlbumArtwork album={album}/>
        <div class="result-info"><h3>{album.title}</h3><p class="note">{album.artists.map(value => value.name).join(", ")}</p>{album.releaseDate && <p class="note">{album.releaseDate}</p>}</div>
        <button class="btn btn-soft btn-sm" type="button" disabled={applying || snapshot.cards.some(card => card.album.service === album.service)} onClick={() => add(album)}>Adicionar álbum</button>
      </li>)}</ul></>}
      {more && <button class="more btn btn-soft btn-sm" type="button" disabled={searching || applying} onClick={() => void search(true)}>Carregar mais resultados</button>}
      <div class="layout-heading"><h2>Álbuns escolhidos</h2><span class="badge badge-soft">{snapshot.cards.length} / 2</span></div>
      {!snapshot.cards.length && <p class="empty">Adicione um álbum nos resultados da busca.</p>}
      <ul class="source-cards">{snapshot.cards.map(card => <li class={`source-card card card-border${card.album.service === snapshot.selectedService ? " selected" : ""}`} key={card.album.service}>
        <button type="button" id={`source-${card.album.service}`} class="source-select" aria-pressed={card.album.service === snapshot.selectedService} disabled={applying} onClick={() => {model.selectAlbum(card.album.service as MetadataServiceId); void model.loadArtwork(card.album.service as MetadataServiceId);}}>
          {card.artwork && <img class="thumb" src={card.artwork.previewUrl} alt=""/>}<span><span class="service"><img src={chrome.runtime.getURL(card.album.service === "spotify" ? "assets/spotify-icon.svg" : "assets/youtube-music-icon.png")} alt=""/>{names[card.album.service as MetadataServiceId]}</span><strong>{card.album.title ?? card.album.id}</strong></span>
        </button><button class="remove btn btn-ghost btn-sm" type="button" disabled={applying} aria-label={`Remover álbum do ${names[card.album.service as MetadataServiceId]}`} onClick={() => {model.removeAlbum(card.album.service as MetadataServiceId); document.getElementById("streaming-service")?.focus();}}>Remover</button>
      </li>)}</ul>
      <section class="details" aria-label="Dados da fonte selecionada">
        {selected ? <><div class="layout-heading"><h2>Dados do {names[selected.album.service as MetadataServiceId]}</h2><button class="btn btn-soft btn-sm" type="button" disabled={applying} onClick={() => copy()}>+ todos</button></div>
          <div class="detail-field"><div><h3>Título</h3><p>{selected.album.title || "Não informado"}</p></div><button class="btn btn-soft btn-square btn-sm" type="button" aria-label="Copiar título" disabled={applying || !selected.album.title?.trim()} onClick={() => copy("title")}>+</button></div>
          <div class="detail-field"><div><h3>Artistas</h3><ul class="artist-list">{selected.album.artists?.map(value => <li key={value.id}>{value.name}</li>)}</ul></div><button class="btn btn-soft btn-square btn-sm" type="button" aria-label="Copiar artistas" disabled={applying || !selected.album.artists?.length} onClick={() => copy("artists")}>+</button></div>
          <div class="detail-field"><div><h3>Capa</h3>{selected.artwork ? <><img class="cover-preview" src={selected.artwork.previewUrl} alt={`Capa de ${selected.album.title ?? "álbum"}`}/><p class="note">{selected.artwork.metadata.width} × {selected.artwork.metadata.height} px · {selected.artwork.metadata.format.toUpperCase()} · {size(selected.artwork.metadata.byteLength)}</p>
            {selected.artwork.metadata.warnings.includes("low-resolution") && <p class="warning alert alert-warning alert-soft">Capa abaixo de 300 × 300 pixels. Você pode usá-la com menor qualidade.</p>}
            {selected.artwork.metadata.warnings.includes("unavailable-variants") && <p class="note">Algumas variantes não puderam ser usadas. Esta é a maior capa válida obtida.</p>}</> : <p class="note">{selected.loadingArtwork ? "Carregando capa… + todos copia os campos já disponíveis." : selected.artworkError?.message ?? "Capa não disponível."}</p>}
            {selected.artworkError && <button class="btn btn-soft btn-sm" type="button" disabled={applying} onClick={() => void model.loadArtwork(selected.album.service as MetadataServiceId)}>Tentar obter a capa novamente</button>}
          </div><button class="btn btn-soft btn-square btn-sm" type="button" aria-label="Copiar capa" disabled={applying || !selected.artwork} onClick={() => copy("artwork")}>+</button></div>
        </> : <p class="note">Selecione um card para consultar seus dados. O formulário só muda quando você copiar um campo.</p>}
      </section>
    </section><form class="panel draft card card-border bg-base-200" aria-label="Formulário principal" onSubmit={event => {event.preventDefault(); void apply();}}>
      <h2>Dados para o Libib</h2><p class="note">Marque os campos que deseja aplicar. Os demais serão mantidos no Libib.</p>
      <div class="draft-field"><div class="field-heading"><input class="checkbox checkbox-primary checkbox-sm" id="include-title" type="checkbox" aria-label="Aplicar título" checked={snapshot.fields.title.included} disabled={applying} onChange={event => model.setIncluded("title", event.currentTarget.checked)}/><label for="composed-title">Título</label></div><input class="input w-full" id="composed-title" aria-describedby="title-origin" maxLength={512} value={snapshot.fields.title.value} disabled={applying} onInput={event => model.editTitle(event.currentTarget.value)}/><span id="title-origin" class="origin">Origem: {origin(snapshot.fields.title.source)}</span></div>
      <div class="draft-field"><div class="field-heading"><input class="checkbox checkbox-primary checkbox-sm" id="include-artists" type="checkbox" aria-label="Aplicar artistas" checked={snapshot.fields.artists.included} disabled={applying} onChange={event => model.setIncluded("artists", event.currentTarget.checked)}/><label for="composed-artists">Artistas</label></div><textarea class="textarea w-full" id="composed-artists" aria-describedby="artists-origin" rows={3} value={snapshot.fields.artists.value.join("\n")} disabled={applying} onInput={event => model.editArtists(event.currentTarget.value.split(/\r?\n/))}/><span id="artists-origin" class="origin">Origem: {origin(snapshot.fields.artists.source)}</span><p class="note">Um artista por linha.</p></div>
      <div class="draft-field"><div class="field-heading"><input class="checkbox checkbox-primary checkbox-sm" id="include-artwork" type="checkbox" aria-label="Aplicar capa" checked={snapshot.fields.artwork.included} disabled={applying || !snapshot.fields.artwork.value} onChange={event => model.setIncluded("artwork", event.currentTarget.checked)}/><label for="include-artwork">Capa</label></div>
        {snapshot.fields.artwork.value ? <><img class="cover-preview" src={snapshot.fields.artwork.value.previewUrl} alt="Capa escolhida para o Libib"/><p class="note">{snapshot.fields.artwork.value.metadata.width} × {snapshot.fields.artwork.value.metadata.height} px · {size(snapshot.fields.artwork.value.metadata.byteLength)}</p></> : <p class="note">A capa atual do Libib será mantida.</p>}
        <span class="origin">Origem: {origin(snapshot.fields.artwork.source)}</span>
      </div>
      <p class="note">{full ? "Preencher apenas prepara os campos. Você salva pelo botão Salvar do Libib." : "Aplicar salva imediatamente apenas os campos marcados no Libib."}</p>
      {!selective && hasChanges && !legacyAllowed && <p class="warning alert alert-warning alert-soft">Reabra a busca pelo Libib para aplicar os campos separadamente, incluindo a capa.</p>}
      <button class="btn btn-primary" id="apply-composition" type="submit" disabled={!canApply || applying || applied}>{applying && <span class="loading loading-spinner loading-xs" aria-hidden="true"/>}{applying ? "Aguarde…" : full ? "Preencher campos" : "Aplicar dados"}</button>
      <p class={`apply-feedback${feedback ? " alert alert-info alert-soft" : ""}`} id="composition-feedback" role="status" aria-live="polite">{feedback}</p>
    </form></div>
  </>;
}

const root = document.getElementById("editor-root");
if (root) {
  if (!isSupportedCatalogUrl(sourceUrl)) root.textContent = "Abra esta ação pelo editor de um álbum no Libib.";
  else {root.replaceChildren(); render(<MetadataEditor/>, root); window.addEventListener("pagehide", () => render(null, root), {once: true});}
}
