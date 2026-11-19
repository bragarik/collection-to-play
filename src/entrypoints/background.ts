import {DiscogsClient, discogsCandidate, type DiscogsSearch, type DiscogsDiagnostic} from "../streamings/discogs.js";
import {discogsDescription} from "../albums/discogs-description.js";
import {UpcitemdbClient, type UpcitemdbQuery} from "../streamings/upcitemdb.js";
import {upcitemdbCandidate, upcitemdbDescription} from "../albums/upcitemdb-source.js";
import type {MetadataSearchInput, UpcitemdbSearchReply} from "../shared/contracts.js";
import {lastfmCandidate, lastfmSearchCandidate, LastfmSource} from "../albums/lastfm-source.js";
import {LastfmClient, LastfmError, isLastfmSourceId, type LastfmAlbum, type LastfmDiagnostic} from "../streamings/lastfm.js";
import {LastfmSettings} from "../shared/lastfm-settings.js";
import {loadAlbumDescription, type DescriptionDiagnostic} from "../streamings/album-description.js";
import {validateDescriptionAlbum} from "../albums/album-description.js";
import {DeezerClient, isDeezerAlbumUrl, deezerSearchUrl, type DeezerSearchEvent} from "../streamings/deezer.js";
import {ItunesClient, isItunesAlbumUrl, itunesSearchUrl, type ItunesSearchEvent} from "../streamings/itunes.js";
import { YouTubeMusicClient, youtubeMusicSearchUrl, isYouTubeAlbumUrl, type YouTubeMusicSearchEvent } from "../streamings/youtube-music.js";
import { LIBIB, SETUP_REQUEST, SPOTIFY, STREAMINGS, METADATA_SERVICE_IDS, isSupportedCatalogUrl, type AppReply, type SetupInfo } from "../shared/contracts.js";
import { searchAlbums, StreamingError, isStreamingError } from "../albums/resolution.js";
import {SpotifyApplication} from "../streamings/spotify-application.js";
import { spotifySearchUrl, type SpotifySearchEvent } from "../streamings/spotify.js";
import { LibraryPreferences } from "../shared/preferences.js";
import type { AlbumQuery, AlbumCandidate, AlbumOpenTarget } from "../shared/contracts.js";
import { normalizeProductCode, productCodeVariants, productCodesMatch } from "../albums/identifiers.js";
import { LibibDiagnosticsStore } from "../libib/libib-diagnostic-store.js";
import {bindMetadataPage, isMetadataService, isMetadataAlbumId, readMetadataPage} from "../streamings/metadata-search.js";
import {ArtworkError, fetchAlbumArtwork, type ArtworkDiagnosticEvent} from "../albums/album-artwork.js";

const youtubeMusic = new YouTubeMusicClient();
const itunes = new ItunesClient();
const deezer = new DeezerClient();
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
const lastfmSettings = new LastfmSettings({
  async load() {await storageReady;return (await chrome.storage.local.get("lastfm.apiKey"))["lastfm.apiKey"] as unknown;},
  async save(value) {await storageReady;await chrome.storage.local.set({"lastfm.apiKey": value});},
  async clear() {await storageReady;await chrome.storage.local.remove("lastfm.apiKey");},
});
const lastfm = new LastfmClient({key: () => lastfmSettings.apiKey()});
let upcitemdbWrites: Promise<void> = Promise.resolve();
const upcitemdbDiagnosticFields = ["kind", "at", "durationMs", "method", "status", "remaining", "returned", "waitMs", "code", "phase", "timeoutMs", "hasHttpResponse", "aborted", "callerAborted", "retryAfterSeconds", "browserErrorName", "browserErrorCode"];
const upcitemdb = new UpcitemdbClient({diagnostic(event) {
  upcitemdbWrites = upcitemdbWrites.catch(() => {}).then(async () => {
    await storageReady;
    const saved = (await chrome.storage.local.get("upcitemdb.diagnostic"))["upcitemdb.diagnostic"] as {events?: unknown[]} | undefined;
    const safe = Object.fromEntries(upcitemdbDiagnosticFields.flatMap(field => field in event ? [[field, (event as unknown as Record<string, unknown>)[field]]] : []));
    if (event.kind === "failure") {
      safe["browserErrorName"] = event.browserError.name;
      if (event.browserError.code ?? event.browserError.cause?.code) safe["browserErrorCode"] = event.browserError.code ?? event.browserError.cause?.code;
    }
    await chrome.storage.local.set({"upcitemdb.diagnostic": {schemaVersion: 1, events: [...(Array.isArray(saved?.events) ? saved.events.slice(-49) : []), safe]}});
  }).catch(() => {});
}});
let discogsWrites: Promise<void> = Promise.resolve();
const discogs = new DiscogsClient({
  async token() {await storageReady;const data = await chrome.storage.local.get("discogs.token");return typeof data["discogs.token"] === "string" ? data["discogs.token"] : undefined;},
  diagnostic(event: DiscogsDiagnostic) {
    discogsWrites = discogsWrites.catch(() => {}).then(async () => {
      await storageReady;
      const saved = (await chrome.storage.local.get("discogs.diagnostic"))["discogs.diagnostic"] as {events?: unknown[]} | undefined;
      const events = Array.isArray(saved?.events) ? saved.events.slice(-49) : [];
      await chrome.storage.local.set({"discogs.diagnostic": {schemaVersion: 1, events: [...events, event]}});
    });
  },
});
const preferences = new LibraryPreferences({
  async load() { await storageReady; return (await chrome.storage.local.get("library.preferences"))["library.preferences"] as unknown; },
  async save(value) { await storageReady; await chrome.storage.local.set({ "library.preferences": value }); },
});
const libibDiagnostics = new LibibDiagnosticsStore({
  async load() {await storageReady; return (await chrome.storage.local.get("libib.diagnostics"))["libib.diagnostics"] as unknown;},
  async save(value) {await storageReady; await chrome.storage.local.set({"libib.diagnostics": value});},
}, chrome.runtime.getManifest().version);
const spotifyApplication = new SpotifyApplication({
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
}, {
  async load() {await storageReady;return (await chrome.storage.local.get("spotify.clientId"))["spotify.clientId"] as unknown;},
  async save(clientId) {await storageReady;if (clientId) await chrome.storage.local.set({"spotify.clientId": clientId});else await chrome.storage.local.remove("spotify.clientId");},
});

async function queryLastfm(value: unknown) {
  const events: LastfmDiagnostic[]=[];
  try {return await lastfm.album(value,{onDiagnostic:event=>{if(events.length<10)events.push(event);}});}
  finally {try {await storageReady;await chrome.storage.local.set({"lastfm.diagnostic":{updatedAt:new Date().toISOString(),events}});}catch{/* Diagnostics must not replace the result. */}}
}
async function searchLastfm(value: unknown, page: number) {
  const events: LastfmDiagnostic[]=[];
  try {return await lastfm.search(value,{page,onDiagnostic:event=>{if(events.length<10)events.push(event);}});}
  finally {try {await storageReady;await chrome.storage.local.set({"lastfm.diagnostic":{updatedAt:new Date().toISOString(),events}});}catch{/* Diagnostics must not replace the result. */}}
}
async function searchUpcitemdb(value: unknown, sourceUrl: unknown): Promise<UpcitemdbSearchReply> {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof sourceUrl !== "string" ||
    sourceUrl.length > 2048 || !isSupportedCatalogUrl(sourceUrl)) throw new StreamingError("invalid-query", "Consulta UPCitemdb inválida.");
  const input = value as Record<string, unknown>;
  if (typeof input["title"] !== "string" || input["title"].length > 512 ||
    input["artist"] !== undefined && (typeof input["artist"] !== "string" || input["artist"].length > 200) ||
    input["barcode"] !== undefined && (typeof input["barcode"] !== "string" || input["barcode"].length > 32) ||
    !["music", "movie"].includes(String(input["media"]))) throw new StreamingError("invalid-query", "Consulta UPCitemdb inválida.");
  const barcode = normalizeProductCode(input["barcode"] as string | undefined);
  if (input["barcode"] && !barcode) throw new StreamingError("invalid-query", "Informe um EAN ou UPC válido.");
  const query: MetadataSearchInput = {title: input["title"].trim(), artist: String(input["artist"] ?? "").trim(), sourceUrl,
    ...(barcode ? {[barcode.length === 12 ? "upc" : "ean"]: barcode} : {})};
  const cursor = readMetadataPage("upcitemdb", query, input["nextPage"]);
  const result = await upcitemdb.search({title: query.title, artist: query.artist, media: input["media"] as UpcitemdbQuery["media"],
    ...(barcode ? {barcode} : {}), ...(cursor ? {nextPage: cursor} : {})});
  return {mode: result.mode, total: result.total, candidates: result.products.map(upcitemdbCandidate),
    ...(result.nextPage ? {nextPage: bindMetadataPage("upcitemdb", query, result.nextPage)} : {})};
}
async function openStreamingAlbum(album: AlbumCandidate, target: AlbumOpenTarget): Promise<void> {
  const service = await requireStreamingPreference();
  if (album.service !== service) throw new StreamingError("invalid-query", "O streaming mudou. Reabra a busca no álbum.");
  if (album.service === "deezer" || album.service === "youtube-music" || album.service === "apple-music") {
    const valid = album.service === "deezer" ? isDeezerAlbumUrl(album.url, album.id) : album.service === "apple-music" ? isItunesAlbumUrl(album.url, album.id) : isYouTubeAlbumUrl(album.url, album.id);
    if (!valid) throw new StreamingError("invalid-response", "Link de álbum inválido.");
    if (target !== "web") throw new StreamingError("invalid-query", "Este serviço abre pelo navegador nesta versão.");
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

let artworkWrites: Promise<void> = Promise.resolve();
async function fetchAndRecordArtwork(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ArtworkError("invalid-input");
  const input = value as Record<string, unknown>, service = input["service"], albumId = input["id"];
  if (service === "lastfm" ? !isLastfmSourceId(albumId) : !isMetadataService(service) || !isMetadataAlbumId(service, albumId)) throw new ArtworkError("invalid-input");
  const startedAt = new Date().toISOString(), started = performance.now();
  const events: ArtworkDiagnosticEvent[] = [];
  let outcome: {status: "ready" | "failed"; code?: string} = {status: "failed", code: "network"};
  try {
    const file = await fetchAlbumArtwork(value, {onDiagnostic: event => {if (events.length < 100) events.push(event);}});
    outcome = {status: "ready"};
    return file;
  } catch (error) {
    outcome = {status: "failed", code: error instanceof ArtworkError ? error.code : "network"};
    throw error;
  } finally {
    const entry = {albumId, startedAt, finishedAt: new Date().toISOString(), durationMs: Math.max(0, Math.round(performance.now() - started)), timeoutMs: 20000, events, outcome};
    const persist = artworkWrites.then(async () => {
      await storageReady;
      const key = `${service}.artworkDiagnostic`;
      const previous = (await chrome.storage.local.get(key))[key] as {attempts?: unknown[]} | undefined;
      await chrome.storage.local.set({[key]: {format: "collection-to-play-artwork", schemaVersion: 1, service,
        extensionVersion: chrome.runtime.getManifest().version, updatedAt: entry.finishedAt,
        attempts: [...(Array.isArray(previous?.attempts) ? previous.attempts.slice(-4) : []), entry]}});
    });
    artworkWrites = persist.catch(() => {});
    // Diagnostic storage must not turn a usable image into a download failure.
    await artworkWrites;
  }
}

let descriptionWrites: Promise<void> = Promise.resolve();
async function fetchAndRecordDescription(value: unknown) {
  const album = validateDescriptionAlbum(value), events: DescriptionDiagnostic[] = [];
  const startedAt = new Date().toISOString();
  let outcome: {status: "ready" | "failed"; code?: string} = {status: "failed", code: "unexpected"};
  try {
    const result = await loadAlbumDescription(album, {spotifyDetails: async (id, signal, onStatus) => (await spotifyApplication.get()).descriptionDetails(id, signal, onStatus),
      onDiagnostic: event => {if (events.length < 30) events.push(event);}});
    outcome = {status: "ready"};return result;
  } catch (error) {outcome = {status: "failed", code: error instanceof StreamingError ? error.code : "unexpected"};throw error;}
  finally {
    const entry = {albumId: album.id, startedAt, finishedAt: new Date().toISOString(), events, outcome};
    const persist = descriptionWrites.then(async () => {
      await storageReady;const key = `${album.service}.descriptionDiagnostic`;
      const previous = (await chrome.storage.local.get(key))[key] as {attempts?: unknown[]} | undefined;
      await chrome.storage.local.set({[key]: {service: album.service, attempts: [...(Array.isArray(previous?.attempts) ? previous.attempts.slice(-4) : []), entry]}});
    });
    descriptionWrites = persist.catch(() => {});await descriptionWrites;
  }
}

async function exportSearchDiagnostic(): Promise<unknown> {
  await storageReady;
  const service = await preferences.getService();
  await artworkWrites;await descriptionWrites;await discogsWrites.catch(() => {});await upcitemdbWrites.catch(() => {});
  const searchByService: Record<string, unknown> = {};
  for (const id of ["spotify", "youtube-music", "apple-music", "deezer"]) {
    const key = `${id}.searchDiagnostic`;
    const value = (await chrome.storage.local.get(key))[key];
    if (value) searchByService[id] = value;
  }
  const diagnosticFields = ["at", "stage", "durationMs", "status", "code", "tracks", "hasAbout", "method", "query", "language", "count", "outcome", "page"];
  for (const id of ["lastfm", "tmdb", "discogs", "upcitemdb"]) {
    const key = `${id}.diagnostic`;
    const saved = (await chrome.storage.local.get(key))[key] as {updatedAt?: string; events?: Record<string, unknown>[]} | undefined;
    if (!Array.isArray(saved?.events) || !saved.events.length) continue;
    const events = saved.events.slice(-50).filter(event => event && typeof event === "object").map(event => {
      const safe: Record<string, string | number | boolean> = {};
      for (const field of id === "upcitemdb" ? upcitemdbDiagnosticFields : diagnosticFields) {
        const value = event[field];
        if (typeof value === "string") safe[field] = value.slice(0, field === "query" ? 512 : 100);
        else if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) safe[field] = value;
      }
      return safe;
    });
    searchByService[id] = {service: id, events};
  }
  const descriptionEntries = await Promise.all(METADATA_SERVICE_IDS.map(async id => [id, (await chrome.storage.local.get(`${id}.descriptionDiagnostic`))[`${id}.descriptionDiagnostic`]] as const));
  const descriptionByService = Object.fromEntries(descriptionEntries.filter(([, value]) => Boolean(value)));
  const artworkEntries = await Promise.all(METADATA_SERVICE_IDS.map(async id => {
    const key = `${id}.artworkDiagnostic`;
    return [id, (await chrome.storage.local.get(key))[key]] as const;
  }));
  const artworkByService = Object.fromEntries(artworkEntries.filter(([, value]) => Boolean(value)));
  const attachArtwork = (value: unknown): unknown => {
    if (!Object.keys(searchByService).length && !Object.keys(artworkByService).length && !Object.keys(descriptionByService).length) return value ?? null;
    return {...(value && typeof value === "object" ? value : {format: "collection-to-play-search", schemaVersion: 1,
      extensionVersion: chrome.runtime.getManifest().version, service: service ?? "spotify", batches: []}), ...(Object.keys(searchByService).length ? {searchByService} : {}), ...(Object.keys(artworkByService).length ? {artworkByService} : {}), ...(Object.keys(descriptionByService).length ? {descriptionByService} : {})};
  };
  if (service === "deezer" || service === "youtube-music" || service === "apple-music") {
    const key = `${service}.searchDiagnostic`;
    return attachArtwork((await chrome.storage.local.get(key))[key]);
  }
  const stored = (await chrome.storage.local.get("spotify.searchDiagnostic"))["spotify.searchDiagnostic"] as {
    query?: {upc?: string; ean?: string}; batches?: {events?: SpotifySearchEvent[]; outcome?: {albumId?: string}}[];
  } | undefined;
  if (!stored) return attachArtwork(null);
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
      const {album, externalIds} = await (await spotifyApplication.get()).albumDetails(id);
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
  return attachArtwork({...stored, detailsExportedAt: new Date().toISOString(), albumDetails, albumDetailsNotQueried: ids.size - albumDetails.length, albumDetailsLimit: 20});
}

async function requireStreamingPreference(): Promise<"spotify" | "youtube-music" | "apple-music" | "deezer"> {
  const service = await preferences.getService();
  if (!service) throw new StreamingError("configuration-required", "Escolha seu streaming pelo ícone da extensão antes de ouvir.");
  if (service !== "spotify" && service !== youtubeMusic.id && service !== itunes.id && service !== deezer.id) throw new StreamingError("unavailable", "O streaming escolhido ainda não está disponível nesta versão.");
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
    case "upcitemdb:search": return searchUpcitemdb(message["query"], message["sourceUrl"]);
    case "discogs:status": {
      await storageReady;
      return {configured: Boolean((await chrome.storage.local.get("discogs.token"))["discogs.token"])};
    }
    case "discogs:configure": {
      const token = message["token"];
      if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{20,256}$/.test(token.trim())) throw new StreamingError("invalid-query", "Confira o token pessoal do Discogs.");
      await storageReady;
      await chrome.storage.local.set({"discogs.token": token.trim()});
      return {configured: true};
    }
    case "discogs:clear":
      await storageReady;
      await chrome.storage.local.remove("discogs.token");
      return {configured: false};
    case "discogs:diagnostics": {
      await discogsWrites.catch(() => {});
      await storageReady;
      const saved = (await chrome.storage.local.get("discogs.diagnostic"))["discogs.diagnostic"] as {events?: Record<string, unknown>[]} | undefined;
      return {schemaVersion: 1, events: (Array.isArray(saved?.events) ? saved.events : []).slice(-50).map(event => ({
        at: event["at"], stage: event["stage"], durationMs: event["durationMs"], status: event["status"],
        outcome: event["outcome"], count: event["count"], page: event["page"],
      }))};
    }
    case "discogs:search":
      if (!message["query"] || typeof message["query"] !== "object") throw new StreamingError("invalid-query", "Consulta Discogs inválida.");
      return discogs.search(message["query"] as DiscogsSearch);
    case "discogs:release": {
      if (typeof message["id"] !== "string") throw new StreamingError("invalid-query", "Edição inválida.");
      const release = await discogs.release(message["id"]);
      return {release, candidate: discogsCandidate(release), description: discogsDescription(release)};
    }
    case "metadata:description": {
      if (typeof message["sourceUrl"] !== "string" || message["sourceUrl"].length > 2048 || !isSupportedCatalogUrl(message["sourceUrl"])) throw new StreamingError("invalid-query", "Origem da biblioteca inválida.");
      const requestedAlbum = validateDescriptionAlbum(message["album"]);
      if (requestedAlbum.service === "upcitemdb") return upcitemdbDescription(requestedAlbum);
      if (requestedAlbum.service === "discogs") return discogsDescription(await discogs.release(requestedAlbum.id));
      return fetchAndRecordDescription(requestedAlbum);
    }
    case "metadata:artwork": {
      if (typeof message["sourceUrl"] !== "string" || message["sourceUrl"].length > 2048 || !isSupportedCatalogUrl(message["sourceUrl"])) {
        throw new ArtworkError("invalid-input");
      }
      return fetchAndRecordArtwork(message["album"]);
    }
    case "metadata:services": {
      const connection = await (await spotifyApplication.get()).status();
      return {configurationUrl: chrome.runtime.getURL("setup.html"), services: [
        {id: "spotify", name: "Spotify", requiresAuthentication: true, connected: connection.connected},
        {id: "youtube-music", name: "YouTube Music", requiresAuthentication: false, connected: true},
        {id: "apple-music", name: "iTunes", requiresAuthentication: false, connected: true},
        {id: "deezer", name: "Deezer", requiresAuthentication: false, connected: true},
        {id: "lastfm", name: "Last.fm", requiresAuthentication: false, connected: await lastfmSettings.configured()},
        {id: "discogs", name: "Discogs", requiresAuthentication: true, connected: Boolean((await chrome.storage.local.get("discogs.token"))["discogs.token"])},
        {id: "upcitemdb", name: "UPCitemdb", requiresAuthentication: false, connected: true},
      ]};
    }
    case SETUP_REQUEST: {
      const connection = await (await spotifyApplication.get()).status();
      const preferredService = await preferences.getService();
      const setup: SetupInfo = {
        ...(preferredService ? {preferredService} : {}),
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        spotify: {
          clientId: await spotifyApplication.configuredClientId(),
          redirectUrl: chrome.identity.getRedirectURL(SPOTIFY.redirectPath),
          connected: connection.connected,
        },
        catalog: LIBIB,
      };
      return setup;
    }
    case "library:get-service": return {service: await preferences.getService()};
    case "library:observe": return libibDiagnostics.record(message["observation"]);
    case "library:edit-diagnostic": return libibDiagnostics.recordEdit(message["event"]);
    case "libib:diagnostics": {
      try {return await libibDiagnostics.read();}
      catch (error) {
        if (error instanceof TypeError) throw new StreamingError("invalid-response", "O diagnóstico Libib tem formato desconhecido ou inválido. Confira a versão da extensão e preserve os dados existentes.");
        throw error;
      }
    }
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
    case "lastfm:album": return queryLastfm(message);
    case "lastfm:artwork": {
      const source = new LastfmSource(message["album"] as LastfmAlbum);
      try {return await fetchAndRecordArtwork(source.artworkInput());} finally {source.dispose();}
    }
    case "lastfm:status": return {configured: await lastfmSettings.configured()};
    case "lastfm:configure": {
      try {await lastfmSettings.save(message["apiKey"]);} catch {throw new StreamingError("invalid-query", "Não foi possível salvar a API key Last.fm. Confira a chave e tente novamente.");}
      return {configured: true};
    }
    case "lastfm:clear": await lastfmSettings.clear();return {configured: false};
    case "spotify:clear-configuration": await spotifyApplication.clearClientId();return {saved: true};
    case "spotify:configure": await spotifyApplication.setClientId(message["clientId"]); return {saved: true};
    case "spotify:connect": await (await spotifyApplication.get()).connect(); return { connected: true };
    case "spotify:disconnect": await (await spotifyApplication.get()).disconnect(); return { connected: false };
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
      if (album.service !== "spotify" && message["target"] !== "web") throw new StreamingError("invalid-query", "Este serviço abre pelo navegador nesta versão.");
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
    case "metadata:search":
    case "spotify:search": {
      if (message["type"] === "metadata:search" && message["service"] === "upcitemdb") {
        for (const key of ["ean", "upc"]) if (message[key] !== undefined && (typeof message[key] !== "string" || message[key] && !normalizeProductCode(message[key] as string))) {
          throw new StreamingError("invalid-query", "Informe um EAN ou UPC válido.");
        }
        if (message["ean"] && message["upc"] && !productCodesMatch(message["ean"] as string, message["upc"] as string)) throw new StreamingError("invalid-query", "EAN e UPC não correspondem ao mesmo código.");
        const result = await searchUpcitemdb({title: message["title"], artist: message["artist"], barcode: message["ean"] || message["upc"] || "", media: "music", nextPage: message["nextPage"]}, message["sourceUrl"]);
        return {service: "upcitemdb", configurationUrl: chrome.runtime.getURL("setup.html"), connectionRequired: false, searchUrl: "https://www.upcitemdb.com/",
          resolution: {status: "choose", candidates: result.candidates, rememberAlbumByDefault: false,
            notice: result.candidates.length || result.nextPage ? "Confira a edição física; a pesquisa por título não confirma o código do exemplar." : "Nenhum produto encontrado no UPCitemdb. Confira título ou código.",
            ...(result.nextPage ? {nextPage: result.nextPage, incomplete: true} : {})}};
      }
      if (message["type"] === "metadata:search" && message["service"] === "discogs") {
        if (typeof message["sourceUrl"] !== "string" || !isSupportedCatalogUrl(message["sourceUrl"])) throw new StreamingError("invalid-query", "Origem inválida.");
        let cursor: {page?: number; mode?: "barcode" | "title"} = {};
        const signature = JSON.stringify([message["title"], message["artist"], message["ean"], message["upc"]]);
        if (message["nextPage"] !== undefined) {
          try {
            const parsed = JSON.parse(String(message["nextPage"]));
            if (parsed.signature !== signature || !Number.isInteger(parsed.page) || !["barcode", "title"].includes(parsed.mode)) throw new Error();
            cursor = parsed;
          } catch {throw new StreamingError("invalid-query", "Esta página não pertence à busca Discogs atual.");}
        }
        const page = await discogs.search({title: message["title"] as string, artist: typeof message["artist"] === "string" ? message["artist"] : "",
          barcode: String(message["ean"] || message["upc"] || ""), media: "music", ...cursor});
        return {service: "discogs", configurationUrl: chrome.runtime.getURL("setup.html"), connectionRequired: false, searchUrl: "https://www.discogs.com/search/",
          resolution: {status: "choose", candidates: page.candidates, rememberAlbumByDefault: false,
            ...(page.page < page.pages ? {nextPage: JSON.stringify({signature, page: page.page + 1, mode: page.mode}), incomplete: true} : {})}};
      }
      if(message["type"] === "metadata:search" && message["service"] === "lastfm") {
        const title = message["title"], artist = message["artist"] ?? "", language = message["language"], sourceUrl = message["sourceUrl"];
        if(typeof sourceUrl!=="string"||!isSupportedCatalogUrl(sourceUrl)||sourceUrl.length>2048||typeof title!=="string"||!title.trim()||title.length>200||typeof artist!=="string"||artist.length>200||language!=="pt"&&language!=="en")throw new StreamingError("invalid-query","Consulta Last.fm inválida.");
        if (!artist.trim()) {
          const query = {title: title.trim(), artist: "", language, sourceUrl} as const;
          const cursor = readMetadataPage("lastfm", query, message["nextPage"]);
          if (cursor !== undefined && !/^[1-9]\d{0,2}$/.test(cursor)) throw new StreamingError("invalid-query", "Página Last.fm inválida.");
          const result = await searchLastfm(query, cursor === undefined ? 1 : Number(cursor));
          return {service: "lastfm", configurationUrl: chrome.runtime.getURL("setup.html"), connectionRequired: false,
            searchUrl: "https://www.last.fm/search/albums?q=" + encodeURIComponent(title.trim()),
            resolution: result.albums.length ? {status: "choose", candidates: result.albums.map(lastfmSearchCandidate), rememberAlbumByDefault: false,
              ...(result.page < result.pages ? {nextPage: bindMetadataPage("lastfm", query, String(result.page + 1))} : {})} : {status: "not-found"}};
        }
        if(message["nextPage"]!==undefined)throw new StreamingError("invalid-query","Consulta Last.fm inválida.");
        const album=await queryLastfm(message);
        return {service:"lastfm",configurationUrl:chrome.runtime.getURL("setup.html"),connectionRequired:false,searchUrl:album.url,
          resolution:album.status==="empty"?{status:"not-found"}:{status:"choose",candidates:[lastfmCandidate(album)],rememberAlbumByDefault:false}};
      }
      const opening = message["type"] === "spotify:open";
      const explicitMetadata = message["type"] === "metadata:search";
      if (explicitMetadata && !isMetadataService(message["service"])) throw new StreamingError("invalid-query", "Selecione um streaming disponível para buscar metadados.");
      if (explicitMetadata && (message["purpose"] !== undefined || message["lookupTitle"] !== undefined || message["lookupArtist"] !== undefined)) {
        throw new StreamingError("invalid-query", "Use somente os dados da busca de metadados atual.");
      }
      if (opening && (message["target"] !== "web" && message["target"] !== "app")) {
        throw new StreamingError("invalid-query", "Destino de abertura inválido.");
      }
      if (opening) await requireStreamingPreference();
      const title = message["title"];
      const artist = message["artist"];
      if (typeof title !== "string" || typeof artist !== "string" || !title.trim() || title.length > 200 || artist.length > 200) {
        throw new StreamingError("invalid-query", "Informe o álbum; artista é opcional. Use até 200 caracteres por campo.");
      }
      const service = explicitMetadata && isMetadataService(message["service"]) ? message["service"] : (await preferences.getService() ?? "spotify");
      if (!["spotify", "youtube-music", "apple-music", "deezer"].includes(service)) throw new StreamingError("unavailable", "O serviço escolhido ainda não está disponível.");
      if (opening && service !== "spotify" && message["target"] !== "web") throw new StreamingError("invalid-query", "Este serviço abre pelo navegador nesta versão.");
      const identifiers: { upc?: string; ean?: string } = {};
      for (const name of ["upc", "ean"] as const) {
        if (service === "apple-music" || service === "deezer") continue;
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
      if (!opening && sourceUrl && !explicitMetadata) await requireStreamingPreference();
      if (opening && !sourceUrl) throw new StreamingError("invalid-query", "Origem da biblioteca obrigatória.");
      const metadata = explicitMetadata || message["purpose"] === "metadata";
      if (metadata && !isMetadataService(service)) throw new StreamingError("unavailable", "Selecione um serviço disponível no editor para compor dados.");
      if (explicitMetadata && !sourceUrl) throw new StreamingError("invalid-query", "Origem da biblioteca obrigatória.");
      if (message["purpose"] !== undefined && (opening || !metadata || !sourceUrl)) {
        throw new StreamingError("invalid-query", "Finalidade de busca inválida.");
      }
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
      const metadataQuery = {title: query.title, artist: query.artist, sourceUrl: typeof sourceUrl === "string" ? sourceUrl : "", ...identifiers};
      const cursor = explicitMetadata && isMetadataService(service) ? readMetadataPage(service, metadataQuery, message["nextPage"]) : message["nextPage"];
      if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 8192)) {
        throw new StreamingError("invalid-query", "Continuação inválida. Faça uma nova busca.");
      }
      if (service === "apple-music" && cursor !== undefined) throw new StreamingError("invalid-query", "O iTunes não oferece continuação nesta busca. Refine o título ou artista.");
      const events: (SpotifySearchEvent | YouTubeMusicSearchEvent | ItunesSearchEvent | DeezerSearchEvent)[] = [];
      let omittedEvents = 0;
      const collectDiagnostic = (event: SpotifySearchEvent | YouTubeMusicSearchEvent | ItunesSearchEvent | DeezerSearchEvent): void => {
        if (events.length < 200) events.push(event); else omittedEvents++;
      };
      const adapter = service === "deezer"
        ? {id: deezer.id, search: (_value: typeof query, signal?: AbortSignal) => deezer.search(query, signal, cursor as string | undefined, collectDiagnostic)}
        : service === "apple-music"
        ? {id: itunes.id, search: (_value: typeof query, signal?: AbortSignal) => itunes.search(query, signal, collectDiagnostic)}
        : service === "youtube-music"
        ? {id: youtubeMusic.id, search: async (_value: typeof query, signal?: AbortSignal) => {
          await prepareYouTubeRequests();
          return youtubeMusic.search(query, signal, cursor as string | undefined, collectDiagnostic);
        }}
        : { id: "spotify" as const, search: async (_value: typeof query, signal?: AbortSignal) => (await spotifyApplication.get()).search(query, signal, cursor as string | undefined, collectDiagnostic) };
      const remembered = metadata ? undefined : await preferences.getChoice(lookupQuery, adapter.id);
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
          ...(adapter.id !== "spotify" ? {note: "Busca por título/artista; UPC/EAN não fornecidos por este serviço.", candidates: resolution.status === "resolved" ? [resolution.album] : resolution.status === "choose" ? resolution.candidates : []} : {}),
          outcome: resolution.status === "failed" ? { status: resolution.status, code: resolution.code, message: resolution.message }
            : { status: resolution.status, count: resolution.status === "resolved" ? 1 : resolution.status === "choose" ? resolution.candidates.length : 0,
              hasNext: resolution.status === "choose" && Boolean(resolution.nextPage),
              ...(resolution.status === "resolved" ? {albumId: resolution.album.id, reason: resolution.reason} : {}) } }],
      } });
      const singleAlbum = resolution.status === "resolved" ? resolution.album
        : resolution.status === "choose" && !resolution.incomplete && resolution.candidates.length === 1 ? resolution.candidates[0] : undefined;
      let selectionId: string | undefined;
      if (!metadata && query.source.catalogId === LIBIB.id && (resolution.status === "choose" || resolution.status === "resolved")) {
        for (const [id, entry] of selections) if (entry.expiresAt <= Date.now()) selections.delete(id);
        if (selections.size >= 100) selections.delete(selections.keys().next().value!);
        selectionId = crypto.randomUUID();
        selections.set(selectionId, {expiresAt: Date.now() + 600000, query: lookupQuery, automatic: Boolean(singleAlbum),
          albums: resolution.status === "resolved" ? [resolution.album] : resolution.candidates});
      }
      const data = { resolution: explicitMetadata && resolution.status === "choose" && resolution.nextPage && isMetadataService(service)
          ? {...resolution, nextPage: bindMetadataPage(service, metadataQuery, resolution.nextPage)} : resolution,
        searchUrl: adapter.id === "deezer" ? deezerSearchUrl(query.title, query.artist) : adapter.id === "apple-music" ? itunesSearchUrl(query.title, query.artist) : adapter.id === "youtube-music" ? youtubeMusicSearchUrl(query.title, query.artist) : spotifySearchUrl(query.title, query.artist),
        ...(explicitMetadata ? {service, configurationUrl: chrome.runtime.getURL("setup.html"),
          connectionRequired: resolution.status === "failed" && resolution.code === "authentication-required"} : {}),
        ...(selectionId ? {selectionId, autoOpen: Boolean(singleAlbum)} : {}) };
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
  const libraryAction = (request["type"] === "spotify:open" || request["type"] === "library:get-service" || request["type"] === "library:observe" || request["type"] === "library:edit-diagnostic") && sender.tab && sender.frameId === 0 &&
    sender.url && isSupportedCatalogUrl(sender.url) && request["sourceUrl"] === sender.url;
  if (sender.id !== chrome.runtime.id || (!extensionPage && !libraryAction)) return false;
  if ((request["type"] === "library:observe" || request["type"] === "library:edit-diagnostic") && !libraryAction) return false;

  void dispatch(request).then(
    (data) => { const reply: AppReply<unknown> = { ok: true, data }; sendResponse(reply); },
    (error: unknown) => {
      const reply: AppReply<never> = {
        ok: false,
        error: error instanceof StreamingError || error instanceof ArtworkError || error instanceof LastfmError
          ? { code: error.code, message: error.message }
          : { code: "unexpected", message: "Não foi possível concluir a operação. Recarregue a extensão e tente novamente." },
      };
      sendResponse(reply);
    },
  );
  return true;
});
