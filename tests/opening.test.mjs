import {readFile} from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const extensionId = "ajjfighekaafaklemaophkbfckidiphl";
const libraryUrl = "https://www.libib.com/library";
const albumId = "A".repeat(22);
const stored = new Map([
  ["spotify.clientId", "a".repeat(32)],
  ["spotify.session", {accessToken: "controlled-access", refreshToken: "controlled-refresh", expiresAt: Date.now() + 3600000}],
  ["library.preferences", {version: 1, service: "spotify", choices: []}],
]);
const opened = [];
let apiCalls = 0;
let youtubeCalls = 0;
let deezerCalls = 0;
let deezerMode = "exact";
const deezerFixture = JSON.parse(await readFile(new URL("./fixtures/deezer-skank-siderado.json", import.meta.url), "utf8"));
let itunesCalls = 0;
let itunesMode = "exact";
const itunesArtistFixture = JSON.parse(await readFile(new URL("./fixtures/itunes-artist-albums.json", import.meta.url), "utf8"));
const descriptionDeezer = JSON.parse(await readFile(new URL("./fixtures/description-deezer.json", import.meta.url), "utf8"));
const descriptionItunes = JSON.parse(await readFile(new URL("./fixtures/description-itunes.json", import.meta.url), "utf8"));
const itunesFixture = JSON.parse(await readFile(new URL("./fixtures/itunes-skank-siderado.json", import.meta.url), "utf8"));
let youtubeStatus = 200;
let youtubePaging = false;
let imageCalls = 0;
let imageTimeoutController;
const artworkPng = Uint8Array.from([137,80,78,71,13,10,26,10,1]);
let youtubeRule;
const youtubeFixture = JSON.parse(await readFile(new URL("./fixtures/youtube-music-search.json", import.meta.url), "utf8"));
let mode = "exact";
let listener;
const album = (id = albumId, name = "Discovery") => ({ id, name,
  artists: [{ id: "B".repeat(22), name: "Daft Punk" }],
  external_urls: { spotify: `https://open.spotify.com/album/${id}` },
  external_ids: { upc: "036000291452" },
});

globalThis.chrome = {
  declarativeNetRequest: {updateSessionRules: async ({addRules}) => {youtubeRule = addRules[0];}},
  identity: { getRedirectURL: path => `https://${extensionId}.chromiumapp.org/${path}` },
  storage: { local: {
    setAccessLevel: async ({accessLevel}) => { assert.equal(accessLevel, "TRUSTED_CONTEXTS"); },
    get: async key => ({ [key]: stored.get(key) }),
    set: async values => { for (const [key, value] of Object.entries(values)) stored.set(key, structuredClone(value)); },
    remove: async key => { stored.delete(key); },
  } },
  runtime: { id: extensionId, getURL: path => `chrome-extension://${extensionId}/${path}`, getManifest: () => ({version: "0.1.0"}),
    onMessage: { addListener: value => { listener = value; } },
  },
  tabs: { create: async options => { opened.push(options.url); return {id: opened.length}; } },
};
globalThis.fetch = async (url, init) => {
  if (new URL(url).origin === "https://i.scdn.co" || new URL(url).hostname.endsWith(".mzstatic.com") || new URL(url).hostname === "cdn-images.dzcdn.net") {
    imageCalls++;
    if (imageTimeoutController) {imageTimeoutController.abort(); throw new DOMException("private-timeout-reason", "AbortError");}
    assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error"); assert.equal(init.method, "GET");
    return new Response(artworkPng);
  }
  if (new URL(url).origin === "https://accounts.spotify.com") return Response.json({error: "invalid_grant"}, {status: 400});
  if (new URL(url).origin === "https://music.youtube.com") {
    assert.ok(youtubeRule, "preparar regra antes de consultar YouTube Music");
    youtubeCalls++;
    if (youtubeStatus === 0) throw new TypeError("Failed to fetch");
    if (youtubeStatus !== 200) return Response.json({error: {code: youtubeStatus, status: "INVALID_ARGUMENT", message: "Invalid client context"}}, {status: youtubeStatus});
    const value = structuredClone(youtubeFixture);
    if (youtubePaging && !new URL(url).searchParams.has("continuation")) value.contents.sectionListRenderer.contents[0].musicShelfRenderer.continuations = [{nextContinuationData: {continuation: "youtube-next"}}];
    if (JSON.parse(init.body).query === "Discovery Daft Punk") value.contents.sectionListRenderer.contents[0].musicShelfRenderer.contents.splice(1);
    return Response.json(value);
  }
  if (new URL(url).origin === "https://itunes.apple.com") {
    itunesCalls++;
    if (new URL(url).searchParams.get("entity") === "song") return Response.json(descriptionItunes);
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(new URL(url).searchParams.get("country"), "br");
    if (itunesMode === "artist-supplement") return Response.json(new URL(url).pathname === "/lookup" ? itunesArtistFixture.lookup : itunesArtistFixture.initial);
    if (itunesMode === "network") throw new TypeError("Failed to fetch");
    if (itunesMode === "limited") return new Response(null, {status: 429});
    if (itunesMode === "invalid") return Response.json({error: "invalid"});
    if (itunesMode === "empty") return Response.json({resultCount: 0, results: []});
    const value = structuredClone(itunesFixture);
    if (itunesMode === "ambiguous") value.results.push({...value.results[0], collectionId: 401652080, collectionViewUrl: "https://music.apple.com/br/album/siderado/401652080"});
    if (itunesMode === "partial") value.results = Array.from({length: 200}, () => value.results[0]);
    value.resultCount = value.results.length;
    return Response.json(value);
  }
  if (new URL(url).origin === "https://api.deezer.com") {
    deezerCalls++;
    if (new URL(url).pathname.startsWith("/album/")) return Response.json(descriptionDeezer);
    if (deezerMode === "error") return Response.json({error: {code: 4, message: "private-secret"}});
    const value = structuredClone(deezerFixture);
    if (deezerMode === "ambiguous") {value.data.push({...value.data[0], id: 1215479, link: "https://www.deezer.com/album/1215479"}); value.total = 2;}
    if (deezerMode === "partial") {value.total = 2; value.next = "https://api.deezer.com/search/album?q=Siderado%20Skank&index=1&limit=25";}
    return Response.json(value);
  }
  apiCalls++;
  assert.equal(new URL(url).origin, "https://api.spotify.com");
  if (mode === "offline") throw new TypeError("Failed to fetch");
  if (mode === "forbidden") return new Response(null, {status: 403});
  if (mode === "unauthorized") return new Response(null, {status: 401});
  if (new URL(url).pathname.startsWith("/v1/albums/")) {
    const data = album(new URL(url).pathname.split("/").at(-1));
    if (mode === "no-external-ids") delete data.external_ids;
    return Response.json(data);
  }
  if (mode === "many-diagnostic") return Response.json({albums: {items: Array.from({length: 25}, (_, index) => album(String(index).padStart(22, "0"))), next: null}});
  if (mode === "metadata-paging") {
    const offset = Number(new URL(url).searchParams.get("offset"));
    return Response.json({albums: {items: [album(String(offset).padStart(22, "0"))], next: offset < 50 ? "more" : null}});
  }
  const items = mode === "ambiguous" ? [album(), album("C".repeat(22), "Discovery Deluxe")] : [album()];
  return Response.json({ albums: { items, next: mode === "partial" ? "more" : null } });
};
await import("../src/entrypoints/background.ts");
const content = {id: extensionId, url: libraryUrl, tab: {id: 1}, frameId: 0};
const extension = {id: extensionId, url: `chrome-extension://${extensionId}/setup.html`};
const request = (changes = {}) => ({ type: "spotify:open", title: "Discovery", artist: "Daft Punk", sourceUrl: libraryUrl, target: "web", ...changes });
function send(message, sender = content) {
  return new Promise(resolve => {
    if (listener(message, sender, resolve) !== true) resolve(undefined);
  });
}

test("botão da biblioteca abre o álbum único direto no Web Player", async () => {
  mode = "exact";
  const before = opened.length;
  const reply = await send(request());
  assert.deepEqual(reply, {ok: true, data: {opened: true}});
  assert.equal(opened.length, before + 1);
  assert.equal(opened.at(-1), `https://open.spotify.com/album/${albumId}`);
});

test("resultados de edição aceitam somente conteúdo Libib principal e exportam dados filtrados", async () => {
  const message = {type: "library:edit-diagnostic", sourceUrl: libraryUrl,
    event: {editor: "quick", stage: "title", code: "save-unconfirmed", errorCode: "http", httpStatus: 500, title: "private-title"}};
  for (const sender of [extension, {...content, id: "other"}, {...content, frameId: 1}, {...content, tab: undefined},
    {...content, url: "https://evil.example/library"}, {...content, url: "https://www.libib.com/login"}])
    assert.equal(await send(message, sender), undefined);
  assert.equal(await send({...message, sourceUrl: libraryUrl + "/other"}), undefined);
  const before = apiCalls;
  assert.deepEqual(await send(message), {ok: true, data: {recorded: true}});
  assert.equal(await send({type: "libib:diagnostics"}), undefined);
  const report = (await send({type: "libib:diagnostics"}, extension)).data;
  assert.equal(report.report.events.at(-1).code, "save-unconfirmed");
  assert.equal(report.report.events.at(-1).httpStatus, 500);
  assert.equal(JSON.stringify(report).includes("private-title"), false);
  assert.equal(apiCalls, before);
  assert.equal((await send({...message, event: {...message.event, stage: "fill", code: "save-confirmed"}})).ok, false);
  stored.delete("libib.diagnostics");
});

test("opção de aplicativo abre a URI do álbum identificado por UPC", async () => {
  mode = "exact";
  const reply = await send(request({title: "Outro nome", artist: "Nome alternativo", upc: "036000291452", target: "app"}));
  assert.equal(reply.data.opened, true);
  assert.equal(opened.at(-1), `spotify:album:${albumId}`);
});

test("ambiguidade preserva resultado para o painel sem abrir aba nem repetir a busca", async () => {
  mode = "ambiguous";
  const before = opened.length;
  const reply = await send(request());
  assert.equal(reply.data.opened, false);
  assert.equal(opened.length, before);
  const count = apiCalls;
  const pending = await send({type: "spotify:pending", id: reply.data.resultId}, extension);
  assert.equal(pending.data.resolution.status, "choose");
  assert.equal(pending.data.resolution.candidates.length, 2);
  assert.equal(apiCalls, count);
  assert.equal((await send({type: "spotify:pending", id: reply.data.resultId}, extension)).data, null);
});

test("resultado parcial nunca abre automaticamente mesmo com um único candidato distinto", async () => {
  mode = "partial";
  const before = opened.length;
  const reply = await send(request());
  assert.equal(reply.data.opened, false);
  assert.equal(opened.length, before);
  const pending = await send({type: "spotify:pending", id: reply.data.resultId}, extension);
  assert.equal(pending.data.resolution.status, "choose");
  assert.equal(pending.data.resolution.incomplete, true);
});

test("erro de serviço fica disponível no painel sem abrir outra página", async () => {
  mode = "forbidden";
  const before = opened.length;
  const reply = await send(request());
  assert.equal(reply.data.opened, false);
  assert.equal(opened.length, before);
  const pending = await send({type: "spotify:pending", id: reply.data.resultId}, extension);
  assert.equal(pending.data.resolution.status, "failed");
  assert.equal(pending.data.resolution.code, "unavailable");
});

test("conteúdo Libib não recebe configuração, diagnóstico, sessão ou resultados pendentes", async () => {
  for (const type of ["setup:get", "spotify:diagnostics", "spotify:pending", "spotify:disconnect", "spotify:search"]) {
    assert.equal(await send({...request(), type}), undefined);
  }
});

test("ação de conteúdo rejeita outro site, extensão, iframe ou origem forjada", async () => {
  const before = apiCalls;
  for (const sender of [
    {...content, id: "other-extension"}, {...content, url: "https://www.libib.com/login"},
    {...content, url: "https://evil.example/library"}, {...content, frameId: 1},
    {...content, tab: undefined},
  ]) assert.equal(await send(request(), sender), undefined);
  assert.equal(await send(request({sourceUrl: `${libraryUrl}/other`})), undefined);
  assert.equal(apiCalls, before);
});

test("destino e origem inválidos são recusados antes de consultar a API", async () => {
  const before = apiCalls;
  assert.equal((await send(request({target: "invalid"}), extension)).error.code, "invalid-query");
  assert.equal((await send(request({sourceUrl: undefined}), extension)).error.code, "invalid-query");
  assert.equal((await send(request({sourceUrl: "https://evil.example"}), extension)).error.code, "invalid-query");
  assert.equal(apiCalls, before);
});

test("seleção explícita salva artista e álbum opcional e reabre o álbum lembrado sem API", async () => {
  mode = "ambiguous";
  const first = await send(request());
  const pending = (await send({type: "spotify:pending", id: first.data.resultId}, extension)).data;
  const selection = {type: "spotify:select", selectionId: pending.selectionId, albumId: "C".repeat(22), artistId: "B".repeat(22), rememberAlbum: false, target: "app"};
  assert.equal((await send(selection, extension)).data.opened, true);
  assert.equal(opened.at(-1), `spotify:album:${"C".repeat(22)}`);
  let prefs = (await send({type: "preferences:get"}, extension)).data;
  assert.equal(prefs.choices[0].artist.id, "B".repeat(22));
  assert.equal(prefs.choices[0].album, undefined);
  assert.equal((await send({...selection, rememberAlbum: true}, extension)).data.opened, true);
  mode = "forbidden";
  const count = apiCalls;
  assert.equal((await send(request())).data.opened, true);
  assert.equal(apiCalls, count);
  assert.equal(opened.at(-1), `https://open.spotify.com/album/${"C".repeat(22)}`);
  prefs = (await send({type: "preferences:get"}, extension)).data;
  await send({type: "preferences:delete", key: prefs.choices[0].key}, extension);
  assert.equal((await send({type: "preferences:get"}, extension)).data.choices.length, 0);
});

test("seleção rejeita álbum, artista, destino e marcação que não pertencem ao fluxo", async () => {
  mode = "ambiguous";
  const first = await send(request());
  const pending = (await send({type: "spotify:pending", id: first.data.resultId}, extension)).data;
  const selection = {type: "spotify:select", selectionId: pending.selectionId, albumId, artistId: "B".repeat(22), rememberAlbum: false, target: "web"};
  const count = opened.length;
  for (const change of [{albumId: "Z".repeat(22)}, {artistId: "other"}, {target: "javascript:"}, {rememberAlbum: "true"}, {selectionId: "missing"}]) {
    assert.equal((await send({...selection, ...change}, extension)).error.code, "invalid-query");
  }
  assert.equal(await send(selection, content), undefined);
  assert.equal(opened.length, count);
});

test("resultado expirado solicita nova busca sem abrir álbum", async () => {
  mode = "ambiguous";
  const first = await send(request());
  const pending = (await send({type: "spotify:pending", id: first.data.resultId}, extension)).data;
  const realNow = Date.now;
  const count = opened.length;
  try {
    const future = realNow() + 610000; Date.now = () => future;
    const reply = await send({type: "spotify:select", selectionId: pending.selectionId, albumId, artistId: "B".repeat(22), rememberAlbum: false, target: "web"}, extension);
    assert.equal(reply.error.code, "invalid-query");
    assert.match(reply.error.message, /expirou/);
    assert.equal(opened.length, count);
  } finally {Date.now = realNow;}
});

test("ajustar a consulta mantém a lembrança ligada aos metadados originais do Libib", async () => {
  mode = "ambiguous";
  const reply = await send({type: "spotify:search", title: "Discovery", artist: "Daft Punk", sourceUrl: libraryUrl,
    lookupTitle: "Título do catálogo [CD]", lookupArtist: "Nome do catálogo"}, extension);
  const selection = {type: "spotify:select", selectionId: reply.data.selectionId, albumId, artistId: "B".repeat(22), rememberAlbum: true, target: "web"};
  assert.equal((await send(selection, extension)).data.opened, true);
  const prefs = (await send({type: "preferences:get"}, extension)).data;
  const saved = prefs.choices.find(choice => choice.album?.id === albumId);
  assert.ok(JSON.parse(saved.key).includes("titulo do catalogo cd"));
  const count = apiCalls;
  assert.equal((await send(request({title: "Título do catálogo [CD]", artist: "Nome do catálogo"}))).data.opened, true);
  assert.equal(apiCalls, count);
  await send({type: "preferences:delete", key: saved.key}, extension);
});

test("resultado identificado pelo painel abre no destino escolhido sem repetir a API", async () => {
  mode = "exact";
  const found = await send({type: "spotify:search", title: "Discovery", artist: "Daft Punk", sourceUrl: libraryUrl}, extension);
  assert.equal(found.data.resolution.status, "resolved");
  const count = apiCalls;
  const reply = await send({type: "spotify:open-result", selectionId: found.data.selectionId, target: "app"}, extension);
  assert.equal(reply.data.opened, true);
  assert.equal(opened.at(-1), `spotify:album:${albumId}`);
  assert.equal(apiCalls, count);
});

test("abertura automática recusa ambiguidade e lista parcial com um candidato distinto", async () => {
  for (const value of ["ambiguous", "partial"]) {
    mode = value;
    const found = await send({type: "spotify:search", title: "Discovery", artist: "Daft Punk", sourceUrl: libraryUrl}, extension);
    const count = opened.length;
    const reply = await send({type: "spotify:open-result", selectionId: found.data.selectionId, target: "web"}, extension);
    assert.equal(reply.error.code, "invalid-query");
    assert.equal(opened.length, count);
  }
});

test("um único resultado completo abre mesmo quando o artista tem nome alternativo", async () => {
  mode = "exact";
  const reply = await send(request({artist: "Nome alternativo"}));
  assert.equal(reply.data.opened, true);
  assert.equal(opened.at(-1), `https://open.spotify.com/album/${albumId}`);
  const search = await send({type: "spotify:search", title: "Discovery", artist: "Nome alternativo", sourceUrl: libraryUrl}, extension);
  assert.equal(search.data.resolution.status, "choose");
  assert.equal(search.data.autoOpen, true);
  assert.equal((await send({type: "spotify:open-result", selectionId: search.data.selectionId, target: "app"}, extension)).data.opened, true);
});


test("exportação consulta UPC/EAN dos resultados por metadados e identifica código diferente", async () => {
  mode = "exact";
  await send({type: "spotify:search", title: "Discovery", artist: "Daft Punk", upc: "745099040628"}, extension);
  const diagnostic = (await send({type: "spotify:diagnostics"}, extension)).data;
  assert.equal(diagnostic.query.upc, "745099040628");
  assert.equal(diagnostic.albumDetails[0].externalIds.upc, "036000291452");
  assert.equal(diagnostic.albumDetails[0].comparison, "different");
  assert.equal(diagnostic.albumDetails[0].matchesRequestedCode, false);
  assert.doesNotMatch(JSON.stringify(diagnostic), /controlled-access|controlled-refresh|Bearer/);
});

test("exportação diferencia código ausente de código divergente", async () => {
  mode = "no-external-ids";
  await send({type: "spotify:search", title: "Discovery", artist: "Daft Punk", upc: "745099040628"}, extension);
  const diagnostic = (await send({type: "spotify:diagnostics"}, extension)).data;
  assert.deepEqual(diagnostic.albumDetails[0].externalIds, {upc: null, ean: null});
  assert.equal(diagnostic.albumDetails[0].comparison, "unavailable");
  assert.equal(diagnostic.albumDetails[0].matchesRequestedCode, null);
});

test("exportação limita detalhes e informa quantos resultados ainda não foram consultados", async () => {
  mode = "many-diagnostic";
  await send({type: "spotify:search", title: "Discovery", artist: "Daft Punk"}, extension);
  const before = apiCalls;
  const diagnostic = (await send({type: "spotify:diagnostics"}, extension)).data;
  assert.equal(diagnostic.albumDetails.length, 20);
  assert.equal(diagnostic.albumDetailsNotQueried, 5);
  assert.equal(apiCalls - before, 20);
});

test("item sem artista pode escolher e lembrar álbum e artista sem mudar a identidade original", async () => {
  mode = "ambiguous";
  const reply = await send(request({artist: ""}));
  const result = (await send({type: "spotify:pending", id: reply.data.resultId}, extension)).data;
  await send({type: "spotify:select", selectionId: result.selectionId, albumId, artistId: "B".repeat(22), rememberAlbum: true, target: "web"}, extension);
  const count = apiCalls;
  assert.equal((await send(request({artist: ""}))).data.opened, true);
  assert.equal(apiCalls, count);
  const prefs = (await send({type: "preferences:get"}, extension)).data;
  const saved = prefs.choices.find(choice => choice.query?.artist === "");
  assert.equal(saved.artist.name, "Daft Punk");
  await send({type: "preferences:delete", key: saved.key}, extension);
});


test("primeiro uso não escolhe streaming sozinho nem inicia a API antes da preferência", async () => {
  const previous = stored.get("library.preferences");
  stored.set("library.preferences", {version: 1, choices: []});
  const count = apiCalls;
  assert.equal((await send(request())).error.code, "configuration-required");
  assert.equal((await send({type: "setup:get"}, extension)).data.preferredService, undefined);
  assert.equal(apiCalls, count);
  const blockedSearch = await send({type: "spotify:search", title: "Discovery", artist: "", sourceUrl: libraryUrl}, extension);
  assert.equal(blockedSearch.error.code, "configuration-required");
  assert.equal(apiCalls, count);
  assert.equal((await send({type: "preferences:set-service", service: "amazon-music"}, extension)).error.code, "invalid-query");
  assert.equal((await send({type: "preferences:set-service", service: "spotify"}, extension)).data.saved, true);
  assert.equal((await send({type: "setup:get"}, extension)).data.preferredService, "spotify");
  stored.set("library.preferences", previous);
});


test("YouTube Music abre álbum sem Spotify e mantém lembranças separadas", async () => {
  await send({type: "preferences:set-service", service: "youtube-music"}, extension);
  const spotifyCalls = apiCalls;
  const reply = await send(request());
  assert.equal(reply.ok, true);
  assert.equal(reply.data.opened, true, JSON.stringify((await send({type: "spotify:pending", id: reply.data.resultId}, extension)).data));
  assert.equal(opened.at(-1), "https://music.youtube.com/browse/MPREb_7ltM34kr0mH");
  assert.equal(apiCalls, spotifyCalls);
  assert.ok(youtubeCalls > 0);
  assert.deepEqual(youtubeRule.action.requestHeaders, [{header: "origin", operation: "remove"}]);
  assert.deepEqual(youtubeRule.condition.initiatorDomains, [extensionId]);
  assert.deepEqual(youtubeRule.condition.requestMethods, ["post"]);
  assert.deepEqual(youtubeRule.condition.resourceTypes, ["xmlhttprequest"]);
  const ruleUrl = new RegExp(youtubeRule.condition.regexFilter);
  assert.ok(ruleUrl.test("https://music.youtube.com/youtubei/v1/search"));
  assert.ok(ruleUrl.test("https://music.youtube.com/youtubei/v1/search?continuation=test"));
  for (const url of ["https://evil.example/youtubei/v1/search", "https://music.youtube.com.evil.example/youtubei/v1/search", "https://music.youtube.com/youtubei/v1/searchother", "https://music.youtube.com/watch?v=test", "https://api.spotify.com/v1/search"]) assert.equal(ruleUrl.test(url), false);

  const first = await send(request({title: "Daft Punk Collection"}));
  const pending = (await send({type: "spotify:pending", id: first.data.resultId}, extension)).data;
  const candidate = pending.resolution.candidates[0];
  const savedBeforeInvalidTarget = (await send({type: "preferences:get"}, extension)).data.choices;
  assert.equal((await send({type: "spotify:select", selectionId: pending.selectionId, albumId: candidate.id,
    artistId: candidate.artists[0].id, rememberAlbum: true, target: "app"}, extension)).error.code, "invalid-query");
  assert.deepEqual((await send({type: "preferences:get"}, extension)).data.choices, savedBeforeInvalidTarget);
  await send({type: "spotify:select", selectionId: pending.selectionId, albumId: candidate.id,
    artistId: candidate.artists[0].id, rememberAlbum: true, target: "web"}, extension);
  const before = youtubeCalls;
  assert.equal((await send(request({title: "Daft Punk Collection"}))).data.opened, true);
  assert.equal(youtubeCalls, before);
  const prefs = (await send({type: "preferences:get"}, extension)).data;
  assert.equal(prefs.choices.find(item => item.service === "youtube-music").album.id, candidate.id);
  const log = (await send({type: "spotify:diagnostics"}, extension)).data;
  assert.equal(log.service, "youtube-music");
  assert.equal(apiCalls, spotifyCalls);
  await send({type: "preferences:set-service", service: "spotify"}, extension);
  assert.equal((await send({type: "spotify:select", selectionId: pending.selectionId, albumId: candidate.id,
    artistId: candidate.artists[0].id, rememberAlbum: true, target: "web"}, extension)).error.code, "invalid-query");
});

test("consulta do serviço pela biblioteca limita dados e rejeita outros remetentes", async () => {
  assert.deepEqual((await send({type: "library:get-service", sourceUrl: libraryUrl})).data, {service: "spotify"});
  assert.equal(await send({type: "library:get-service", sourceUrl: libraryUrl}, {...content, url: "https://evil.example"}), undefined);
});


test("exportação YouTube Music conserva o status e a mensagem HTTP da busca que falhou", async () => {
  await send({type: "preferences:set-service", service: "youtube-music"}, extension);
  youtubeStatus = 400;
  try {
    const result = await send(request({title: "Unremembered album"}));
    assert.equal(result.data.opened, false);
    const log = (await send({type: "spotify:diagnostics"}, extension)).data;
    const batch = log.batches.at(-1);
    assert.equal(batch.outcome.code, "unavailable");
    const response = batch.events.find(event => event.kind === "response");
    assert.equal(response.status, 400);
    assert.equal(response.error.status, "INVALID_ARGUMENT");
    assert.equal(response.error.message, "Invalid client context");
    assert.equal(JSON.stringify(log).includes("controlled-access"), false);
  } finally {
    youtubeStatus = 200;
    await send({type: "preferences:set-service", service: "spotify"}, extension);
  }
});

test("diagnóstico preserva lotes quando o armazenamento muda a ordem dos campos", async () => {
  await send({type: "preferences:set-service", service: "youtube-music"}, extension);
  try {
    const message = {type: "spotify:search", title: "Paginated example", artist: "Daft Punk", sourceUrl: libraryUrl};
    await send(message, extension);
    const key = "youtube-music.searchDiagnostic";
    const first = stored.get(key);
    stored.set(key, {...first, query: {source: {itemUrl: first.query.source.itemUrl, catalogId: first.query.source.catalogId}, artist: first.query.artist, title: first.query.title}});
    await send({...message, nextPage: "test-continuation"}, extension);
    let log = (await send({type: "spotify:diagnostics"}, extension)).data;
    assert.equal(log.batches.length, 2);
    assert.equal(log.batches[0].continued, false);
    assert.equal(log.batches[1].continued, true);
    await send({...message, title: "Different album", nextPage: "test-continuation"}, extension);
    log = (await send({type: "spotify:diagnostics"}, extension)).data;
    assert.equal(log.batches.length, 1);
  } finally {
    await send({type: "preferences:set-service", service: "spotify"}, extension);
  }
});

test("observações Libib são avaliadas e armazenadas sem expor o conteúdo da página", async () => {
  const before = apiCalls + youtubeCalls;
  const observation = {page: "ready", collection: {containerFound: true, musicItems: 1, itemsWithTitleElement: 1},
    title: "private-observation", cookie: "private-cookie", code: "save-confirmed"};
  const message = {type: "library:observe", sourceUrl: libraryUrl, observation};
  assert.deepEqual((await send(message)).data, {recorded: true});
  assert.deepEqual((await send(message)).data, {recorded: false});
  const state = stored.get("libib.diagnostics");
  assert.equal(state.latest.checks[0].state, "recognized");
  assert.equal(state.latest.checks[2].state, "unverified");
  assert.equal(state.latest.extensionVersion, "0.1.0");
  assert.equal(JSON.stringify(state).includes("private-"), false);
  assert.equal(apiCalls + youtubeCalls, before);
});

test("observações rejeitam configurações, iframes, outra origem e conteúdo inválido", async () => {
  const message = {type: "library:observe", sourceUrl: libraryUrl, observation: {page: "ready", collection: {containerFound: true, musicItems: 1, itemsWithTitleElement: 0}}};
  for (const sender of [extension, {...content, frameId: 1}, {...content, id: "another-extension"}, {...content, url: "https://evil.example"}, {...content, tab: undefined}]) {
    assert.equal(await send(message, sender), undefined);
  }
  assert.equal(await send({...message, sourceUrl: `${libraryUrl}/forged`}), undefined);
  const before = structuredClone(stored.get("libib.diagnostics"));
  assert.equal((await send({...message, observation: {page: "ready", collection: {containerFound: true, musicItems: -1, itemsWithTitleElement: 0}}})).ok, false);
  assert.deepEqual(stored.get("libib.diagnostics"), before);
});

test("diagnóstico Libib é lido somente pela extensão e passa pela sanitização", async () => {
  const key = "libib.diagnostics";
  const original = structuredClone(stored.get(key));
  stored.set(key, {...original, secret: "private-secret", latest: {...original.latest, url: "private-url"},
    report: {...original.report, events: original.report.events.map(event => ({...event, cookie: "private-cookie"}))}});
  try {
    assert.equal(await send({type: "libib:diagnostics"}), undefined);
    const reply = await send({type: "libib:diagnostics"}, extension);
    assert.equal(reply.ok, true);
    assert.equal(reply.data.latest.checks[0].state, "recognized");
    assert.equal(JSON.stringify(reply.data).includes("private-"), false);
    assert.equal(JSON.stringify(stored.get(key)).includes("private-"), true);
    stored.set(key, {...original, schemaVersion: 2});
    assert.equal((await send({type: "libib:diagnostics"}, extension)).error.code, "invalid-response");
    assert.equal(stored.get(key).schemaVersion, 2);
  } finally {stored.set(key, original);}
});

test("busca de metadados ignora álbum lembrado, consulta Spotify e não abre nem grava escolhas", async () => {
  await send({type: "preferences:set-service", service: "spotify"}, extension);
  mode = "exact";
  const search = {type: "spotify:search", title: "Metadata example", artist: "Daft Punk", sourceUrl: libraryUrl};
  const first = (await send(search, extension)).data;
  await send({type: "spotify:select", selectionId: first.selectionId, albumId, artistId: "B".repeat(22), rememberAlbum: true, target: "web"}, extension);
  const beforeCalls = apiCalls;
  const beforeOpened = opened.length;
  const beforePreferences = structuredClone(stored.get("library.preferences"));
  const result = (await send({...search, purpose: "metadata"}, extension)).data;
  assert.ok(apiCalls > beforeCalls);
  assert.equal(result.resolution.status, "choose");
  assert.equal(result.resolution.candidates.length, 1);
  assert.notEqual(result.resolution.reason, "remembered-album");
  assert.equal(result.selectionId, undefined);
  assert.notEqual(result.autoOpen, true);
  assert.equal(opened.length, beforeOpened);
  assert.deepEqual(stored.get("library.preferences"), beforePreferences);
});

test("metadados YouTube Music mantêm candidatos e continuação sem abrir player", async () => {
  await send({type: "preferences:set-service", service: "youtube-music"}, extension);
  try {
    const before = opened.length;
    const result = (await send({type: "spotify:search", title: "Metadata search", artist: "", sourceUrl: libraryUrl, purpose: "metadata"}, extension)).data;
    assert.equal(result.resolution.status, "choose");
    assert.equal(result.resolution.candidates.length, 3);
    assert.equal(result.selectionId, undefined);
    assert.equal(opened.length, before);
    assert.ok(youtubeCalls > 0);
  } finally {await send({type: "preferences:set-service", service: "spotify"}, extension);}
});

test("finalidade de metadados exige busca da extensão com origem Libib válida", async () => {
  const message = {type: "spotify:search", title: "Discovery", artist: "Daft Punk", sourceUrl: libraryUrl, purpose: "metadata"};
  assert.equal(await send(message, content), undefined);
  for (const changes of [{sourceUrl: undefined}, {sourceUrl: "https://evil.example"}, {purpose: "unknown"}, {type: "spotify:open", target: "web"}]) {
    assert.equal((await send({...message, ...changes}, extension)).error.code, "invalid-query");
  }
});

test("busca explícita de metadados usa cada serviço sem mudar preferência, escolhas ou abrir player", async () => {
  const preference = structuredClone(stored.get("library.preferences"));
  const before = opened.length;
  try {
    stored.delete("library.preferences"); mode = "exact";
    for (const service of ["spotify", "youtube-music"]) {
      const reply = await send({type: "metadata:search", service, title: "Discovery", artist: "Daft Punk", sourceUrl: libraryUrl}, extension);
      assert.equal(reply.ok, true); assert.equal(reply.data.service, service);
      assert.equal(reply.data.resolution.status, "resolved");
      assert.equal(reply.data.resolution.album.service, service);
      assert.equal(reply.data.selectionId, undefined); assert.equal(reply.data.autoOpen, undefined);
      assert.equal(reply.data.connectionRequired, false);
      assert.equal(reply.data.configurationUrl, `chrome-extension://${extensionId}/setup.html`);
      assert.equal(stored.has("library.preferences"), false);
    }
    assert.equal(opened.length, before);
    stored.set("library.preferences", {...preference, service: "spotify"});
    await send({type: "metadata:search", service: "youtube-music", title: "Discovery", artist: "Daft Punk", sourceUrl: libraryUrl}, extension);
    assert.equal(stored.get("library.preferences").service, "spotify");
    assert.deepEqual(stored.get("library.preferences").choices, preference.choices);
  } finally {stored.set("library.preferences", preference);}
});

test("busca de metadados e estado de conexão rejeitam conteúdo, serviços e origens inválidos", async () => {
  const message = {type: "metadata:search", service: "spotify", title: "Discovery", artist: "Daft Punk", sourceUrl: libraryUrl};
  const before = apiCalls + youtubeCalls;
  assert.equal(await send(message), undefined);
  assert.equal(await send({type: "metadata:services"}), undefined);
  for (const change of [{service: "amazon-music"}, {service: undefined}, {service: "https://evil.example"},
    {sourceUrl: undefined}, {sourceUrl: "https://evil.example/library"}, {lookupTitle: "another"}, {purpose: "metadata"}]) {
    assert.equal((await send({...message, ...change}, extension)).ok, false);
  }
  assert.equal(apiCalls + youtubeCalls, before);
});

test("estado por serviço informa conexão e link sem expor sessão ou exigir preferência global", async () => {
  const session = stored.get("spotify.session");
  try {
    stored.delete("spotify.session");
    const reply = (await send({type: "metadata:services"}, extension)).data;
    assert.deepEqual(reply.services, [
      {id: "spotify", name: "Spotify", requiresAuthentication: true, connected: false},
      {id: "youtube-music", name: "YouTube Music", requiresAuthentication: false, connected: true},
      {id: "apple-music", name: "iTunes", requiresAuthentication: false, connected: true},
      {id: "deezer", name: "Deezer", requiresAuthentication: false, connected: true},
    ]);
    const query = {type: "metadata:search", service: "spotify", title: "Discovery", artist: "Daft Punk", sourceUrl: libraryUrl};
    const offline = (await send(query, extension)).data;
    assert.equal(offline.connectionRequired, true); assert.equal(offline.resolution.code, "authentication-required");
    assert.equal((await send({...query, service: "youtube-music"}, extension)).data.resolution.status, "resolved");
    assert.doesNotMatch(JSON.stringify(reply), /controlled-access|controlled-refresh|accessToken|refreshToken/);
    stored.set("spotify.session", session);
    assert.equal((await send({type: "metadata:services"}, extension)).data.services[0].connected, true);
    assert.equal((await send(query, extension)).data.connectionRequired, false);
  } finally {stored.set("spotify.session", session);}
});

test("sessão revogada retorna caminho de conexão e atualiza o estado após falha real de autenticação", async () => {
  const session = stored.get("spotify.session"); mode = "unauthorized";
  try {
    const reply = (await send({type: "metadata:search", service: "spotify", title: "Discovery", artist: "Daft Punk", sourceUrl: libraryUrl}, extension)).data;
    assert.equal(reply.connectionRequired, true); assert.equal(reply.resolution.code, "authentication-required");
    assert.equal((await send({type: "metadata:services"}, extension)).data.services[0].connected, false);
  } finally {mode = "exact"; stored.set("spotify.session", session);}
});

test("paginação de metadados é vinculada a serviço, consulta, identificadores e origem", async () => {
  const query = {type: "metadata:search", service: "spotify", title: "Discovery", artist: "Daft Punk", sourceUrl: libraryUrl};
  mode = "metadata-paging";
  try {
    const first = (await send(query, extension)).data;
    assert.ok(first.resolution.nextPage);
    const before = apiCalls + youtubeCalls;
    for (const change of [{service: "youtube-music"}, {title: "Other"}, {artist: "Other"}, {upc: "036000291452"}, {sourceUrl: libraryUrl + "/other"}])
      assert.equal((await send({...query, ...change, nextPage: first.resolution.nextPage}, extension)).error.code, "invalid-query");
    assert.equal(apiCalls + youtubeCalls, before);
    const next = (await send({...query, nextPage: first.resolution.nextPage}, extension)).data;
    assert.equal(next.service, "spotify"); assert.equal(next.resolution.status, "choose");
    assert.equal(next.resolution.candidates[0].id, String(50).padStart(22, "0"));
    assert.equal(next.resolution.nextPage, undefined);
  } finally {mode = "exact";}
});

test("YouTube Music pagina com token vinculado e continua após mudança da preferência global", async () => {
  const preference = structuredClone(stored.get("library.preferences"));
  const query = {type: "metadata:search", service: "youtube-music", title: "Paginated example", artist: "Daft Punk", sourceUrl: libraryUrl};
  youtubePaging = true;
  try {
    const first = (await send(query, extension)).data; assert.ok(first.resolution.nextPage);
    stored.set("library.preferences", {...preference, service: "spotify"});
    const next = (await send({...query, nextPage: first.resolution.nextPage}, extension)).data;
    assert.equal(next.service, "youtube-music"); assert.equal(next.resolution.nextPage, undefined);
    assert.equal(stored.get("library.preferences").service, "spotify");
    assert.deepEqual(stored.get("library.preferences").choices, preference.choices);
  } finally {youtubePaging = false; stored.set("library.preferences", preference);}
});

test("obtenção de capa exige página da extensão e origem Libib sem permitir proxy para outros hosts", async () => {
  const message = {type: "metadata:artwork", album: {...album(), service: "spotify", artworkUrl: "https://i.scdn.co/image/controlled"}, sourceUrl: libraryUrl};
  const before = imageCalls, apiBefore = apiCalls, youtubeBefore = youtubeCalls, openedBefore = opened.length;
  const preference = structuredClone(stored.get("library.preferences"));
  assert.equal(await send(message), undefined);
  assert.equal((await send({...message, sourceUrl: "https://evil.test/library"}, extension)).ok, false);
  assert.equal((await send({...message, album: {...message.album, artworkUrl: "https://evil.test/cover"}}, extension)).error.code, "unavailable");
  assert.equal(imageCalls, before);
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async blob => {assert.equal(blob.type, "image/png");return {width: 640,height: 640,close() {}};};
  try {
    const result = await send(message, extension);
    assert.equal(result.ok, true); assert.equal(result.data.width, 640); assert.equal(result.data.byteLength, artworkPng.length);
    assert.equal(result.data.albumId, albumId); assert.equal(result.data.service, "spotify");
    assert.equal(imageCalls, before+1); assert.equal(apiCalls, apiBefore); assert.equal(youtubeCalls, youtubeBefore);
    assert.equal(opened.length, openedBefore); assert.deepEqual(stored.get("library.preferences"), preference);
    assert.equal(stored.has("artwork"), false);
    assert.doesNotMatch(JSON.stringify(result), /controlled-access|controlled-refresh|Bearer/);
  } finally {if (original === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = original;}
});


test("iTunes abre Siderado sem sessão Spotify, ignorando códigos de barras", async () => {
  const pref = structuredClone(stored.get("library.preferences")), session = stored.get("spotify.session");
  try {
    stored.set("library.preferences", {version: 1, service: "apple-music", choices: []}); stored.delete("spotify.session");
    itunesMode = "exact";
    const before = itunesCalls;
    const reply = await send(request({title: "Siderado", artist: "Skank", upc: "invalid-ignored"}));
    assert.deepEqual(reply, {ok: true, data: {opened: true}});
    assert.equal(itunesCalls, before + 1);
    assert.equal(opened.at(-1), itunesFixture.results[0].collectionViewUrl);
    const app = await send(request({title: "Siderado", artist: "Skank", target: "app"}));
    assert.equal(app.error.code, "invalid-query");
    assert.equal(itunesCalls, before + 1);
  } finally {stored.set("library.preferences", pref); stored.set("spotify.session", session);}
});

test("iTunes seleciona edição e lembra artista ou álbum sem misturar com outro serviço", async () => {
  const pref = structuredClone(stored.get("library.preferences"));
  try {
    stored.set("library.preferences", {version: 1, service: "apple-music", choices: []}); itunesMode = "ambiguous";
    const q = {type: "spotify:search", title: "Siderado", artist: "Skank", sourceUrl: libraryUrl};
    const data = (await send(q, extension)).data;
    assert.equal(data.resolution.status, "choose"); assert.equal(data.autoOpen, false);
    const select = {type: "spotify:select", selectionId: data.selectionId, albumId: "401652080", artistId: "157890919", rememberAlbum: false, target: "web"};
    const before = structuredClone(stored.get("library.preferences"));
    assert.equal((await send({...select, target: "app"}, extension)).error.code, "invalid-query");
    assert.deepEqual(stored.get("library.preferences"), before);
    assert.equal((await send(select, extension)).ok, true);
    assert.equal(stored.get("library.preferences").choices[0].album, undefined);
    assert.equal(stored.get("library.preferences").choices[0].service, "apple-music");
    assert.equal((await send({...select, rememberAlbum: true}, extension)).ok, true);
    const calls = itunesCalls;
    const again = (await send(q, extension)).data;
    assert.equal(again.resolution.reason, "remembered-album"); assert.equal(itunesCalls, calls);
    await send({type: "preferences:set-service", service: "spotify"}, extension);
    assert.equal((await send(select, extension)).error.code, "invalid-query");
  } finally {stored.set("library.preferences", pref);}
});

test("iTunes distingue ausência, limite e resposta inválida e exporta diagnóstico do próprio serviço", async () => {
  const pref = structuredClone(stored.get("library.preferences"));
  try {
    stored.set("library.preferences", {version: 1, service: "apple-music", choices: []});
    const q = {type: "spotify:search", title: "Siderado", artist: "Skank"};
    itunesMode = "empty";
    const missing = (await send(q, extension)).data;
    assert.equal(missing.resolution.status, "not-found");
    assert.equal(missing.searchUrl, "https://music.apple.com/br/search?term=Siderado+Skank");
    for (const [mode, code] of [["limited", "rate-limited"], ["invalid", "invalid-response"]]) {
      itunesMode = mode;
      assert.equal((await send(q, extension)).data.resolution.code, code);
    }
    itunesMode = "exact"; await send(q, extension);
    const calls = itunesCalls, spotifyCalls = apiCalls;
    const diagnostic = (await send({type: "spotify:diagnostics"}, extension)).data;
    assert.equal(diagnostic.service, "apple-music"); assert.equal(itunesCalls, calls); assert.equal(apiCalls, spotifyCalls);
    assert.equal(diagnostic.batches[0].candidates[0].title, "Siderado");
    assert.equal(diagnostic.batches[0].events[0].country, "br");
    assert.equal(JSON.stringify(diagnostic).includes("controlled-access"), false);
    assert.equal((await send({...q, nextPage: "invented"}, extension)).error.code, "invalid-query");
  } finally {stored.set("library.preferences", pref);}
});

test("iTunes não abre automaticamente busca truncada e separa composição da reprodução", async () => {
  const pref = structuredClone(stored.get("library.preferences"));
  try {
    stored.set("library.preferences", {version: 1, service: "apple-music", choices: []}); itunesMode = "partial";
    const before = opened.length;
    const reply = await send(request({title: "Siderado", artist: "Skank"}));
    assert.equal(reply.data.opened, false); assert.equal(opened.length, before);
    const pending = (await send({type: "spotify:pending", id: reply.data.resultId}, extension)).data;
    assert.equal(pending.resolution.incomplete, true); assert.equal(pending.autoOpen, false);
    assert.equal(pending.resolution.nextPage, undefined);
    const metadata = (await send({type: "spotify:search", title: "Siderado", artist: "Skank", sourceUrl: libraryUrl, purpose: "metadata"}, extension)).data;
    assert.equal(metadata.resolution.status, "choose"); assert.equal(metadata.selectionId, undefined);
    assert.equal(opened.length, before);
  } finally {stored.set("library.preferences", pref);}
});


test("exportação dos três serviços preserva diagnóstico técnico da falha de rede", async () => {
  const pref = structuredClone(stored.get("library.preferences")), session = stored.get("spotify.session");
  const previousMode = mode, previousYoutube = youtubeStatus, previousItunes = itunesMode;
  try {
    stored.set("spotify.session", {accessToken: "private-access", refreshToken: "private-refresh", expiresAt: Date.now() + 3600000});
    for (const service of ["spotify", "youtube-music", "apple-music"]) {
      stored.set("library.preferences", {version: 1, service, choices: []});
      mode = "offline"; youtubeStatus = 0; itunesMode = "network";
      const reply = await send({type: "spotify:search", title: "Example", artist: "Artist"}, extension);
      assert.equal(reply.data.resolution.code, "network");
      const diagnostic = (await send({type: "spotify:diagnostics"}, extension)).data;
      assert.equal(diagnostic.service, service);
      const failure = diagnostic.batches[0].events.find(event => event.kind === "failure");
      assert.equal(failure.phase, "request"); assert.equal(failure.hasHttpResponse, false); assert.equal(failure.timeoutMs, 20000);
      assert.ok(failure.durationMs >= 0); assert.ok(Number.isFinite(Date.parse(failure.at)));
      assert.deepEqual(failure.browserError, {name: "TypeError", message: "Failed to fetch"});
      assert.doesNotMatch(JSON.stringify(diagnostic), /private-access|private-refresh/);
    }
  } finally {
    stored.set("library.preferences", pref); stored.set("spotify.session", session);
    mode = previousMode; youtubeStatus = previousYoutube; itunesMode = previousItunes;
  }
});


test("composição iTunes busca sem Spotify, ignora lembranças e preserva preferência e escolhas", async () => {
  const pref = structuredClone(stored.get("library.preferences")), session = stored.get("spotify.session");
  const savedMode = itunesMode;
  try {
    itunesMode = "exact";
    stored.set("library.preferences", {version: 1, service: "apple-music", choices: []});
    const q = {type: "spotify:search", title: "Siderado", artist: "Skank", sourceUrl: libraryUrl};
    const search = (await send(q, extension)).data;
    await send({type: "spotify:select", selectionId: search.selectionId, albumId: "401652079", artistId: "157890919", rememberAlbum: true, target: "web"}, extension);
    await send({type: "preferences:set-service", service: "youtube-music"}, extension);
    stored.delete("spotify.session");
    const choices = structuredClone(stored.get("library.preferences")), openedBefore = opened.length, callsBefore = itunesCalls;
    const reply = await send({type: "metadata:search", service: "apple-music", title: "Siderado", artist: "Skank", sourceUrl: libraryUrl}, extension);
    assert.equal(reply.ok, true); assert.equal(reply.data.service, "apple-music");
    assert.equal(reply.data.connectionRequired, false); assert.equal(reply.data.resolution.album.service, "apple-music");
    assert.notEqual(reply.data.resolution.reason, "remembered-album"); assert.equal(itunesCalls, callsBefore + 1);
    assert.equal(reply.data.selectionId, undefined); assert.equal(opened.length, openedBefore);
    assert.deepEqual(stored.get("library.preferences"), choices);
    const artwork = {...reply.data.resolution.album};
    let decoded = false;
    globalThis.createImageBitmap = async () => {decoded = true;return {width: 100, height: 100, close() {}};};
    const imageBefore = imageCalls;
    const file = (await send({type: "metadata:artwork", album: artwork, sourceUrl: libraryUrl}, extension)).data;
    assert.equal(file.service, "apple-music"); assert.equal(file.width, 100); assert.ok(file.warnings.includes("low-resolution"));
    assert.ok(imageCalls > imageBefore); assert.equal(decoded, true);
  } finally {stored.set("library.preferences", pref); stored.set("spotify.session", session); itunesMode = savedMode; delete globalThis.createImageBitmap;}
});


test("log exportado inclui timeout de capa iTunes mesmo com outro serviço preferido", async t => {
  const pref=structuredClone(stored.get("library.preferences")), imageDecoder=globalThis.createImageBitmap;
  const search=stored.get("youtube-music.searchDiagnostic");
  const timer=new AbortController();t.mock.method(AbortSignal,"timeout",()=>timer.signal);
  try {
    stored.set("library.preferences",{version:1,service:"youtube-music",choices:[]});stored.delete("youtube-music.searchDiagnostic");
    imageTimeoutController=timer;
    const reply=await send({type:"metadata:artwork",sourceUrl:libraryUrl,album:{service:"apple-music",id:"401652079",artworkUrl:"https://is1-ssl.mzstatic.com/image/thumb/cover/100x100bb.jpg?token=private-query"}},extension);
    assert.equal(reply.error.code,"timeout");
    const exported=(await send({type:"spotify:diagnostics"},extension)).data;
    assert.equal(exported.service,"youtube-music");assert.deepEqual(exported.batches,[]);
    const attempt=exported.artworkByService["apple-music"].attempts.at(-1);
    assert.equal(attempt.outcome.code,"timeout");assert.equal(attempt.albumId,"401652079");
    assert.equal(attempt.events.at(-1).phase,"request");assert.equal(attempt.events.at(-1).hasHttpResponse,false);
    assert.doesNotMatch(JSON.stringify(attempt),/private-query|private-timeout-reason|dataBase64/);
  } finally {imageTimeoutController=undefined;stored.set("library.preferences",pref);stored.set("youtube-music.searchDiagnostic",search);globalThis.createImageBitmap=imageDecoder;}
});

test("histórico de capas limita cinco downloads e preserva pedidos simultâneos",async()=>{
  const before=stored.get("apple-music.artworkDiagnostic"),decoder=globalThis.createImageBitmap;
  try {
    stored.delete("apple-music.artworkDiagnostic");globalThis.createImageBitmap=async()=>({width:100,height:100,close(){}});
    const replies=await Promise.all(Array.from({length:8},(_,i)=>send({type:"metadata:artwork",sourceUrl:libraryUrl,album:{service:"apple-music",id:String(401652079+i),artworkUrl:"https://is1-ssl.mzstatic.com/image/thumb/cover/100x100bb.jpg"}},extension)));
    assert.ok(replies.every(reply=>reply.ok));
    const log=stored.get("apple-music.artworkDiagnostic");assert.equal(log.attempts.length,5);assert.equal(new Set(log.attempts.map(attempt=>attempt.albumId)).size,5);
    assert.ok(log.attempts.every(attempt=>attempt.outcome.status==="ready"));assert.doesNotMatch(JSON.stringify(log),/dataBase64/);
  }finally{stored.set("apple-music.artworkDiagnostic",before);globalThis.createImageBitmap=decoder;}
});


test("Deezer integra preferência, abertura, seleção, lembrança e diagnóstico sem Spotify", async () => {
 const pref=structuredClone(stored.get("library.preferences")), session=stored.get("spotify.session");
 try {
  assert.equal((await send({type:"preferences:set-service",service:"deezer"},extension)).ok,true);
  stored.set("library.preferences",{version:1,service:"deezer",choices:[]}); stored.delete("spotify.session");
  deezerMode="exact";
  assert.equal((await send(request({title:"Siderado",artist:"Skank",upc:"invalid-ignored"}))).data.opened,true);
  assert.equal(opened.at(-1),deezerFixture.data[0].link);
  assert.equal((await send(request({title:"Siderado",artist:"Skank",target:"app"}))).error.code,"invalid-query");
  const q={type:"spotify:search",title:"Siderado",artist:"Skank",sourceUrl:libraryUrl};
  deezerMode="partial";const partial=(await send(q,extension)).data;
  assert.equal(partial.autoOpen,false);assert.ok(partial.resolution.nextPage);
  deezerMode="ambiguous";const data=(await send(q,extension)).data;
  assert.equal(data.resolution.status,"choose");
  const select={type:"spotify:select",selectionId:data.selectionId,albumId:"1215479",artistId:"13545",rememberAlbum:true,target:"web"};
  assert.equal((await send(select,extension)).ok,true);
  const calls=deezerCalls;assert.equal((await send(q,extension)).data.resolution.reason,"remembered-album");assert.equal(deezerCalls,calls);
  assert.equal(stored.get("library.preferences").choices[0].service,"deezer");
  stored.set("library.preferences",{version:1,service:"deezer",choices:[]});deezerMode="error";
  assert.equal((await send(q,extension)).data.resolution.code,"rate-limited");
  const diagnostic=(await send({type:"spotify:diagnostics"},extension)).data;
  assert.equal(diagnostic.service,"deezer");assert.equal(diagnostic.batches[0].events.find(e=>e.kind==="api-error").code,4);
  assert.doesNotMatch(JSON.stringify(diagnostic),/private-secret/);
  assert.equal((await send({...q,purpose:"metadata"},extension)).data.resolution.code,"rate-limited");
  await send({type:"preferences:set-service",service:"spotify"},extension);
  assert.equal((await send(select,extension)).error.code,"invalid-query");
 } finally {stored.set("library.preferences",pref);stored.set("spotify.session",session);}
});

test("composição Deezer ignora preferências de reprodução e obtém capa sem sessão Spotify", async()=>{
 const pref=structuredClone(stored.get("library.preferences")),session=stored.get("spotify.session"),decoder=globalThis.createImageBitmap;
 try {
  stored.delete("spotify.session");stored.set("library.preferences",{version:1,service:"youtube-music",choices:[]});deezerMode="exact";
  const before=opened.length,preferences=structuredClone(stored.get("library.preferences"));
  const reply=await send({type:"metadata:search",service:"deezer",title:"Siderado",artist:"Skank",sourceUrl:libraryUrl},extension);
  assert.equal(reply.ok,true);assert.equal(reply.data.resolution.album.service,"deezer");assert.equal(reply.data.selectionId,undefined);
  globalThis.createImageBitmap=async()=>({width:1000,height:1000,close(){}});
  const image=await send({type:"metadata:artwork",album:reply.data.resolution.album,sourceUrl:libraryUrl},extension);
  assert.equal(image.ok,true);assert.equal(image.data.service,"deezer");assert.equal(image.data.width,1000);
  assert.deepEqual(stored.get("library.preferences"),preferences);assert.equal(opened.length,before);
  deezerMode="partial";
  const query={type:"metadata:search",service:"deezer",title:"Siderado",artist:"Skank",sourceUrl:libraryUrl};
  const page=(await send(query,extension)).data.resolution.nextPage;assert.ok(page);
  assert.equal((await send({...query,title:"Outro",nextPage:page},extension)).error.code,"invalid-query");
 } finally {stored.set("library.preferences",pref);stored.set("spotify.session",session);globalThis.createImageBitmap=decoder;deezerMode="exact";}
});


test("iTunes compartilha complemento por artista entre reprodução e edição sem alterar sua preferência", async () => {
  const pref=structuredClone(stored.get("library.preferences")),session=stored.get("spotify.session"),previousMode=itunesMode;
  try {
    stored.set("library.preferences",{version:1,service:"apple-music",choices:[]});stored.delete("spotify.session");itunesMode="artist-supplement";
    const reply=await send(request({title:"Dangerous",artist:"Michael Jackson"}));
    assert.equal(reply.ok,true);assert.equal(reply.data.opened,false);
    const pending=(await send({type:"spotify:pending",id:reply.data.resultId},extension)).data;
    assert.equal(pending.resolution.candidates[0].id,"322847038");
    assert.equal(pending.resolution.candidates.filter(album=>album.id===itunesArtistFixture.initial.results[0].collectionId.toString()).length,1);
    const select={type:"spotify:select",selectionId:pending.selectionId,albumId:"322847038",artistId:"32940",rememberAlbum:false,target:"web"};
    assert.equal((await send(select,extension)).ok,true);assert.equal(opened.at(-1),itunesArtistFixture.lookup.results[2].collectionViewUrl);
    await send({type:"preferences:set-service",service:"youtube-music"},extension);
    const before=structuredClone(stored.get("library.preferences")),tabs=opened.length;
    const metadata=(await send({type:"metadata:search",service:"apple-music",title:"Dangerous",artist:"Michael Jackson",sourceUrl:libraryUrl},extension)).data;
    assert.equal(metadata.resolution.candidates[0].id,"322847038");assert.equal(metadata.selectionId,undefined);assert.equal(opened.length,tabs);assert.deepEqual(stored.get("library.preferences"),before);
    const diagnostic=stored.get("apple-music.searchDiagnostic");
    assert.ok(diagnostic.batches[0].events.some(event=>event.kind==="cache"&&event.stage==="artist-albums"));
    assert.ok(diagnostic.batches[0].events.some(event=>event.kind==="supplement"&&event.added===1));
  } finally {stored.set("library.preferences",pref);stored.set("spotify.session",session);itunesMode=previousMode;}
});


test("descrição usa canal restrito, preserva preferências e exporta diagnóstico sem texto privado",async()=>{
 const pref=structuredClone(stored.get("library.preferences")),tabs=opened.length;
 const album={service:"deezer",id:"1215478",title:"Siderado",artists:[{id:"13545",name:"Skank"}],url:"https://www.deezer.com/album/1215478"};
 const message={type:"metadata:description",album,sourceUrl:libraryUrl};
 assert.equal(await send(message),undefined);
 assert.equal((await send({...message,sourceUrl:"https://evil.example"},extension)).error.code,"invalid-query");
 const result=await send(message,extension);assert.equal(result.ok,true);assert.match(result.data.text,/Gravadora: Columbia/);assert.equal(result.data.listedTracks,11);
 assert.deepEqual(stored.get("library.preferences"),pref);assert.equal(opened.length,tabs);
 const storedLog=stored.get("deezer.descriptionDiagnostic");assert.equal(storedLog.attempts.at(-1).outcome.status,"ready");assert.doesNotMatch(JSON.stringify(storedLog),/Marginal Tieté|Gravadora: Columbia/);
 const exported=(await send({type:"spotify:diagnostics"},extension)).data;assert.ok(exported.descriptionByService.deezer);
});

test('configuração Spotify aceita somente página da extensão e invalida sessão ao trocar app',async()=>{
 const before=structuredClone(stored.get('spotify.session'));
 assert.equal(await send({type:'spotify:configure',clientId:'b'.repeat(32)}),undefined);
 const invalid=await send({type:'spotify:configure',clientId:'inválido'},extension);assert.equal(invalid.ok,false);assert.deepEqual(stored.get('spotify.session'),before);
 try {
  assert.equal((await send({type:'spotify:configure',clientId:'b'.repeat(32)},extension)).ok,true);
  const info=(await send({type:'setup:get'},extension)).data;assert.equal(info.spotify.clientId,'b'.repeat(32));assert.equal(info.spotify.connected,false);
  assert.equal(stored.get('spotify.session'),undefined);assert.equal(stored.get('spotify.clientId'),'b'.repeat(32));
 } finally {await send({type:'spotify:configure',clientId:'a'.repeat(32)},extension);stored.set('spotify.session',before);}
});
