import { isYouTubeArtwork } from "./youtube-music.js";
import { spotifyIcon, youtubeMusicIcon } from "./spotify-brand.js";
import { isSupportedCatalogUrl, type AlbumCandidate, type AlbumOpenTarget, type AlbumSearchReply, type AppReply, type AppRequest, type SetupInfo } from "./contracts.js";

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Elemento ausente: ${selector}`);
  return found;
}
const params = new URLSearchParams(location.search);
const sourceUrl = params.get("source") ?? "";
const target: AlbumOpenTarget = params.get("target") === "app" ? "app" : "web";
const title = element<HTMLInputElement>("#album-title");
const artist = element<HTMLInputElement>("#album-artist");
const status = element<HTMLParagraphElement>("#status");
const results = element<HTMLOListElement>("#results");
const remember = element<HTMLInputElement>("#remember-album");
const more = element<HTMLButtonElement>("#load-more");
const refine = element<HTMLDetailsElement>("#refine");
const fallback = element<HTMLAnchorElement>("#search-fallback");
const displayed = new Set<string>();
let nextPage: string | undefined;
let connected = false;
let youtubeMusic = false;
let serviceName = "Spotify";
let serviceReady = false;
let lastQuery: Extract<AppRequest, {type: "spotify:search"}> | undefined;
title.value = (params.get("title") ?? "").slice(0, 200);
artist.value = (params.get("artist") ?? "").slice(0, 200);

async function request<T>(message: AppRequest): Promise<T> {
  const reply: AppReply<T> | undefined = await chrome.runtime.sendMessage(message);
  if (!reply) throw new Error("A extensão não respondeu. Reabra a ação no álbum.");
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.data;
}
function busy(value: boolean): void {
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select").forEach(control => {control.disabled = value;});
}
function describeQuery(): void { element("#query").textContent = `${title.value} — ${artist.value || "artista não informado"}`; }
function icon(kind: "disc" | "app" | "web"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", kind === "disc"
    ? "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
    : kind === "app" ? "M9 5v14l11-7Z" : "M14 3h7v7M21 3 11 13M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5");
  if (kind === "app") path.setAttribute("fill", "currentColor");
  svg.append(path); return svg;
}
function showCandidate(album: AlbumCandidate, selectionId: string): void {
  if (displayed.has(album.id)) return;
  displayed.add(album.id);
  const item = document.createElement("li");
  item.className = "candidate";
  const header = document.createElement("div"); header.className = "candidate-header";
  const artwork = document.createElement("div"); artwork.className = "album-art"; artwork.append(icon("disc"));
  if (album.artworkUrl) {
    try {
      const url = new URL(album.artworkUrl);
      if (url.protocol === "https:" && ((album.service === "youtube-music" && isYouTubeArtwork(url.href)) || (album.service === "spotify" && url.hostname === "i.scdn.co" && !url.username && !url.password && !url.port && url.pathname.startsWith("/image/")))) {
        const image = document.createElement("img"); image.src = url.href;
        image.alt = `Capa de ${album.title}`; image.width = 56; image.height = 56;
        image.loading = "lazy"; image.decoding = "async"; image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => {artwork.replaceChildren(icon("disc"));}, {once: true});
        artwork.replaceChildren(image);
      }
    } catch { /* Keep the disc icon when saved artwork metadata is invalid. */ }
  }
  const info = document.createElement("div"); info.className = "candidate-info";
  const heading = document.createElement("h2"); heading.textContent = album.title;
  const credits = document.createElement("p"); credits.textContent = album.artists.map(item => item.name).join(", ");
  const date = document.createElement("p"); date.className = "release-date"; date.textContent = album.releaseDate ?? "";
  const artists = document.createElement("select");
  artists.setAttribute("aria-label", `Artista de ${album.title}`);
  artists.hidden = album.artists.length === 1;
  if (album.artists.length > 1) {
    const option = document.createElement("option"); option.value = ""; option.textContent = "Selecione o artista para lembrar"; artists.append(option);
  }
  for (const artist of album.artists) {
    const option = document.createElement("option"); option.value = artist.id; option.textContent = artist.name; artists.append(option);
  }
  const open = document.createElement("button"); open.type = "button";
  const actionLabel = youtubeMusic ? "Abrir no YouTube Music" : target === "app" ? "Abrir no aplicativo Spotify" : "Abrir no Web Player";
  open.className = "open-album";
  open.setAttribute("aria-label", actionLabel); open.title = actionLabel;
  open.append(target === "app" ? spotifyIcon() : icon("web"));
  open.addEventListener("click", async () => {
    if (!artists.value) { status.textContent = "Escolha qual artista deseja lembrar para este item."; artists.focus(); return; }
    busy(true);
    try {
      await request({type: "spotify:select", selectionId, albumId: album.id, artistId: artists.value, rememberAlbum: remember.checked, target});
      status.textContent = "Álbum aberto. Sua escolha foi salva.";
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Não foi possível abrir o álbum."; }
    finally {busy(false);}
  });
  credits.className = "candidate-artists";
  info.append(heading, credits);
  if (date.textContent) info.append(date);
  header.append(artwork, info);
  const action = document.createElement("div"); action.className = "candidate-action"; action.append(open);
  item.append(header, artists, action); results.append(item);
}
async function render(data: AlbumSearchReply): Promise<void> {
  const resolution = data.resolution;
  nextPage = undefined;
  fallback.hidden = true;
  if (resolution.status === "failed") {
    status.textContent = resolution.code === "authentication-required"
      ? "Conecte sua conta Spotify pelo ícone da extensão e depois tente novamente neste álbum."
      : resolution.message;
  } else if (resolution.status === "not-found") {
    status.textContent = displayed.size ? "Não há outros resultados nesta página." : `Nenhum álbum encontrado. Você pode ajustar a busca ou procurar no ${serviceName}.`;
    fallback.href = data.searchUrl; fallback.hidden = false;
  } else {
    if (data.autoOpen && data.selectionId && displayed.size === 0) {
      status.textContent = "Álbum identificado. Abrindo…";
      more.hidden = true;
      element("#remember-options").hidden = true;
      try {
        await request({type: "spotify:open-result", selectionId: data.selectionId, target});
        status.textContent = "Álbum aberto no destino escolhido.";
        return;
      } catch { /* Keep the identified album available for an explicit retry below. */ }
    }
    const candidates = resolution.status === "resolved" ? [resolution.album] : resolution.candidates;
    if (data.selectionId) for (const candidate of candidates) showCandidate(candidate, data.selectionId);
    if (resolution.status === "choose") nextPage = resolution.nextPage;
    status.textContent = nextPage ? "Confira os resultados ou carregue mais álbuns." : "Escolha o álbum que deseja abrir.";
  }
  more.hidden = !nextPage;
  element("#remember-options").hidden = displayed.size === 0;
}
function query(): Extract<AppRequest, {type: "spotify:search"}> {
  return {type: "spotify:search", title: title.value.trim(), artist: artist.value.trim(), sourceUrl,
    ...(params.get("title")?.trim() && params.has("artist")
      ? {lookupTitle: params.get("title")!, lookupArtist: params.get("artist")!} : {}),
    ...(params.get("upc") ? {upc: params.get("upc")!} : {}), ...(params.get("ean") ? {ean: params.get("ean")!} : {})};
}
async function search(append = false): Promise<void> {
  if (!serviceReady) {status.textContent = "Escolha seu streaming pelo ícone da extensão e reabra a ação neste álbum."; return;}
  if (!connected) { status.textContent = "Conecte sua conta Spotify pelo ícone da extensão."; return; }
  if (append && (!lastQuery || !nextPage)) return;
  busy(true); status.textContent = "Buscando álbuns…";
  const requestedPage = nextPage;
  if (!append) { results.replaceChildren(); displayed.clear(); remember.checked = false; nextPage = undefined; lastQuery = query(); }
  describeQuery();
  try {
    const data = await request<AlbumSearchReply>({...lastQuery!, ...(append && requestedPage ? {nextPage: requestedPage} : {})});
    await render(data);
    if (append && data.resolution.status === "failed") nextPage = requestedPage;
    refine.open = false;
  } catch (error) {
    if (append) nextPage = requestedPage;
    status.textContent = error instanceof Error ? error.message : "Não foi possível buscar os álbuns.";
  } finally {more.hidden = !nextPage; busy(false);}
}
element<HTMLFormElement>("#album-search").addEventListener("submit", event => {event.preventDefault(); void search();});
more.addEventListener("click", () => {void search(true);});
element<HTMLFormElement>("#album-search").addEventListener("input", () => {nextPage = undefined; more.hidden = true;});
async function initialize(): Promise<void> {
  describeQuery();
  const destination = element("#destination");
  destination.append(spotifyIcon(), document.createTextNode(target === "app" ? "Aplicativo Spotify" : "Web Player"));
  if (!isSupportedCatalogUrl(sourceUrl)) {status.textContent = "Abra esta ação a partir de um álbum no Libib."; return;}
  try {
    const setup = await request<SetupInfo>({type: "setup:get"});
    youtubeMusic = setup.preferredService === "youtube-music";
    serviceName = youtubeMusic ? "YouTube Music" : "Spotify";
    connected = youtubeMusic || setup.spotify.connected;
    if (youtubeMusic) {
      destination.replaceChildren(youtubeMusicIcon(), document.createTextNode("YouTube Music · navegador"));
      document.title = "Collection to Play — YouTube Music";
      element("h1").textContent = "Escolher álbum no YouTube Music";
      fallback.textContent = "Buscar no YouTube Music";
    }
    if (!setup.preferredService) {status.textContent = "Escolha seu streaming pelo ícone da extensão e volte a este álbum."; return;}
    if (setup.preferredService !== "spotify" && !youtubeMusic) {status.textContent = "O streaming escolhido ainda não está disponível nesta versão."; return;}
    serviceReady = true;
    const resultId = params.get("result");
    if (resultId) {
      const initial = await request<AlbumSearchReply | null>({type: "spotify:pending", id: resultId});
      if (initial) {lastQuery = query(); await render(initial); return;}
    }
    await search();
  } catch (error) {status.textContent = error instanceof Error ? error.message : "Não foi possível carregar a busca.";}
  finally {document.body.dataset["ready"] = "true";}
}
void initialize();
