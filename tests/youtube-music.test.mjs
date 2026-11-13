import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {YouTubeMusicClient, parseYouTubeAlbums, isYouTubeAlbumUrl, isYouTubeArtwork} from "../dist/youtube-music.js";
import {searchAlbums} from "../dist/resolution.js";
import {albumSearchTitle} from "../dist/album-search-title.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/youtube-music-search.json", import.meta.url), "utf8"));
const query = {title: "Discovery", artist: "Daft Punk", source: {catalogId: "libib", itemUrl: "https://www.libib.com/library"}};
test("limpeza comum remove rótulos conhecidos preservando edição e nomes legítimos", () => {
  const cases = [
    ["The Smiths -...Best Ii [CD]", "The Smiths", "best ii"],
    ["Eminem Show Stickered explicit_lyrics", "Eminem", "eminem show"],
    ["Eminem Show explicit_lyrics [CD] Stickered", "Eminem", "eminem show"],
    ["The Smiths - Best II (2011 Remaster) [Deluxe]", "The Smiths", "best ii 2011 remaster deluxe"],
    ["Awake: The Best Of Live [CD/DVD Combo]", "Live", "awake the best of live"],
    ["Blood On The Dance Floor: History In The Mix", "Jackson, Michael", "Blood On The Dance Floor: History In The Mix"],
    ["Stickered", "Example", "Stickered"],
  ];
  for (const [title, artist, expected] of cases) assert.equal(albumSearchTitle({...query, title, artist}), expected);
});
test("busca manual permanece literal e campos originais não são alterados", () => {
  const original = {...query, title: "The Smiths -...Best Ii [CD]", artist: "The Smiths"};
  const before = structuredClone(original);
  assert.equal(albumSearchTitle(original), "best ii");
  assert.deepEqual(original, before);
  assert.equal(albumSearchTitle({...original, source: {...original.source, catalogId: "preview"}}), original.title);
});
test("YouTube Music envia título limpo e registra a mesma consulta no diagnóstico", async () => {
  const sent = [];
  const events = [];
  const client = new YouTubeMusicClient(async (_url, init) => {sent.push(JSON.parse(init.body).query);return Response.json(fixture);});
  await client.search({...query, title: "The Smiths -...Best Ii [CD]", artist: "The Smiths"}, undefined, undefined, event => events.push(event));
  await client.search({...query, title: "Eminem Show Stickered explicit_lyrics", artist: "Eminem"});
  assert.deepEqual(sent, ["best ii The Smiths", "eminem show Eminem"]);
  assert.equal(events.find(event => event.kind === "request").query, sent[0]);
});
test("amostra pública retorna álbuns com artista, capa, ano e link direto", () => {
  const albums = parseYouTubeAlbums(fixture);
  assert.equal(albums.length, 3);
  assert.equal(albums[0].title, "Discovery");
  assert.equal(albums[0].artists[0].name, "Daft Punk");
  assert.equal(albums[0].releaseDate, "2001");
  assert.equal(albums[0].service, "youtube-music");
  assert.equal(isYouTubeAlbumUrl(albums[0].url, albums[0].id), true);
  assert.equal(isYouTubeArtwork(albums[0].artworkUrl), true);
  assert.equal(albums[0].upc, undefined);
});
test("não classifica playlist, vídeo ou resultado sem artista identificável como álbum", () => {
  for (const type of ["MUSIC_PAGE_TYPE_PLAYLIST", "MUSIC_PAGE_TYPE_ARTIST", undefined]) {
    const value = structuredClone(fixture);
    const items = value.contents.sectionListRenderer.contents[0].musicShelfRenderer.contents;
    items.splice(1);
    items[0].musicResponsiveListItemRenderer.navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType = type;
    assert.deepEqual(parseYouTubeAlbums(value), []);
  }
});
test("rejeita formato desconhecido e não o trata como catálogo vazio", () => {
  for (const value of [null, {}, {error: {code: 403}}, "HTML"]) assert.throws(() => parseYouTubeAlbums(value), {code: "invalid-response"});
  assert.deepEqual(parseYouTubeAlbums({contents: {sectionListRenderer: {contents: []}}}), []);
});
test("links e capas rejeitam destinos externos e credenciais", () => {
  const id = "MPREb_7ltM34kr0mH";
  for (const url of [`https://evil.example/browse/${id}`, `https://music.youtube.com@evil.example/browse/${id}`, `https://music.youtube.com/browse/${id}?next=evil`, `https://music.youtube.com/playlist?list=${id}`]) assert.equal(isYouTubeAlbumUrl(url, id), false);
  assert.equal(isYouTubeArtwork("https://evil.example/cover.jpg"), false);
  assert.equal(isYouTubeArtwork("https://user:pass@lh3.googleusercontent.com/image"), false);
});
test("consulta omite credenciais e mantém os códigos fora do texto da busca", async () => {
  let calls = 0;
  const client = new YouTubeMusicClient(async (url, init) => {
    calls++;
    assert.equal(new URL(url).origin, "https://music.youtube.com");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    const body = JSON.parse(init.body);
    assert.equal(body.query, "Discovery Daft Punk");
    assert.equal(body.context.client.clientName, "WEB_REMIX");
    assert.equal(init.headers.Authorization, undefined);
    const value = structuredClone(fixture);
    value.contents.sectionListRenderer.contents[0].musicShelfRenderer.contents.splice(1);
    return Response.json(value);
  });
  const result = await searchAlbums(client, {...query, upc: "745099040628"});
  assert.equal(result.status, "resolved");
  assert.equal(result.album.title, "Discovery");
  assert.equal(calls, 1);
});
test("paginação parcial mantém escolha e continuação no endpoint fixo", async () => {
  const value = structuredClone(fixture);
  value.contents.sectionListRenderer.contents[0].musicShelfRenderer.continuations = [{nextContinuationData: {continuation: "opaque-token"}}];
  const result = await searchAlbums(new YouTubeMusicClient(async () => Response.json(value)), query);
  assert.equal(result.status, "choose");
  assert.equal(result.incomplete, true);
  assert.equal(result.nextPage, "opaque-token");
  await new YouTubeMusicClient(async url => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://music.youtube.com");
    assert.equal(parsed.pathname, "/youtubei/v1/search");
    assert.equal(parsed.searchParams.get("continuation"), "opaque-token");
    assert.equal(parsed.searchParams.get("ctoken"), "opaque-token");
    return Response.json(fixture);
  }).search(query, undefined, "opaque-token");
});
test("distingue limite, indisponibilidade, rede, cancelamento e JSON inválido", async () => {
  for (const [status, code] of [[429, "rate-limited"], [403, "unavailable"], [500, "unavailable"]]) {
    await assert.rejects(new YouTubeMusicClient(async () => new Response(null, {status})).search(query), {code});
  }
  await assert.rejects(new YouTubeMusicClient(async () => {throw Error("offline");}).search(query), {code: "network"});
  const abort = new AbortController(); abort.abort();
  await assert.rejects(new YouTubeMusicClient(async () => {throw Error("abort");}).search(query, abort.signal), {code: "cancelled"});
  await assert.rejects(new YouTubeMusicClient(async () => new Response("html")).search(query), {code: "invalid-response"});
});

test("diagnóstico inclui status HTTP e erro JSON sem corpo bruto ou credenciais", async () => {
  const events = [];
  const client = new YouTubeMusicClient(async () => Response.json({error: {
    code: 403, status: "PERMISSION_DENIED", message: "Request blocked; api_key=private-key Bearer private-access",
    details: [{token: "private-details"}],
  }}, {status: 403, headers: {"set-cookie": "private-cookie"}}));
  await assert.rejects(client.search(query, undefined, undefined, event => events.push(event)), {code: "unavailable"});
  const response = events.find(event => event.kind === "response");
  assert.equal(response.status, 403);
  assert.equal(response.contentType, "application/json");
  assert.equal(response.error.status, "PERMISSION_DENIED");
  assert.equal(response.error.code, 403);
  assert.ok(response.error.message.startsWith("Request blocked"));
  for (const secret of ["private-key", "private-access", "private-details", "private-cookie"]) assert.equal(JSON.stringify(events).includes(secret), false);
});

test("erro HTML registra HTTP e formato sem exportar o conteúdo da página", async () => {
  const events = [];
  const client = new YouTubeMusicClient(async () => new Response("<html>private-response-body</html>", {status: 503, headers: {"Content-Type": "text/html; charset=utf-8"}}));
  await assert.rejects(client.search(query, undefined, undefined, event => events.push(event)), {code: "unavailable"});
  assert.deepEqual(events.find(event => event.kind === "response"), {kind: "response", status: 503, contentType: "text/html", bodyFormat: "non-json"});
  assert.equal(JSON.stringify(events).includes("private-response-body"), false);
});

test("diagnóstico diferencia falha sem HTTP e registra consulta sem token de continuação", async () => {
  const events = [];
  const client = new YouTubeMusicClient(async () => {throw new TypeError("Network failed with private-secret");});
  await assert.rejects(client.search(query, undefined, "opaque-private-cursor", event => events.push(event)), {code: "network"});
  assert.equal(events[0].query, "Discovery Daft Punk");
  assert.equal(events[0].continued, true);
  assert.equal(events[1].kind, "failure");
  assert.equal(events[1].code, "network");
  assert.equal(events.some(event => event.kind === "response"), false);
  for (const secret of ["opaque-private-cursor", "private-secret"]) assert.equal(JSON.stringify(events).includes(secret), false);
});

test("continuação preserva escapes do provedor sem codificar duas vezes", async () => {
  const client = new YouTubeMusicClient(async url => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("ctoken"), "opaque-token==");
    assert.equal(parsed.searchParams.get("continuation"), "opaque-token==");
    assert.equal(parsed.href.includes("%253D"), false);
    return Response.json(fixture);
  });
  await client.search(query, undefined, "opaque-token%3D%3D");
  await assert.rejects(client.search(query, undefined, "invalid%"), {code: "invalid-query"});
});

test("um candidato do artista na primeira página permanece para escolha enquanto há continuação", async () => {
  const value = structuredClone(fixture);
  const shelf = value.contents.sectionListRenderer.contents[0].musicShelfRenderer;
  for (const item of shelf.contents.slice(1)) {
    const runs = item.musicResponsiveListItemRenderer.flexColumns[1].musicResponsiveListItemFlexColumnRenderer.text.runs;
    runs[2].text = "Another artist";
    runs[2].navigationEndpoint.browseEndpoint.browseId = "UCAnotherArtist";
  }
  shelf.continuations = [{nextContinuationData: {continuation: "another-page"}}];
  const result = await searchAlbums(new YouTubeMusicClient(async () => Response.json(value)), query);
  assert.equal(result.status, "choose");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].title, "Discovery");
  assert.equal(result.incomplete, true);
  assert.equal(result.nextPage, "another-page");
});
