import test from "node:test";
import assert from "node:assert/strict";
import {MetadataSearchSession, bindMetadataPage, readMetadataPage, metadataProductCode} from "../src/streamings/metadata-search.ts";

const query = {title: "Discovery", artist: "Daft Punk", sourceUrl: "https://www.libib.com/library"};
const configurationUrl = "chrome-extension://controlled/setup.html";
const services = connected => ({configurationUrl, services: [
  {id: "spotify", name: "Spotify", requiresAuthentication: true, connected},
  {id: "youtube-music", name: "YouTube Music", requiresAuthentication: false, connected: true},
  {id: "apple-music", name: "iTunes", requiresAuthentication: false, connected: true},
]});
const album = (service, id = "album") => ({service, id, title: "Discovery", artists: [{id: "artist", name: "Daft Punk"}], url: "https://example.com/album/" + id});
const reply = (service, ids = ["album"], nextPage) => ({service, configurationUrl, connectionRequired: false, searchUrl: "https://example.com/search",
  resolution: {status: "choose", candidates: ids.map(id => album(service, id)), rememberAlbumByDefault: false, ...(nextPage ? {nextPage} : {})}});
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));
test("limpar resultados remove a continuação, descarta resposta tardia e preserva outras fontes sem consultar", async () => {
  let pending, calls = 0;
  const session = new MetadataSearchSession("spotify", {services: async () => services(true), search: async service => {
    calls++;return pending ? pending.promise : reply(service, [service], "next");
  }});
  await session.search(query);session.selectService("youtube-music");await session.search(query);
  session.selectService("spotify");pending = deferred();const late = session.search(query);await tick();
  const before = calls;session.clearResults();assert.deepEqual(session.snapshot(), {albums: []});assert.equal(calls, before);
  assert.equal(session.snapshot("youtube-music").nextPage, "next");
  pending.resolve(reply("spotify", ["stale"], "stale-page"));assert.equal(await late, undefined);
  assert.deepEqual(session.snapshot(), {albums: []});
});
test('EAN/UPC seguem para Spotify, Discogs e UPCitemdb e são retirados ao trocar para fonte sem busca por código',()=>{
 for(const service of ['spotify','discogs','upcitemdb']){
  assert.deepEqual(metadataProductCode(service,' 7898285415687 '),{ean:'7898285415687'});
  assert.deepEqual(metadataProductCode(service,'0 36000-291452'),{upc:'0 36000-291452'});
  assert.deepEqual(metadataProductCode(service,''),{});
 }
 for(const service of ['apple-music','deezer','lastfm','youtube-music','tmdb']) assert.deepEqual(metadataProductCode(service,'7898285415687'),{});
});

test("continuação preserva serviço/consulta, suporta reinício do worker e rejeita trocas", () => {
  const token = bindMetadataPage("youtube-music", query, "opaque-token==");
  assert.equal(readMetadataPage("youtube-music", {...query}, token), "opaque-token==");
  assert.equal(readMetadataPage("youtube-music", query, undefined), undefined);
  for (const [service, value, cursor] of [
    ["spotify", query, token], ["youtube-music", {...query, title: "Other"}, token],
    ["youtube-music", {...query, artist: "Other"}, token], ["youtube-music", {...query, upc: "036000291452"}, token],
    ["youtube-music", {...query, sourceUrl: query.sourceUrl + "/other"}, token],
    ["youtube-music", query, "raw-token"], ["youtube-music", query, null],
    ["youtube-music", query, "x".repeat(32769)],
    ["youtube-music", query, JSON.stringify([1, "youtube-music", JSON.parse(token)[2], ""])],
    ["youtube-music", query, JSON.stringify([1, "youtube-music", JSON.parse(token)[2], "x".repeat(8193)])],
  ]) assert.throws(() => readMetadataPage(service, value, cursor), error => error.code === "invalid-query");
});

test("busca e paginação ficam separadas por serviço e deduplicam álbuns", async () => {
  const calls = [];
  const session = new MetadataSearchSession("spotify", {services: async () => services(true), search: async (service, input, page) => {
    calls.push({service, input, page}); return page ? reply(service, ["same", "second"]) : reply(service, ["same"], service + "-next");
  }});
  await session.search(query); await session.search(query, true);
  assert.deepEqual(session.snapshot().albums.map(item => item.id), ["same", "second"]);
  session.selectService("youtube-music"); assert.equal(session.snapshot().albums.length, 0);
  await session.search(query);
  session.selectService("spotify"); assert.equal(session.snapshot().albums.length, 2);
  assert.equal(calls[1].page, "spotify-next"); assert.equal(calls[2].page, undefined);
  const snapshot = session.snapshot(); snapshot.albums[0].title = "External mutation";
  assert.equal(session.snapshot().albums[0].title, "Discovery");
});

test("troca de serviço descarta resposta antiga sem perder resultados de outro serviço", async () => {
  const first = deferred(), second = deferred();
  const session = new MetadataSearchSession("spotify", {services: async () => services(true), search: service => service === "spotify" ? first.promise : second.promise});
  const a = session.search(query); await tick(); session.selectService("youtube-music");
  const b = session.search(query); await tick(); second.resolve(reply("youtube-music", ["new"])); await b;
  first.resolve(reply("spotify", ["old"])); assert.equal(await a, undefined);
  assert.equal(session.snapshot("spotify").albums.length, 0);
  assert.equal(session.snapshot().albums[0].id, "new");
});

test("nova consulta e invalidação descartam respostas e erros antigos", async () => {
  const requests = [];
  const session = new MetadataSearchSession("spotify", {services: async () => services(true), search: () => {const request = deferred(); requests.push(request); return request.promise;}});
  const first = session.search(query); await tick(); const second = session.search({...query, title: "New"}); await tick();
  requests[1].resolve(reply("spotify", ["new"])); await second;
  requests[0].reject(Error("old-error")); assert.equal(await first, undefined);
  assert.equal(session.snapshot().query.title, "New");
  const third = session.search(query); await tick(); session.invalidate(); requests[2].resolve(reply("spotify", ["old"]));
  assert.equal(await third, undefined); assert.equal(session.snapshot().query.title, "New");
});

test("desconexão e reconexão preservam resultados e continuação sem disparar busca automática", async () => {
  let connected = true, calls = 0;
  const session = new MetadataSearchSession("spotify", {services: async () => services(connected), search: async service => {calls++; return reply(service, ["saved"], "next");}});
  await session.search(query); const before = session.snapshot(); connected = false;
  const offline = await session.search({...query, title: "Other"});
  assert.equal(offline.connectionRequired, true); assert.equal(offline.configurationUrl, configurationUrl);
  assert.deepEqual(session.snapshot(), before); assert.equal(calls, 1);
  connected = true; await session.refreshServices(); assert.equal(calls, 1); assert.deepEqual(session.snapshot(), before);
  await session.search(query, true); assert.equal(calls, 2);
});

test("YouTube Music funciona com Spotify desconectado e nova consulta inicia outra paginação", async () => {
  const calls = [];
  const session = new MetadataSearchSession("youtube-music", {services: async () => services(false), search: async (service, input, page) => {calls.push(page); return reply(service, [input.title], "next");}});
  await session.search(query); await session.search({...query, title: "Other"});
  assert.deepEqual(calls, [undefined, undefined]); assert.equal(session.snapshot().albums.length, 1);
  assert.equal(session.snapshot().query.title, "Other");
  await assert.rejects(session.search(query, true), error => error.code === "invalid-query");
});

test("falha de rede ou autenticação durante página mantém álbuns e cursor para tentar novamente", async () => {
  let mode = "success";
  const session = new MetadataSearchSession("spotify", {services: async () => services(true), search: async service => {
    if (mode === "network") throw Error("network");
    if (mode === "auth") return {...reply(service), connectionRequired: true, resolution: {status: "failed", code: "authentication-required", message: "Reconnect"}};
    return reply(service, ["saved"], "next");
  }});
  await session.search(query); const before = session.snapshot();
  mode = "network"; await assert.rejects(session.search(query, true), /network/); assert.deepEqual(session.snapshot(), before);
  mode = "auth"; assert.equal((await session.search(query, true)).connectionRequired, true); assert.deepEqual(session.snapshot(), before);
});

test("resposta de outro streaming ou candidato inválido é recusado sem alterar estado", async () => {
  let result = reply("youtube-music");
  const session = new MetadataSearchSession("spotify", {services: async () => services(true), search: async () => result});
  await assert.rejects(session.search(query), error => error.code === "invalid-response");
  result = reply("spotify"); result.resolution.candidates[0].service = "youtube-music";
  await assert.rejects(session.search(query), error => error.code === "invalid-response");
  assert.equal(session.snapshot().albums.length, 0);
  assert.throws(() => session.selectService("amazon-music"), TypeError);
  assert.equal(session.service, "spotify");
});

test("atualização de conexão atrasada não substitui o estado mais novo", async () => {
  const one = deferred(), two = deferred(); let calls = 0;
  const session = new MetadataSearchSession("spotify", {services: () => ++calls === 1 ? one.promise : two.promise, search: async service => reply(service)});
  const a = session.refreshServices(), b = session.refreshServices();
  two.resolve(services(true)); await b; one.resolve(services(false));
  assert.equal((await a).services[0].connected, true);
});

test("troca durante verificação de conexão descarta busca e entrada é copiada antes do envio", async () => {
  const pending = deferred(); let calls = 0;
  const session = new MetadataSearchSession("spotify", {services: () => pending.promise, search: async service => {calls++; return reply(service);}});
  const input = {...query}; const result = session.search(input); input.title = "Modified";
  session.selectService("youtube-music"); pending.resolve(services(true));
  assert.equal(await result, undefined); assert.equal(calls, 0); assert.equal(session.snapshot("spotify").albums.length, 0);
});


test("sessão iTunes pesquisa sem autenticação e isola resultados das outras fontes", async () => {
  const calls = [];
  const session = new MetadataSearchSession("apple-music", {services: async () => services(false), search: async (service, input, next) => {
    calls.push({service, input, next}); return reply(service, ["itunes-album"]);
  }});
  await session.search(query);
  assert.equal(calls[0].service, "apple-music"); assert.equal(calls[0].next, undefined);
  assert.equal(session.snapshot().albums[0].service, "apple-music");
  session.selectService("youtube-music"); assert.equal(session.snapshot().albums.length, 0);
  session.selectService("apple-music"); assert.equal(session.snapshot().albums.length, 1);
  await assert.rejects(session.search(query, true), {code: "invalid-query"});
});
