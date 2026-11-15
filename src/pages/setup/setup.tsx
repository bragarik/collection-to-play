import {render} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {STREAMINGS, type AppRequest, type SetupInfo, type AlbumCandidate, type AlbumSearchReply} from "../../shared/contracts.js";
import {normalizeMetadata, type RememberedChoice} from "../../albums/resolution.js";
import {LibibDiagnosticPanel} from "../../components/libib-diagnostic-panel.js";
import {downloadJson, errorMessage, extensionRequest as request, Feedback, StreamingIcon} from "../../components/ui-components.js";

type Preferences = {service?: string; choices: readonly RememberedChoice[]};
type SearchQuery = Extract<AppRequest, {type: "spotify:search"}>;
function choiceTitle(choice: RememberedChoice): string {
  if (choice.query?.title?.trim()) return choice.query.title;
  try {
    const key: unknown = JSON.parse(choice.key);
    if (Array.isArray(key) && key[3] === "metadata" && typeof key[5] === "string") return key[5];
    if (Array.isArray(key) && key[3] === "item" && typeof key[4] === "string") return `Item ${key[4]}`;
  } catch { /* Invalid older labels do not change the association. */ }
  return choice.album?.title ?? "Álbum da coleção";
}
function Setup() {
  const [info, setInfo] = useState<SetupInfo>(), [preferences, setPreferences] = useState<Preferences>({choices: []});
  const [selectedService, setSelectedService] = useState(""), [streamingOpen, setStreamingOpen] = useState(true);
  const [working, setWorking] = useState(""), [feedback, setFeedback] = useState(""), [connectionError, setConnectionError] = useState("");
  const [preferenceFeedback, setPreferenceFeedback] = useState(""), [initialError, setInitialError] = useState("");
  const [choiceSearch, setChoiceSearch] = useState(""), [page, setPage] = useState(1), [choicesFeedback, setChoicesFeedback] = useState("");
  const [title, setTitle] = useState(""), [artist, setArtist] = useState(""), [code, setCode] = useState("");
  const [albums, setAlbums] = useState<readonly AlbumCandidate[]>([]), [nextPage, setNextPage] = useState<string>();
  const [searchFeedback, setSearchFeedback] = useState(""), [fallback, setFallback] = useState(""), [exportFeedback, setExportFeedback] = useState("");
  const [diagnosticRevision, setDiagnosticRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null), rememberedInput = useRef<HTMLInputElement>(null), redirect = useRef<HTMLTextAreaElement>(null);
  const active = useRef(false), initialized = useRef(false), alive = useRef(true), searchRevision = useRef(0), lastQuery = useRef<SearchQuery | undefined>(undefined);
  const youtube = preferences.service === "youtube-music", connected = Boolean(info?.spotify.connected), available = connected || youtube;
  const serviceName = youtube ? "YouTube Music" : "Spotify", busy = Boolean(working);
  async function loadPreferences(refreshService = false, connectedNow = connected): Promise<void> {
    const value = await request<Preferences>({type: "preferences:get"});
    if (!alive.current) return;
    setPreferences(value);
    if (!initialized.current || refreshService) setSelectedService(value.service ?? "");
    if (!initialized.current) setStreamingOpen(!value.service || value.service === "spotify" && !connectedNow);
    initialized.current = true;
  }
  async function loadSetup(): Promise<void> {
    const value = await request<SetupInfo>({type: "setup:get"});
    if (!alive.current) return;
    setInfo(value); setConnectionError(""); await loadPreferences(false, value.spotify.connected);
    if (alive.current) {setDiagnosticRevision(x => x + 1); document.body.dataset["ready"] = "true";}
  }
  async function run(name: string, action: () => Promise<void>): Promise<void> {
    if (active.current) return;
    active.current = true; setWorking(name);
    try {await action();} finally {active.current = false; if (alive.current) setWorking("");}
  }
  useEffect(() => {
    alive.current = true;
    void loadSetup().catch(error => {if (alive.current) setInitialError(errorMessage(error));});
    return () => {alive.current = false; searchRevision.current++;};
  }, []);
  function clearSearch(): void {searchRevision.current++; setAlbums([]); setNextPage(undefined); lastQuery.current = undefined; setFallback(""); setSearchFeedback("");}
  async function savePreference(): Promise<void> {
    await run("preference", async () => {
      try {
        const selected = STREAMINGS.find(service => service.id === selectedService && service.available);
        if (!selected) throw new Error("Selecione um streaming disponível.");
        await request({type: "preferences:set-service", service: selected.id}); await loadPreferences(true); clearSearch();
        setPreferenceFeedback(`Preferência salva: ${selected.name}.`);
      } catch (error) {setPreferenceFeedback(errorMessage(error));}
    });
  }
  async function connection(disconnect: boolean): Promise<void> {
    await run("connection", async () => {
      if (!disconnect) setConnectionError("Autorize o acesso na janela do Spotify…");
      try {
        await request({type: disconnect ? "spotify:disconnect" : "spotify:connect"});
        if (disconnect) clearSearch();
        await loadSetup(); setFeedback(disconnect ? "Conta desconectada desta extensão." : "Conexão concluída. Você já pode testar a busca.");
      } catch (error) {setConnectionError(errorMessage(error));}
    });
  }
  function editSearch(field: "title" | "artist" | "code", value: string): void {
    searchRevision.current++; setNextPage(undefined);
    if (field === "title") setTitle(value); else if (field === "artist") setArtist(value); else setCode(value);
  }
  async function search(append = false): Promise<void> {
    if (!available || append && (!lastQuery.current || !nextPage)) return;
    await run("search", async () => {
      const revision = ++searchRevision.current, requestedPage = nextPage;
      if (!append) {setAlbums([]); setNextPage(undefined); setFallback(""); lastQuery.current = {type: "spotify:search", title, artist, ...(!youtube && code.trim() ? {upc: code.trim()} : {})};}
      setSearchFeedback(`Buscando álbuns no ${serviceName}…`);
      try {
        const data = await request<AlbumSearchReply>({...lastQuery.current!, ...(append && requestedPage ? {nextPage: requestedPage} : {})});
        if (!alive.current || revision !== searchRevision.current) return;
        const result = data.resolution;
        if (result.status === "failed") {setSearchFeedback(result.message); if (append) setNextPage(requestedPage);}
        else if (result.status === "not-found") {setNextPage(undefined); setFallback(data.searchUrl); setSearchFeedback(`Nenhum álbum encontrado. Você pode tentar a busca no ${serviceName}.`);}
        else {
          const values = result.status === "resolved" ? [result.album] : result.candidates;
          setAlbums(previous => [...new Map([...(append ? previous : []), ...values].map(album => [album.id, album])).values()]);
          const cursor = result.status === "choose" ? result.nextPage : undefined; setNextPage(cursor);
          setSearchFeedback(cursor ? "Resultados parciais. Confira os álbuns ou carregue mais resultados." : append ? "Resultados carregados. Confira os álbuns encontrados." : result.status === "resolved" ? "Álbum encontrado. Abra o link para conferir." : "Confira os resultados e abra o álbum desejado.");
        }
        await loadSetup();
      } catch (error) {if (revision === searchRevision.current) setSearchFeedback(errorMessage(error));}
    });
  }
  const normalizedSearch = normalizeMetadata(choiceSearch), filtered = preferences.choices.filter(choice => normalizeMetadata([choiceTitle(choice), choice.artist.name, choice.album?.title ?? "", STREAMINGS.find(s => s.id === choice.service)?.name ?? choice.service, choice.query?.upc ?? "", choice.query?.ean ?? "", choice.key].join(" ")).includes(normalizedSearch));
  const pages = Math.max(1, Math.ceil(filtered.length / 20)), currentPage = Math.min(page, pages), start = (currentPage - 1) * 20;
  async function forget(choice: RememberedChoice): Promise<void> {
    await run("forget", async () => {
      try {await request({type: "preferences:delete", key: choice.key}); await loadPreferences(); setChoicesFeedback("Escolha esquecida. As lembranças de artista e álbum foram removidas.");}
      catch (error) {setChoicesFeedback(errorMessage(error));}
    });
  }
  async function exportSearch(): Promise<void> {
    await run("export", async () => {
      setExportFeedback("Preparando o log da busca…");
      try {
        const value = await request<unknown>({type: "spotify:diagnostics"});
        if (!value) {setExportFeedback("Faça uma busca antes de exportar o log."); return;}
        downloadJson(value, "collection-to-play-busca"); setExportFeedback("Log exportado com o diagnóstico disponível do serviço. Sem tokens ou dados de login.");
      } catch (error) {setExportFeedback(errorMessage(error));}
    });
  }
  return <>
    <header><h1>Collection to Play</h1><a id="open-full-page" href="setup.html?view=full" target="_blank" rel="noopener">Abrir em tela inteira ↗</a><p id="status" class="status" role="status">{initialError ? "Não foi possível carregar a configuração." : info ? `Versão ${info.version}` : "Carregando configuração…"}</p></header>
    <main>
      <details id="streaming-section" class="settings-section card card-border" open={streamingOpen} onToggle={event => setStreamingOpen(event.currentTarget.open)}>
        <summary><span class="section-title">Streaming e conexão</span><span id="streaming-section-label" class="section-badge badge badge-soft">{STREAMINGS.find(s => s.id === preferences.service)?.name ?? "Não configurado"}</span></summary>
        <div class="section-content"><p id="first-use" class="note" hidden={Boolean(preferences.service)}>Escolha o serviço que deseja usar. Nenhum streaming foi selecionado automaticamente.</p>
          <form id="streaming-settings" onSubmit={event => {event.preventDefault(); void savePreference();}}><label for="preferred-streaming">Streaming</label><select id="preferred-streaming" class="select w-full" required value={selectedService} disabled={busy || !info} onChange={event => setSelectedService(event.currentTarget.value)}><option value="">Escolha um streaming</option>{STREAMINGS.map(service => <option key={service.id} value={service.id} disabled={!service.available}>{service.available ? service.name : `${service.name} — em implementação`}</option>)}</select><button id="save-streaming" class="btn btn-primary" type="submit" disabled={busy || !info}>Salvar preferência</button></form>
          <Feedback id="preference-feedback">{preferenceFeedback}</Feedback>
          <section id="spotify-connection" hidden={youtube}><h2 id="spotify-heading"><StreamingIcon/>Conectar sua conta</h2><p id="connection-status" role="status">{connectionError || (!info ? "Verificando conexão…" : connected ? "Conectado ao Spotify" : "Spotify não conectado")}</p><p class="note">O login é feito na janela oficial do Spotify. Sua senha fica com o Spotify.</p><button id="connect-spotify" class="btn btn-primary" type="button" hidden={connected} disabled={busy || !info || connected} onClick={() => void connection(false)}>Conectar Spotify</button><button id="disconnect-spotify" class="btn btn-soft" type="button" hidden={!connected} disabled={busy || !connected} onClick={() => void connection(true)}>Desconectar Spotify</button><Feedback id="feedback">{initialError || feedback}</Feedback></section>
          <p id="youtube-connection" class="note" hidden={!youtube}><StreamingIcon service="youtube-music"/>YouTube Music: a busca de álbuns dispensa login. Os álbuns abrem pelo navegador.</p>
        </div>
      </details>
      <button id="open-choices" class="btn btn-soft w-full" type="button" aria-haspopup="dialog" aria-controls="choices-dialog" onClick={() => {dialog.current?.showModal(); rememberedInput.current?.focus(); void loadPreferences().catch(error => setChoicesFeedback(errorMessage(error)));}}>Escolhas salvas</button>
      <dialog id="choices-dialog" ref={dialog} aria-labelledby="choices-title"><div class="dialog-header"><h2 id="choices-title">Escolhas salvas</h2><button id="close-choices" class="btn btn-ghost btn-square" type="button" aria-label="Fechar escolhas salvas" onClick={() => dialog.current?.close()}>×</button></div><div class="dialog-content">
        <label for="remembered-search">Buscar nas escolhas</label><input id="remembered-search" class="input w-full" ref={rememberedInput} type="search" placeholder="Álbum, artista ou código" autoComplete="off" value={choiceSearch} onInput={event => {setChoiceSearch(event.currentTarget.value); setPage(1);}}/>
        <p id="choices-count" class="note" role="status">{preferences.choices.length === 0 ? "Nenhuma escolha salva ainda. Escolha um álbum no Libib para criar uma associação." : !filtered.length ? "Nenhuma associação encontrada para esta busca." : `${start + 1}–${Math.min(start + 20, filtered.length)} de ${filtered.length} associações${normalizedSearch ? ` (${preferences.choices.length} no total)` : ""}`}</p>
        <ul id="remembered-list">{filtered.slice(start, start + 20).map(choice => <li class="remembered-choice card card-border" key={choice.key}><h3>{choiceTitle(choice)}</h3><p>{choice.artist.name} · {STREAMINGS.find(s => s.id === choice.service)?.name ?? choice.service}</p><p class="note">{choice.album ? `Álbum lembrado: ${choice.album.title}` : "Somente o artista foi lembrado."}</p><button class="btn btn-soft btn-sm" type="button" disabled={busy} aria-label={`Esquecer ${choiceTitle(choice)} de ${choice.artist.name}`} onClick={() => void forget(choice)}>Esquecer escolha</button></li>)}</ul>
        <nav id="choices-pagination" class="choices-pagination" aria-label="Páginas de escolhas salvas" hidden={!filtered.length}><button id="choices-previous" class="btn btn-soft btn-sm" type="button" disabled={currentPage === 1} onClick={() => {setPage(currentPage - 1); if (dialog.current) dialog.current.scrollTop = 0;}}>Anterior</button><span id="choices-page" role="status" aria-live="polite">Página {currentPage} de {pages}</span><button id="choices-next" class="btn btn-soft btn-sm" type="button" disabled={currentPage === pages} onClick={() => {setPage(currentPage + 1); if (dialog.current) dialog.current.scrollTop = 0;}}>Próxima</button></nav><Feedback id="choices-feedback">{choicesFeedback}</Feedback>
      </div></dialog>
      <LibibDiagnosticPanel revision={diagnosticRevision}/>
      <details id="search-diagnostics" class="settings-section card card-border"><summary><span class="section-title">Diagnóstico de busca</span></summary><div class="section-content"><h2>Testar busca de álbum</h2>
        <form id="album-search" onSubmit={event => {event.preventDefault(); void search();}}><label for="album-title">Álbum</label><input id="album-title" class="input w-full" placeholder="Ex.: Discovery" required maxLength={200} autoComplete="off" disabled={busy} value={title} onInput={event => editSearch("title", event.currentTarget.value)}/><label for="album-artist">Artista (opcional)</label><input id="album-artist" class="input w-full" placeholder="Ex.: Daft Punk" maxLength={200} autoComplete="off" disabled={busy} value={artist} onInput={event => editSearch("artist", event.currentTarget.value)}/><label for="album-code">UPC/EAN (opcional)</label><input id="album-code" class="input w-full" placeholder="Código de barras com 12 ou 13 dígitos" maxLength={24} inputMode="numeric" autoComplete="off" aria-describedby="code-help" disabled={busy || youtube} value={code} onInput={event => editSearch("code", event.currentTarget.value)}/><p id="code-help" class="note">{youtube ? "YouTube Music pesquisa por título e artista; UPC/EAN não são usados nesta integração." : "Se disponível no Libib, o código será tentado antes do título e artista. Preserve os zeros à esquerda."}</p><button id="search-albums" class="btn btn-primary" type="submit" disabled={busy || !available}>Buscar no {serviceName}</button></form>
        <Feedback id="search-feedback">{searchFeedback}</Feedback><ul id="results">{albums.map(album => <li key={album.id}><a class="spotify-web-link" href={album.url} target="_blank" rel="noopener noreferrer">{album.title} — {album.artists.map(a => a.name).join(", ")}<span> · {album.service === "youtube-music" ? "YouTube Music" : "Web Player"}</span></a>{album.service === "spotify" && <><br/><a class="spotify-app-link" href={`spotify:album:${album.id}`}>Abrir no aplicativo Spotify</a></>}</li>)}{fallback && <li><a href={fallback} target="_blank" rel="noopener noreferrer">Buscar no {serviceName}</a></li>}</ul><button id="load-more" class="btn btn-soft" type="button" hidden={!nextPage} disabled={busy || !available} onClick={() => void search(true)}>Carregar mais resultados</button><button id="export-search-log" class="btn btn-soft" type="button" disabled={busy} onClick={() => void exportSearch()}>Exportar log da busca</button><Feedback id="export-feedback">{exportFeedback}</Feedback><p class="note">Esta busca é para diagnóstico. Para escolher e lembrar um álbum da coleção, use o botão no próprio Libib.</p>
      </div></details>
      <details id="technical-settings" class="settings-section card card-border"><summary><span class="section-title">Dados técnicos do Spotify</span></summary><div class="section-content"><p class="note">O Client ID identifica Collection to Play, não sua conta. Em Settings no Spotify, Redirect URIs deve conter exatamente o endereço abaixo.</p><label for="client-id">Client ID do Spotify</label><input id="client-id" class="input w-full" readOnly spellcheck={false} value={info?.spotify.clientId ?? ""}/><label for="redirect-url">Redirect URI</label><textarea id="redirect-url" class="textarea w-full" ref={redirect} readOnly spellcheck={false} rows={3} value={info?.spotify.redirectUrl ?? ""}/><button id="copy-redirect" class="btn btn-soft" type="button" disabled={!info} onClick={() => {void navigator.clipboard.writeText(info?.spotify.redirectUrl ?? "").then(() => setFeedback("Endereço copiado."), () => {redirect.current?.focus(); redirect.current?.select(); setFeedback("Selecione e copie o endereço com Ctrl+C ou ⌘C.");});}}>Copiar endereço de retorno</button><label for="extension-id">ID da extensão</label><input id="extension-id" class="input w-full" readOnly spellcheck={false} value={info?.extensionId ?? ""}/><p class="note"><a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">Abrir Spotify Developer Dashboard</a></p></div></details>
    </main><footer><a id="open-library" href={info?.catalog.libraryUrl ?? "https://www.libib.com/library"} target="_blank" rel="noopener noreferrer">Abrir biblioteca no Libib</a></footer>
  </>;
}
document.body.classList.toggle("full-page", new URLSearchParams(location.search).get("view") === "full");
const root = document.getElementById("setup-root");
if (root) {root.replaceChildren(); render(<Setup/>, root); window.addEventListener("pagehide", () => render(null, root), {once: true});}
