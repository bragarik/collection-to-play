import { spotifyIcon, youtubeMusicIcon } from "./spotify-brand.js";
import { SETUP_REQUEST, STREAMINGS, type AppReply, type AppRequest, type SetupInfo } from "./contracts.js";
import { normalizeMetadata, type RememberedChoice, type AlbumResolution } from "./resolution.js";
import { mountLibibDiagnosticPanel } from "./libib-diagnostic-ui.js";

document.body.classList.toggle("full-page", new URLSearchParams(location.search).get("view") === "full");

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Elemento não encontrado: ${selector}`);
  return result;
}

element("#spotify-heading").prepend(spotifyIcon());
element("#youtube-connection").prepend(youtubeMusicIcon());

const status = element<HTMLParagraphElement>("#status");
const feedback = element<HTMLParagraphElement>("#feedback");
const copyButton = element<HTMLButtonElement>("#copy-redirect");
const redirect = element<HTMLTextAreaElement>("#redirect-url");
const connectButton = element<HTMLButtonElement>("#connect-spotify");
const disconnectButton = element<HTMLButtonElement>("#disconnect-spotify");
const connectionStatus = element<HTMLParagraphElement>("#connection-status");
const searchButton = element<HTMLButtonElement>("#search-albums");
const results = element<HTMLUListElement>("#results");
const searchFeedback = element<HTMLParagraphElement>("#search-feedback");
const exportButton = element<HTMLButtonElement>("#export-search-log");
const exportFeedback = element<HTMLParagraphElement>("#export-feedback");
const moreButton = element<HTMLButtonElement>("#load-more");
let nextPage: string | undefined;
let currentQuery: Extract<AppRequest, { type: "spotify:search" }> | undefined;
const displayed = new Set<string>();
const streaming = element<HTMLSelectElement>("#preferred-streaming");
const saveStreaming = element<HTMLButtonElement>("#save-streaming");
const preferenceFeedback = element<HTMLParagraphElement>("#preference-feedback");
const rememberedSearch = element<HTMLInputElement>("#remembered-search");
const rememberedList = element<HTMLUListElement>("#remembered-list");
const choicesFeedback = element<HTMLParagraphElement>("#choices-feedback");
const choicesDialog = element<HTMLDialogElement>("#choices-dialog");
const previousChoices = element<HTMLButtonElement>("#choices-previous");
const nextChoices = element<HTMLButtonElement>("#choices-next");
const choicesPageSize = 20;
let choicesPage = 1;
function resetChoicesPage(): void {
  choicesPage = 1;
  renderChoices();
}
function scrollChoicesToTop(): void {
  choicesDialog.scrollTop = 0;
}
previousChoices.addEventListener("click", () => { choicesPage--; renderChoices(); scrollChoicesToTop(); });
nextChoices.addEventListener("click", () => { choicesPage++; renderChoices(); scrollChoicesToTop(); });
element("#open-choices").addEventListener("click", () => {
  choicesDialog.showModal();
  rememberedSearch.focus();
  void loadPreferences().catch(error => { choicesFeedback.textContent = showError(error); });
});
element("#close-choices").addEventListener("click", () => { choicesDialog.close(); });
let choices: readonly RememberedChoice[] = [];
let youtubeMusic = false;
function searchServiceName(): string { return youtubeMusic ? "YouTube Music" : "Spotify"; }
let preferencesLoaded = false;
for (const service of STREAMINGS) {
  const option = document.createElement("option"); option.value = service.id;
  option.textContent = service.available ? service.name : `${service.name} — em implementação`;
  option.disabled = !service.available; streaming.append(option);
}
function choiceTitle(choice: RememberedChoice): string {
  if (typeof choice.query?.title === "string" && choice.query.title.trim()) return choice.query.title;
  try {
    const key: unknown = JSON.parse(choice.key);
    if (Array.isArray(key) && key[3] === "metadata" && typeof key[5] === "string") return key[5];
    if (Array.isArray(key) && key[3] === "item" && typeof key[4] === "string") return `Item ${key[4]}`;
  } catch { /* Older malformed labels do not affect the stored association. */ }
  return choice.album?.title ?? "Álbum da coleção";
}
function renderChoices(): void {
  const query = normalizeMetadata(rememberedSearch.value);
  const filtered = choices.filter(choice => normalizeMetadata([
    choiceTitle(choice), choice.artist.name, choice.album?.title ?? "",
    STREAMINGS.find(service => service.id === choice.service)?.name ?? choice.service,
    choice.query?.upc ?? "", choice.query?.ean ?? "", choice.key,
  ].join(" ")).includes(query));
  rememberedList.replaceChildren();
  const pages = Math.max(1, Math.ceil(filtered.length / choicesPageSize));
  choicesPage = Math.max(1, Math.min(choicesPage, pages));
  const start = (choicesPage - 1) * choicesPageSize;
  element("#choices-count").textContent = choices.length === 0 ? "Nenhuma escolha salva ainda. Escolha um álbum no Libib para criar uma associação."
    : `${start + 1}–${Math.min(start + choicesPageSize, filtered.length)} de ${filtered.length} associações${query ? ` (${choices.length} no total)` : ""}`;
  if (choices.length > 0 && filtered.length === 0) element("#choices-count").textContent = "Nenhuma associação encontrada para esta busca.";
  element("#choices-pagination").hidden = filtered.length === 0;
  element("#choices-page").textContent = `Página ${choicesPage} de ${pages}`;
  previousChoices.disabled = choicesPage === 1;
  nextChoices.disabled = choicesPage === pages;
  for (const choice of filtered.slice(start, start + choicesPageSize)) {
    const item = document.createElement("li"); item.className = "remembered-choice";
    const heading = document.createElement("h3"); heading.textContent = choiceTitle(choice);
    const artist = document.createElement("p");
    artist.textContent = `${choice.artist.name} · ${STREAMINGS.find(service => service.id === choice.service)?.name ?? choice.service}`;
    const album = document.createElement("p"); album.className = "note";
    album.textContent = choice.album ? `Álbum lembrado: ${choice.album.title}` : "Somente o artista foi lembrado.";
    const forget = document.createElement("button"); forget.type = "button"; forget.textContent = "Esquecer escolha";
    forget.setAttribute("aria-label", `Esquecer ${choiceTitle(choice)} de ${choice.artist.name}`);
    forget.addEventListener("click", async () => {
      forget.disabled = true;
      try {
        await request({type: "preferences:delete", key: choice.key});
        await loadPreferences();
        choicesFeedback.textContent = "Escolha esquecida. As lembranças de artista e álbum foram removidas.";
      } catch (error) { choicesFeedback.textContent = showError(error); forget.disabled = false; }
    });
    item.append(heading, artist, album, forget); rememberedList.append(item);
  }
}
async function loadPreferences(refreshService = false): Promise<void> {
  const value = await request<{service?: string; choices: readonly RememberedChoice[]}>({type: "preferences:get"});
  choices = value.choices;
  if (!preferencesLoaded || refreshService) streaming.value = value.service ?? "";
  if (!preferencesLoaded) element<HTMLDetailsElement>("#streaming-section").open = !value.service || value.service === "spotify" && !connected;
  element("#first-use").hidden = Boolean(value.service);
  preferencesLoaded = true;
  youtubeMusic = value.service === "youtube-music";
  element("#streaming-section-label").textContent = STREAMINGS.find(service => service.id === value.service)?.name ?? "Não configurado";
  element("#spotify-connection").hidden = youtubeMusic;
  element("#youtube-connection").hidden = !youtubeMusic;
  searchButton.textContent = `Buscar no ${searchServiceName()}`;
  busy(false);
  renderChoices();
}
rememberedSearch.addEventListener("input", resetChoicesPage);
element<HTMLFormElement>("#streaming-settings").addEventListener("submit", async event => {
  event.preventDefault(); saveStreaming.disabled = true;
  try {
    const selected = STREAMINGS.find(service => service.id === streaming.value && service.available);
    if (!selected) throw new Error("Selecione um streaming disponível.");
    await request({type: "preferences:set-service", service: selected.id});
    await loadPreferences(true);
    results.replaceChildren(); displayed.clear(); nextPage = undefined; currentQuery = undefined; moreButton.hidden = true;
    searchFeedback.textContent = "";
    preferenceFeedback.textContent = `Preferência salva: ${selected.name}.`;
  } catch (error) {preferenceFeedback.textContent = showError(error);}
  finally {saveStreaming.disabled = false;}
});
let connected = false;

async function request<T>(message: AppRequest): Promise<T> {
  const reply: AppReply<T> | undefined = await chrome.runtime.sendMessage(message);
  if (!reply) throw new Error("A extensão não respondeu. Recarregue e tente novamente.");
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.data;
}

function busy(value: boolean): void {
  connectButton.disabled = value || connected;
  disconnectButton.disabled = value || (!connected && !youtubeMusic);
  searchButton.disabled = value || (!connected && !youtubeMusic);
  moreButton.disabled = value || (!connected && !youtubeMusic);
  exportButton.disabled = value;
  streaming.disabled = value; saveStreaming.disabled = value;
  document.querySelectorAll<HTMLInputElement>("#album-search input").forEach((input) => { input.disabled = value; });
  element<HTMLInputElement>("#album-code").disabled = value || youtubeMusic;
  element("#code-help").textContent = youtubeMusic
    ? "YouTube Music pesquisa por título e artista; UPC/EAN não são usados nesta integração."
    : "Se disponível no Libib, o código será tentado antes do título e artista. Preserve os zeros à esquerda.";
}

function showError(error: unknown): string {
  return error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente.";
}

connectButton.addEventListener("click", async () => {
  busy(true);
  connectionStatus.textContent = "Autorize o acesso na janela do Spotify…";
  try {
    await request({ type: "spotify:connect" });
    await loadSetup();
    feedback.textContent = "Conexão concluída. Você já pode testar a busca.";
  } catch (error) {
    connectionStatus.textContent = showError(error);
  } finally { busy(false); }
});

disconnectButton.addEventListener("click", async () => {
  busy(true);
  try {
    await request({ type: "spotify:disconnect" });
    results.replaceChildren();
    nextPage = undefined; currentQuery = undefined; moreButton.hidden = true; displayed.clear();
    searchFeedback.textContent = "";
    await loadSetup();
    feedback.textContent = "Conta desconectada desta extensão.";
  } catch (error) { connectionStatus.textContent = showError(error); }
  finally { busy(false); }
});

type SearchReply = { resolution: AlbumResolution; searchUrl: string };

async function performSearch(append = false): Promise<void> {
  if ((!connected && !youtubeMusic) || (append && (!currentQuery || !nextPage))) return;
  busy(true);
  if (!append) { results.replaceChildren(); displayed.clear(); nextPage = undefined; }
  moreButton.hidden = true;
  searchFeedback.textContent = `Buscando álbuns no ${searchServiceName()}…`;
  try {
    if (!append) currentQuery = {
      type: "spotify:search",
      title: element<HTMLInputElement>("#album-title").value,
      artist: element<HTMLInputElement>("#album-artist").value,
      ...(!youtubeMusic && element<HTMLInputElement>("#album-code").value.trim() ? { upc: element<HTMLInputElement>("#album-code").value.trim() } : {}),
    };
    const data = await request<SearchReply>({
      ...currentQuery!, ...(append && nextPage ? { nextPage } : {}),
    });
    const requestedPage = nextPage;
    nextPage = undefined;
    const resolution = data.resolution;
    if (resolution.status === "failed") {
      if (append) nextPage = requestedPage;
      searchFeedback.textContent = resolution.message;
    } else if (resolution.status === "not-found") {
      searchFeedback.textContent = `Nenhum álbum encontrado. Você pode tentar a busca no ${searchServiceName()}.`;
      const link = document.createElement("a");
      link.textContent = `Buscar no ${searchServiceName()}`;
      link.href = data.searchUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const item = document.createElement("li");
      item.append(link);
      results.append(item);
    } else {
      const albums = resolution.status === "resolved" ? [resolution.album] : resolution.candidates;
      searchFeedback.textContent = resolution.status === "resolved"
        ? "Álbum encontrado. Abra o link para conferir."
        : "Confira os resultados e abra o álbum desejado.";
      if (resolution.status === "choose") nextPage = resolution.nextPage;
      for (const album of albums) {
        if (displayed.has(album.id)) continue;
        displayed.add(album.id);
        const link = document.createElement("a");
        link.href = album.url;
        link.className = "spotify-web-link";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `${album.title} — ${album.artists.map((artist) => artist.name).join(", ")}`;
        const item = document.createElement("li");
        const appLink = document.createElement("a");
        appLink.href = `spotify:album:${album.id}`;
        appLink.className = "spotify-app-link";
        appLink.textContent = "Abrir no aplicativo Spotify";
        const webLabel = document.createElement("span");
        webLabel.textContent = album.service === "youtube-music" ? " · YouTube Music" : " · Web Player";
        link.append(webLabel);
        item.append(link);
        if (album.service === "spotify") item.append(document.createElement("br"), appLink);
        results.append(item);
      }
    }
    if (nextPage && resolution.status !== "failed") searchFeedback.textContent = "Resultados parciais. Confira os álbuns ou carregue mais resultados.";
    else if (append && resolution.status !== "failed") searchFeedback.textContent = "Resultados carregados. Confira os álbuns encontrados.";
    moreButton.hidden = !nextPage;
    await loadSetup();
  } catch (error) { searchFeedback.textContent = showError(error); }
  finally { moreButton.hidden = !nextPage; busy(false); }
}

element<HTMLFormElement>("#album-search").addEventListener("submit", (event) => {
  event.preventDefault(); void performSearch();
});
moreButton.addEventListener("click", () => { void performSearch(true); });
element<HTMLFormElement>("#album-search").addEventListener("input", () => {
  nextPage = undefined; moreButton.hidden = true;
});

exportButton.addEventListener("click", async () => {
  exportButton.disabled = true;
  exportFeedback.textContent = "Preparando o log da busca…";
  try {
    const data = await request<unknown>({ type: "spotify:diagnostics" });
    if (!data) { exportFeedback.textContent = "Faça uma busca antes de exportar o log."; return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `collection-to-play-busca-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    exportFeedback.textContent = "Log exportado com o diagnóstico disponível do serviço. Sem tokens ou dados de login.";
  } catch (error) { exportFeedback.textContent = showError(error); }
  finally { exportButton.disabled = false; }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(redirect.value);
    feedback.textContent = "Endereço copiado.";
  } catch {
    redirect.focus();
    redirect.select();
    feedback.textContent = "Selecione e copie o endereço com Ctrl+C ou ⌘C.";
  }
});

const libibDiagnosticPanel = mountLibibDiagnosticPanel({root: document, version: chrome.runtime.getManifest().version,
  request: () => request({type: "libib:diagnostics"})});

async function loadSetup(): Promise<void> {
  try {
    const info = await request<SetupInfo>({ type: SETUP_REQUEST });

    element<HTMLInputElement>("#client-id").value = info.spotify.clientId;
    element<HTMLInputElement>("#extension-id").value = info.extensionId;
    redirect.value = info.spotify.redirectUrl;
    element<HTMLAnchorElement>("#open-library").href = info.catalog.libraryUrl;
    status.textContent = `Versão ${info.version}`;
    connected = info.spotify.connected;
    connectionStatus.textContent = connected ? "Conectado ao Spotify" : "Spotify não conectado";
    connectButton.hidden = connected;
    disconnectButton.hidden = !connected;
    busy(false);
    copyButton.disabled = false;
    await loadPreferences();
    await libibDiagnosticPanel.refresh();
    document.body.dataset["ready"] = "true";
  } catch (error) {
    status.textContent = "Não foi possível carregar a configuração.";
    feedback.textContent = showError(error);
  }
}

void loadSetup();
