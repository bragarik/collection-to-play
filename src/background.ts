import { YouTubeMusicClient, youtubeMusicSearchUrl, isYouTubeAlbumUrl, type YouTubeMusicSearchEvent } from "./youtube-music.js";
import { LIBIB, SETUP_REQUEST, SPOTIFY, STREAMINGS, isSupportedCatalogUrl, type AppReply, type SetupInfo } from "./contracts.js";
import { searchAlbums, StreamingError, isStreamingError } from "./resolution.js";
import { SpotifyClient, spotifySearchUrl, type SpotifySearchEvent } from "./spotify.js";
import { LibraryPreferences } from "./preferences.js";
import type { AlbumQuery, AlbumCandidate, AlbumOpenTarget } from "./contracts.js";
import { normalizeProductCode, productCodeVariants, productCodesMatch } from "./identifiers.js";

const youtubeMusic = new YouTubeMusicClient();
let youtubeRequestRules: Promise<void> | undefined;
function prepareYouTubeRequests(): Promise<void> {
  if (!youtubeRequestRules) {
    youtubeRequestRules = chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1],
      addRules: [{id: 1, priority: 1,
        action: {type: "modifyHeaders", requestHeaders: [{header: "origin", operation: "remove"}]},
        condition: {regexFilter: "^https://music\\.youtube\\.com/youtubei/v1/search(?:\\?|$)",
          initiatorDomains: [chrome.runtime.id], requestMethods: ["post"], resourceTypes: ["xmlhttprequest"]},
      }],
    }).catch(() => {
      youtubeRequestRules = undefined;
      throw new StreamingError("unavailable", "Não foi possível preparar a busca YouTube Music. Recarregue a extensão e tente novamente.");
    });
  }
  return youtubeRequestRules;
}

const selections = new Map<string, { expiresAt: number; query: AlbumQuery; automatic: boolean; albums: readonly AlbumCandidate[] }>();
const pendingResults = new Map<string, { expiresAt: number; data: unknown }>();
const sessionKey = "spotify.session";
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
const preferences = new LibraryPreferences({
  async load() { await storageReady; return (await chrome.storage.local.get("library.preferences"))["library.preferences"] as unknown; },
  async save(value) { await storageReady; await chrome.storage.local.set({ "library.preferences": value }); },
});
const spotify = new SpotifyClient({
  clientId: SPOTIFY.clientId,
  redirectUrl: chrome.identity.getRedirectURL(SPOTIFY.redirectPath),
  launchAuth: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }),
  store: {
    async load() {
      await storageReady;
      const value = await chrome.storage.local.get(sessionKey);
      return value[sessionKey] as unknown;
    },
    async save(session) { await storageReady; await chrome.storage.local.set({ [sessionKey]: session }); },
    async clear() { await storageReady; await chrome.storage.local.remove(sessionKey); },
  },
});

async function openStreamingAlbum(album: AlbumCandidate, target: AlbumOpenTarget): Promise<void> {
  const service = await requireStreamingPreference();
  if (album.service !== service) throw new StreamingError("invalid-query", "O streaming mudou. Reabra a busca no álbum.");
  if (album.service === "youtube-music") {
    if (!isYouTubeAlbumUrl(album.url, album.id)) throw new StreamingError("invalid-response", "Link de álbum inválido.");
    if (target !== "web") throw new StreamingError("invalid-query", "YouTube Music abre pelo navegador nesta versão.");
    await chrome.tabs.create({url: album.url});
    return;
  }
  const url = new URL(album.url);
  if (!/^[a-zA-Z0-9]{22}$/.test(album.id) || url.origin !== "https://open.spotify.com" ||
    !new RegExp(`^/(?:intl-[a-z]{2}/)?album/${album.id}/?$`).test(url.pathname)) {
    throw new StreamingError("invalid-response", "Link de álbum inválido.");
  }
  await chrome.tabs.create({ url: target === "app" ? `spotify:album:${album.id}` : album.url });
}

async function exportSearchDiagnostic(): Promise<unknown> {
  await storageReady;
  if (await preferences.getService() === "youtube-music") return (await chrome.storage.local.get("youtube-music.searchDiagnostic"))["youtube-music.searchDiagnostic"] ?? null;
  const stored = (await chrome.storage.local.get("spotify.searchDiagnostic"))["spotify.searchDiagnostic"] as {
    query?: {upc?: string; ean?: string}; batches?: {events?: SpotifySearchEvent[]; outcome?: {albumId?: string}}[];
  } | undefined;
  if (!stored) return null;
  const ids = new Set<string>();
  const add = (id: unknown): void => { if (typeof id === "string" && /^[a-zA-Z0-9]{22}$/.test(id)) ids.add(id); };
  for (const batch of [...(stored.batches ?? [])].reverse()) {
    add(batch.outcome?.albumId);
    for (const event of [...(batch.events ?? [])].reverse()) {
      if (event.kind === "page") for (const album of event.candidates ?? []) add(album.id);
    }
  }
  const requestedCodes = productCodeVariants(stored.query?.upc, stored.query?.ean);
  const albumDetails: unknown[] = [];
  for (const id of [...ids].slice(0, 20)) {
    try {
      const {album, externalIds} = await spotify.albumDetails(id);
      const returnedCodes = productCodeVariants(externalIds.upc ?? undefined, externalIds.ean ?? undefined);
      const matches = requestedCodes.some(code => returnedCodes.some(returned => productCodesMatch(code, returned)));
      albumDetails.push({id, title: album.title, artists: album.artists, url: album.url,
        requestedCodes, externalIds, normalizedIds: {upc: album.upc ?? null, ean: album.ean ?? null},
        comparison: !requestedCodes.length ? "not-requested" : !externalIds.upc && !externalIds.ean ? "unavailable"
          : !returnedCodes.length ? "invalid-returned-code" : matches ? "match" : "different",
        matchesRequestedCode: requestedCodes.length && returnedCodes.length ? matches : null,
      });
    } catch (error) {
      albumDetails.push({id, error: isStreamingError(error) ? {code: error.code, message: error.message} : {code: "unexpected", message: "Não foi possível consultar os detalhes."}});
      break;
    }
  }
  return {...stored, detailsExportedAt: new Date().toISOString(), albumDetails, albumDetailsNotQueried: ids.size - albumDetails.length, albumDetailsLimit: 20};
}

async function requireStreamingPreference(): Promise<"spotify" | "youtube-music"> {
  const service = await preferences.getService();
  if (!service) throw new StreamingError("configuration-required", "Escolha seu streaming pelo ícone da extensão antes de ouvir.");
  if (service !== spotify.id && service !== youtubeMusic.id) throw new StreamingError("unavailable", "O streaming escolhido ainda não está disponível nesta versão.");
  return service;
}

function sameDiagnosticQuery(value: unknown, query: AlbumQuery): boolean {
  if (!value || typeof value !== "object") return false;
  const previous = value as Partial<AlbumQuery>;
  return previous.title === query.title && previous.artist === query.artist &&
    previous.upc === query.upc && previous.ean === query.ean &&
    previous.source?.catalogId === query.source.catalogId &&
    previous.source?.itemUrl === query.source.itemUrl && previous.source?.itemId === query.source.itemId;
}

async function dispatch(message: Record<string, unknown>): Promise<unknown> {
  switch (message["type"]) {
    case SETUP_REQUEST: {
      const connection = await spotify.status();
      const preferredService = await preferences.getService();
      const setup: SetupInfo = {
        ...(preferredService ? {preferredService} : {}),
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        spotify: {
          clientId: SPOTIFY.clientId,
          redirectUrl: chrome.identity.getRedirectURL(SPOTIFY.redirectPath),
          connected: connection.connected,
        },
        catalog: LIBIB,
      };
      return setup;
    }
    case "library:get-service": return {service: await preferences.getService()};
    case "preferences:get": return { service: await preferences.getService(), choices: await preferences.listChoices() };
    case "preferences:set-service": {
      const service = STREAMINGS.find(item => item.id === message["service"] && item.available);
      if (!service) throw new StreamingError("invalid-query", "Selecione um streaming disponível.");
      await preferences.setService(service.id); return {saved: true};
    }
    case "preferences:delete": {
      if (typeof message["key"] !== "string") throw new StreamingError("invalid-query", "Registro inválido.");
      await preferences.deleteChoice(message["key"]); return {deleted: true};
    }
    case "spotify:connect": await spotify.connect(); return { connected: true };
    case "spotify:disconnect": await spotify.disconnect(); return { connected: false };
    case "spotify:diagnostics": return exportSearchDiagnostic();
    case "spotify:open-result": {
      await requireStreamingPreference();
      const id = message["selectionId"];
      const selection = typeof id === "string" ? selections.get(id) : undefined;
      if (!selection || selection.expiresAt <= Date.now() || !selection.automatic || selection.albums.length !== 1 ||
        (message["target"] !== "web" && message["target"] !== "app")) {
        throw new StreamingError("invalid-query", "Escolha um álbum entre os resultados desta busca.");
      }
      await openStreamingAlbum(selection.albums[0]!, message["target"]);
      return {opened: true};
    }
    case "spotify:select": {
      await requireStreamingPreference();
      const selectionId = message["selectionId"];
      const selection = typeof selectionId === "string" ? selections.get(selectionId) : undefined;
      if (!selection || selection.expiresAt <= Date.now()) throw new StreamingError("invalid-query", "Esta busca expirou. Busque novamente para escolher o álbum.");
      if (typeof message["rememberAlbum"] !== "boolean" || (message["target"] !== "web" && message["target"] !== "app")) {
        throw new StreamingError("invalid-query", "Escolha de álbum inválida.");
      }
      const album = selection.albums.find(item => item.id === message["albumId"]);
      const artist = album?.artists.find(item => item.id === message["artistId"]);
      if (!album || !artist) throw new StreamingError("invalid-query", "Selecione um álbum e artista desta busca.");
      if (album.service === "youtube-music" && message["target"] !== "web") throw new StreamingError("invalid-query", "YouTube Music abre pelo navegador nesta versão.");
      if (album.service !== await requireStreamingPreference()) throw new StreamingError("invalid-query", "O streaming mudou. Busque novamente.");
      await preferences.saveChoice(selection.query, album, artist.id, message["rememberAlbum"]);
      await openStreamingAlbum(album, message["target"]);
      return {opened: true};
    }
    case "spotify:pending": {
      const id = message["id"];
      if (typeof id !== "string") return null;
      const pending = pendingResults.get(id);
      pendingResults.delete(id);
      return pending && pending.expiresAt > Date.now() ? pending.data : null;
    }
    case "spotify:open":
    case "spotify:search": {
      const opening = message["type"] === "spotify:open";
      if (opening && (message["target"] !== "web" && message["target"] !== "app")) {
        throw new StreamingError("invalid-query", "Destino de abertura inválido.");
      }
      if (opening) await requireStreamingPreference();
      const title = message["title"];
      const artist = message["artist"];
      if (typeof title !== "string" || typeof artist !== "string" || !title.trim() || title.length > 200 || artist.length > 200) {
        throw new StreamingError("invalid-query", "Informe o álbum; artista é opcional. Use até 200 caracteres por campo.");
      }
      const identifiers: { upc?: string; ean?: string } = {};
      for (const name of ["upc", "ean"] as const) {
        const raw = message[name];
        if (raw === undefined || raw === "") continue;
        if (typeof raw !== "string" || !normalizeProductCode(raw)) {
          throw new StreamingError("invalid-query", "Informe um UPC/EAN válido, com 12 ou 13 dígitos, ou deixe o campo vazio.");
        }
        identifiers[name] = normalizeProductCode(raw)!;
      }
      const sourceUrl = message["sourceUrl"];
      if (sourceUrl !== undefined && (typeof sourceUrl !== "string" || sourceUrl.length > 2048 || !isSupportedCatalogUrl(sourceUrl))) {
        throw new StreamingError("invalid-query", "Origem da biblioteca inválida.");
      }
      if (!opening && sourceUrl) await requireStreamingPreference();
      if (opening && !sourceUrl) throw new StreamingError("invalid-query", "Origem da biblioteca obrigatória.");
      const query = { title: title.trim(), artist: artist.trim(), ...identifiers,
        source: { catalogId: sourceUrl ? LIBIB.id : "preview", itemUrl: typeof sourceUrl === "string" ? sourceUrl : LIBIB.libraryUrl } };
      let lookupQuery = query;
      if (message["lookupTitle"] !== undefined || message["lookupArtist"] !== undefined) {
        const lookupTitle = message["lookupTitle"]; const lookupArtist = message["lookupArtist"];
        if (!sourceUrl || typeof lookupTitle !== "string" || typeof lookupArtist !== "string" ||
          !lookupTitle.trim() || lookupTitle.length > 200 || lookupArtist.length > 200) {
          throw new StreamingError("invalid-query", "Identidade do álbum inválida.");
        }
        lookupQuery = {...query, title: lookupTitle.trim(), artist: lookupArtist.trim()};
      }
      const cursor = message["nextPage"];
      if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 8192)) {
        throw new StreamingError("invalid-query", "Continuação inválida. Faça uma nova busca.");
      }
      const events: (SpotifySearchEvent | YouTubeMusicSearchEvent)[] = [];
      let omittedEvents = 0;
      const collectDiagnostic = (event: SpotifySearchEvent | YouTubeMusicSearchEvent): void => {
        if (events.length < 200) events.push(event); else omittedEvents++;
      };
      const service = sourceUrl ? await requireStreamingPreference() : (await preferences.getService() ?? "spotify");
      const adapter = service === "youtube-music"
        ? {id: youtubeMusic.id, search: async (_value: typeof query, signal?: AbortSignal) => {
          await prepareYouTubeRequests();
          return youtubeMusic.search(query, signal, cursor as string | undefined, collectDiagnostic);
        }}
        : { id: spotify.id, search: (_value: typeof query, signal?: AbortSignal) => spotify.search(query, signal, cursor as string | undefined, collectDiagnostic) };
      const remembered = await preferences.getChoice(lookupQuery, adapter.id);
      const resolution = await searchAlbums(adapter, lookupQuery, remembered);
      await storageReady;
      const key = `${adapter.id}.searchDiagnostic`;
      const stored = (await chrome.storage.local.get(key))[key] as { query?: unknown; batches?: unknown[] } | undefined;
      const previous = cursor && sameDiagnosticQuery(stored?.query, query) && Array.isArray(stored?.batches) ? stored.batches.slice(-9) : [];
      await chrome.storage.local.set({ [key]: {
        format: "collection-to-play-search", schemaVersion: 1, extensionVersion: chrome.runtime.getManifest().version,
        updatedAt: new Date().toISOString(), service: adapter.id, query,
        note: "Até dez lotes da última busca. Não contém tokens, cabeçalhos de autorização, senha ou cookies.",
        batches: [...previous, { continued: Boolean(cursor), events, omittedEvents,
          ...(adapter.id === "youtube-music" ? {note: "Busca por título/artista; UPC/EAN não fornecidos por este serviço.", candidates: resolution.status === "resolved" ? [resolution.album] : resolution.status === "choose" ? resolution.candidates : []} : {}),
          outcome: resolution.status === "failed" ? { status: resolution.status, code: resolution.code, message: resolution.message }
            : { status: resolution.status, count: resolution.status === "resolved" ? 1 : resolution.status === "choose" ? resolution.candidates.length : 0,
              hasNext: resolution.status === "choose" && Boolean(resolution.nextPage),
              ...(resolution.status === "resolved" ? {albumId: resolution.album.id, reason: resolution.reason} : {}) } }],
      } });
      const singleAlbum = resolution.status === "resolved" ? resolution.album
        : resolution.status === "choose" && !resolution.incomplete && resolution.candidates.length === 1 ? resolution.candidates[0] : undefined;
      let selectionId: string | undefined;
      if (query.source.catalogId === LIBIB.id && (resolution.status === "choose" || resolution.status === "resolved")) {
        for (const [id, entry] of selections) if (entry.expiresAt <= Date.now()) selections.delete(id);
        if (selections.size >= 100) selections.delete(selections.keys().next().value!);
        selectionId = crypto.randomUUID();
        selections.set(selectionId, {expiresAt: Date.now() + 600000, query: lookupQuery, automatic: Boolean(singleAlbum),
          albums: resolution.status === "resolved" ? [resolution.album] : resolution.candidates});
      }
      const data = { resolution, searchUrl: adapter.id === "youtube-music" ? youtubeMusicSearchUrl(query.title, query.artist) : spotifySearchUrl(query.title, query.artist), ...(selectionId ? {selectionId, autoOpen: Boolean(singleAlbum)} : {}) };
      if (!opening) return data;
      if (singleAlbum) {
        await openStreamingAlbum(singleAlbum, message["target"] as AlbumOpenTarget);
        return { opened: true };
      }
      for (const [id, entry] of pendingResults) if (entry.expiresAt <= Date.now()) pendingResults.delete(id);
      if (pendingResults.size >= 20) pendingResults.delete(pendingResults.keys().next().value!);
      const resultId = crypto.randomUUID();
      pendingResults.set(resultId, { expiresAt: Date.now() + 120000, data });
      return { opened: false, resultId };
    }
    default: throw new StreamingError("invalid-query", "Ação desconhecida.");
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) || typeof message.type !== "string"
  ) {
    return false;
  }

  const request = message as Record<string, unknown>;
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL(""));
  const libraryAction = (request["type"] === "spotify:open" || request["type"] === "library:get-service") && sender.tab && sender.frameId === 0 &&
    sender.url && isSupportedCatalogUrl(sender.url) && request["sourceUrl"] === sender.url;
  if (sender.id !== chrome.runtime.id || (!extensionPage && !libraryAction)) return false;

  void dispatch(request).then(
    (data) => { const reply: AppReply<unknown> = { ok: true, data }; sendResponse(reply); },
    (error: unknown) => {
      const reply: AppReply<never> = {
        ok: false,
        error: error instanceof StreamingError
          ? { code: error.code, message: error.message }
          : { code: "unexpected", message: "Não foi possível concluir a operação. Recarregue a extensão e tente novamente." },
      };
      sendResponse(reply);
    },
  );
  return true;
});
