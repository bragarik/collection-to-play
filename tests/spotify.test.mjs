import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPkce, SpotifyClient, spotifySearchUrl } from "../dist/spotify.js";
import { searchAlbums } from "../dist/resolution.js";

const redirect = "https://ajjfighekaafaklemaophkbfckidiphl.chromiumapp.org/spotify";
const query = { title: "Discovery", artist: "Daft Punk", source: { catalogId: "libib", itemUrl: "https://www.libib.com/library" } };
const albumId = "A".repeat(22);
const artistId = "B".repeat(22);
const payload = (id = albumId, title = "Discovery") => ({
  id, name: title, artists: [{ id: artistId, name: "Daft Punk" }],
  external_urls: { spotify: `https://open.spotify.com/album/${id}` }, release_date: "2001-03-12",
});
const token = (values = {}) => ({ access_token: "test-access", refresh_token: "test-refresh", token_type: "Bearer", expires_in: 3600, ...values });
const page = (items = [payload()], next = null) => Response.json({ albums: { items, next } });

function setup(options = {}) {
  let stored = options.session;
  let time = 1_000_000;
  const calls = [];
  const authUrls = [];
  const client = new SpotifyClient({
    clientId: "test-client-id", redirectUrl: redirect, now: () => time,
    launchAuth: async (url) => {
      authUrls.push(new URL(url));
      if (options.launch) return options.launch(new URL(url));
      return `${redirect}?state=${new URL(url).searchParams.get("state")}&code=test-code`;
    },
    store: {
      load: async () => structuredClone(stored),
      save: async (value) => { stored = structuredClone(value); },
      clear: async () => { stored = undefined; },
    },
    fetch: async (url, init) => {
      calls.push({ url: new URL(url), init });
      if (options.fetch) return options.fetch(new URL(url), init, calls.length);
      return url.includes("/api/token") ? Response.json(token()) : page();
    },
  });
  return { client, calls, authUrls, stored: () => stored, advance: (milliseconds) => { time += milliseconds; } };
}

const connected = (expiresAt = 10_000_000) => ({ accessToken: "existing-access", refreshToken: "existing-refresh", expiresAt });

test("PKCE usa SHA-256, entropia independente e verifier válido", async () => {
  const first = await createPkce();
  const second = await createPkce();
  assert.match(first.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(first.challenge, createHash("sha256").update(first.verifier).digest("base64url"));
  assert.notEqual(first.state, second.state);
  assert.notEqual(first.verifier, second.verifier);
});

test("conexão oficial usa PKCE sem client secret nem permissões de biblioteca/reprodução", async () => {
  const value = setup();
  assert.equal((await value.client.status()).connected, false);
  await value.client.connect();
  assert.equal((await value.client.status()).connected, true);
  const authorization = value.authUrls[0];
  assert.equal(authorization.origin, "https://accounts.spotify.com");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.equal(authorization.searchParams.get("redirect_uri"), redirect);
  assert.equal(authorization.searchParams.has("scope"), false);
  const fields = value.calls[0].init.body;
  assert.equal(fields.get("client_secret"), null);
  assert.equal(fields.get("client_id"), "test-client-id");
  assert.equal(fields.get("grant_type"), "authorization_code");
  assert.equal(createHash("sha256").update(fields.get("code_verifier")).digest("base64url"), authorization.searchParams.get("code_challenge"));
  assert.deepEqual(await value.client.status(), { connected: true });
});

test("state incorreto, retorno estrangeiro, fragmento ou código ausente não trocam tokens", async () => {
  const variants = [
    () => `${redirect}?state=wrong&code=test-code`,
    (url) => `https://other.example/spotify?state=${url.searchParams.get("state")}&code=test-code`,
    (url) => `${redirect}?state=${url.searchParams.get("state")}&code=test-code#fragment`,
    (url) => `${redirect}?state=${url.searchParams.get("state")}`,
  ];
  for (const launch of variants) {
    const value = setup({ launch });
    await assert.rejects(value.client.connect(), { code: "authentication-required" });
    assert.equal(value.calls.length, 0);
    assert.equal(value.stored(), undefined);
  }
});

test("recusa, fechamento e falha na janela não criam sessão", async () => {
  for (const launch of [
    () => undefined,
    () => { throw new Error("window closed"); },
    (url) => `${redirect}?state=${url.searchParams.get("state")}&error=access_denied`,
  ]) {
    const value = setup({ launch });
    await assert.rejects(value.client.connect(), { code: "cancelled" });
    assert.equal(value.calls.length, 0);
    assert.equal((await value.client.status()).connected, false);
  }
});

test("cliques simultâneos compartilham uma única autorização", async () => {
  const value = setup();
  await Promise.all([value.client.connect(), value.client.connect()]);
  assert.equal(value.authUrls.length, 1);
  assert.equal(value.calls.length, 1);
});

test("desconectar durante autorização impede que o retorno tardio salve sessão", async () => {
  let complete;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const value = setup({ launch: (url) => new Promise((resolve) => { complete = () => resolve(`${redirect}?state=${url.searchParams.get("state")}&code=late`); started(); }) });
  const connection = value.client.connect();
  await ready;
  await value.client.disconnect();
  complete();
  await assert.rejects(connection, { code: "cancelled" });
  assert.equal(value.stored(), undefined);
});

test("consulta sem sessão exige conexão, sem abrir login automaticamente", async () => {
  const value = setup();
  await assert.rejects(value.client.search(query), { code: "authentication-required" });
  assert.equal(value.authUrls.length, 0);
  assert.equal(value.calls.length, 0);
});

test("busca envia Bearer, filtros de álbum/artista e limite atual de dez", async () => {
  const value = setup({ session: connected() });
  const result = await value.client.search(query);
  assert.equal(value.calls[0].url.origin, "https://api.spotify.com");
  assert.equal(value.calls[0].url.searchParams.get("type"), "album");
  assert.equal(value.calls[0].url.searchParams.get("limit"), "10");
  assert.equal(value.calls[0].url.searchParams.get("q"), 'album:"Discovery" artist:"Daft Punk"');
  assert.equal(value.calls[0].init.headers.Authorization, "Bearer existing-access");
  assert.equal(result[0].id, albumId);
  assert.equal(result[0].url, `https://open.spotify.com/album/${albumId}`);
  assert.equal(result[0].artists[0].id, artistId);
});

test("sessão expirada renova sem exigir login e preserva refresh token omitido", async () => {
  const value = setup({ session: connected(1), fetch: (url) => url.pathname === "/api/token"
    ? Response.json({ access_token: "renewed", token_type: "Bearer", expires_in: 3600 }) : page() });
  await value.client.search(query);
  assert.equal(value.calls[0].init.body.get("grant_type"), "refresh_token");
  assert.equal(value.calls[0].init.body.get("refresh_token"), "existing-refresh");
  assert.equal(value.stored().refreshToken, "existing-refresh");
  assert.equal(value.calls[1].init.headers.Authorization, "Bearer renewed");
  assert.equal(value.authUrls.length, 0);
});

test("buscas simultâneas compartilham uma renovação de sessão", async () => {
  const value = setup({ session: connected(1) });
  await Promise.all([value.client.search(query), value.client.search(query)]);
  assert.equal(value.calls.filter(({ url }) => url.pathname === "/api/token").length, 1);
});

test("401 permite uma renovação e uma única repetição da consulta", async () => {
  let searches = 0;
  const value = setup({ session: connected(), fetch: (url) => {
    if (url.pathname === "/api/token") return Response.json(token());
    return ++searches === 1 ? Response.json({ error: "expired" }, { status: 401 }) : page();
  } });
  await value.client.search(query);
  assert.equal(searches, 2);
  assert.equal(value.calls.length, 3);
});

test("401 persistente ou refresh revogado removem a sessão e não entram em loop", async () => {
  const value = setup({ session: connected(), fetch: (url) => url.pathname === "/api/token"
    ? Response.json(token()) : Response.json({ error: "unauthorized" }, { status: 401 }) });
  await assert.rejects(value.client.search(query), { code: "authentication-required" });
  assert.equal(value.calls.length, 3);
  assert.equal(value.stored(), undefined);
  const revoked = setup({ session: connected(1), fetch: () => Response.json({ error: "invalid_grant" }, { status: 400 }) });
  await assert.rejects(revoked.client.search(query), { code: "authentication-required" });
  assert.equal(revoked.stored(), undefined);
});

test("429 respeita Retry-After e impede nova consulta durante a espera", async () => {
  let blocked = true;
  const value = setup({ session: connected(), fetch: () => blocked
    ? Response.json({}, { status: 429, headers: { "Retry-After": "15" } }) : page() });
  await assert.rejects(value.client.search(query), { code: "rate-limited", retryAfterSeconds: 15 });
  await assert.rejects(value.client.search(query), { code: "rate-limited" });
  assert.equal(value.calls.length, 1);
  value.advance(16000);
  blocked = false;
  assert.equal((await value.client.search(query)).length, 1);
});

test("403 informa restrição do aplicativo sem tratar como álbum ausente", async () => {
  const value = setup({ session: connected(), fetch: () => Response.json({}, { status: 403 }) });
  const result = await searchAlbums(value.client, query);
  assert.equal(result.status, "failed");
  assert.equal(result.code, "unavailable");
  assert.match(result.message, /usuários autorizados/);
});

test("paginação usa apenas o endpoint confiável e preserva edições de páginas seguintes", async () => {
  const anotherId = "C".repeat(22);
  const value = setup({ session: connected(), fetch: (url) => url.searchParams.get("offset") === "0"
    ? page([payload()], "https://malicious.example/do-not-follow")
    : page([payload(anotherId, "Discovery (Deluxe)")]) });
  const result = await searchAlbums(value.client, query);
  assert.equal(result.status, "choose");
  assert.equal(result.candidates.length, 2);
  assert.equal(value.calls[1].url.origin, "https://api.spotify.com");
  assert.equal(value.calls[1].url.searchParams.get("offset"), "10");
});

test("não abre automaticamente resultados quando a paginação foi truncada", async () => {
  const value = setup({ session: connected(), fetch: () => page([payload()], "more") });
  const result = await searchAlbums(value.client, query);
  assert.equal(result.status, "choose");
  assert.equal(result.incomplete, true);
  assert.equal(result.candidates.length, 1);
  assert.equal(typeof result.nextPage, "string");
  assert.equal(value.calls.length, 5);
  const next = await value.client.search(query, undefined, result.nextPage);
  assert.equal(value.calls[5].url.searchParams.get("offset"), "50");
  assert.equal(next.complete, false);
});

test("lista vazia oferece busca explícita no Spotify", async () => {
  const value = setup({ session: connected(), fetch: () => page([]) });
  const result = await searchAlbums(value.client, query);
  assert.equal(result.status, "not-found");
  assert.equal(result.offerSearch, true);
  assert.equal(spotifySearchUrl("Discovery", "Daft Punk"), "https://open.spotify.com/search/Discovery%20Daft%20Punk");
  assert.equal(value.calls.length, 2);
});

test("filtro vazio tenta termos livres e preserva Shaaman/Shaman para confirmação do usuário", async () => {
  const reason = { ...payload(albumId, "Reason"), artists: [{ id: artistId, name: "Shaman" }] };
  const value = setup({ session: connected(), fetch: (url) => url.searchParams.get("q").startsWith("album:")
    ? page([]) : page([reason]) });
  const result = await searchAlbums(value.client, { ...query, title: "Reason", artist: "Shaaman" });
  assert.equal(value.calls.length, 2);
  assert.equal(value.calls[0].url.searchParams.get("q"), 'album:"Reason" artist:"Shaaman"');
  assert.equal(value.calls[1].url.searchParams.get("q"), "Reason Shaaman");
  assert.equal(value.calls[1].url.searchParams.get("type"), "album");
  assert.equal(result.status, "choose");
  assert.equal(result.candidates[0].title, "Reason");
  assert.equal(result.candidates[0].artists[0].name, "Shaman");
  assert.equal(result.rememberAlbumByDefault, false);
});

test("busca livre é paginada para preservar edições ambíguas", async () => {
  const value = setup({ session: connected(), fetch: (url) => {
    if (url.searchParams.get("q").startsWith("album:")) return page([]);
    return url.searchParams.get("offset") === "0" ? page([payload()], "more") : page([payload("C".repeat(22), "Discovery (Deluxe)")]);
  } });
  const result = await searchAlbums(value.client, query);
  assert.equal(value.calls.length, 3);
  assert.equal(result.status, "choose");
  assert.equal(result.candidates.length, 2);
});

test("erro na busca livre não é escondido como ausência de álbum", async () => {
  const value = setup({ session: connected(), fetch: (url) => url.searchParams.get("q").startsWith("album:")
    ? page([]) : Response.json({}, { status: 403 }) });
  const result = await searchAlbums(value.client, query);
  assert.equal(value.calls.length, 2);
  assert.equal(result.status, "failed");
  assert.equal(result.code, "unavailable");
});

test("respostas sem campos, links de outros hosts e IDs divergentes são rejeitados", async () => {
  const wrong = payload();
  for (const body of [
    { albums: { items: [], next: 42 } },
    { albums: { items: [{ ...wrong, external_urls: { spotify: "https://malicious.example/album/x" } }], next: null } },
    { albums: { items: [{ ...wrong, external_urls: { spotify: `https://open.spotify.com/album/${"D".repeat(22)}` } }], next: null } },
    { albums: { items: [{ ...wrong, artists: [] }], next: null } },
  ]) {
    const value = setup({ session: connected(), fetch: () => Response.json(body) });
    await assert.rejects(value.client.search(query), { code: "invalid-response" });
  }
});

test("tokens inválidos não são gravados e mensagens não expõem a resposta sensível", async () => {
  const value = setup({ fetch: () => Response.json(token({ expires_in: -1, access_token: "sensitive-value" })) });
  await assert.rejects(value.client.connect(), (error) => error.code === "invalid-response" && !error.message.includes("sensitive-value"));
  assert.equal(value.stored(), undefined);
});

test("falhas de rede e JSON inválido viram erros controlados", async () => {
  const offline = setup({ session: connected(), fetch: () => { throw new TypeError("private internal details"); } });
  await assert.rejects(offline.client.search(query), (error) => error.code === "network" && !error.message.includes("private"));
  const invalid = setup({ session: connected(), fetch: () => new Response("not json") });
  await assert.rejects(invalid.client.search(query), { code: "invalid-response" });
});

test("cancelamento de consulta impede devolver álbum e desconectar limpa a sessão", async () => {
  const controller = new AbortController();
  const value = setup({ session: connected(), fetch: () => { controller.abort(); return page(); } });
  await assert.rejects(value.client.search(query, controller.signal), { code: "cancelled" });
  await value.client.disconnect();
  assert.equal((await value.client.status()).connected, false);
});

test("UPC vem antes do texto e é conferido nos detalhes completos do álbum", async () => {
  const reason = { ...payload(albumId, "Reason"), artists: [{ id: artistId, name: "Shaman" }] };
  const value = setup({ session: connected(), fetch: (url) => url.pathname === "/v1/search"
    ? page([reason]) : Response.json({ ...reason, external_ids: { upc: "0036000291452" } }) });
  const result = await searchAlbums(value.client, { ...query, title: "Reason", artist: "Shaaman", upc: "036000291452" });
  assert.equal(value.calls[0].url.searchParams.get("q"), "upc:036000291452");
  assert.equal(value.calls[1].url.pathname, `/v1/albums/${albumId}`);
  assert.equal(value.calls.length, 2);
  assert.equal(result.status, "resolved");
  assert.equal(result.reason, "identifier");
  assert.equal(result.album.artists[0].name, "Shaman");
});

test("tenta representação com zero à esquerda quando a UPC original não retorna resultado", async () => {
  const value = setup({ session: connected(), fetch: (url) => url.searchParams.get("q") === "upc:036000291452"
    ? page([]) : page([{ ...payload(), external_ids: { upc: "0036000291452" } }]) });
  const result = await searchAlbums(value.client, { ...query, upc: "036000291452" });
  assert.equal(value.calls[1].url.searchParams.get("q"), "upc:0036000291452");
  assert.equal(value.calls.length, 2);
  assert.equal(result.reason, "identifier");
});

test("UPC ausente no catálogo não impede a busca por título e artista", async () => {
  const value = setup({ session: connected(), fetch: (url) => url.searchParams.get("q").startsWith("upc:") ? page([]) : page() });
  const result = await searchAlbums(value.client, { ...query, upc: "036000291452" });
  assert.equal(value.calls.length, 3);
  assert.equal(value.calls[2].url.searchParams.get("q"), 'album:"Discovery" artist:"Daft Punk"');
  assert.equal(result.reason, "exact-match");
});

test("não confia apenas no filtro UPC quando o código retornado é diferente", async () => {
  const value = setup({ session: connected(), fetch: (url) => {
    if (url.pathname.startsWith("/v1/albums/")) return Response.json({ ...payload(), external_ids: { ean: "4006381333931" } });
    return page();
  } });
  const result = await searchAlbums(value.client, { ...query, upc: "036000291452" });
  assert.equal(value.calls.filter(({ url }) => url.pathname.startsWith("/v1/albums/")).length, 1);
  assert.equal(value.calls.at(-1).url.searchParams.get("q"), 'album:"Discovery" artist:"Daft Punk"');
  assert.equal(result.reason, "exact-match");
});

test("código inválido é ignorado pelo adaptador e não dispara filtro UPC", async () => {
  const value = setup({ session: connected() });
  await value.client.search({ ...query, upc: "036000291453" });
  assert.equal(value.calls.length, 1);
  assert.equal(value.calls[0].url.searchParams.get("q"), 'album:"Discovery" artist:"Daft Punk"');
});


test("continuação preserva a estratégia livre e exige confirmação também na última página", async () => {
  const value = setup({ session: connected(), fetch: (url) => {
    if (url.searchParams.get("q").includes("album:")) return page([]);
    return Number(url.searchParams.get("offset")) < 50 ? page([payload()], "more") : page([payload("C".repeat(22), "Discovery Deluxe")]);
  } });
  const first = await value.client.search(query);
  const adapter = { id: "spotify", search: (q, signal) => value.client.search(q, signal, first.nextPage) };
  const last = await searchAlbums(adapter, query);
  assert.equal(last.status, "choose");
  assert.equal(last.nextPage, undefined);
  assert.equal(last.candidates[0].title, "Discovery Deluxe");
  assert.equal(value.calls.at(-1).url.searchParams.get("q"), "Discovery Daft Punk");
  assert.equal(value.calls.at(-1).url.searchParams.get("offset"), "50");
});

test("continuação não aceita outra consulta, URL externa ou offset fora do limite", async () => {
  const value = setup({ session: connected(), fetch: () => page([payload()], "more") });
  const first = await value.client.search(query);
  await assert.rejects(value.client.search({ ...query, title: "Other" }, undefined, first.nextPage), { code: "invalid-query" });
  await assert.rejects(value.client.search(query, undefined, "https://malicious.example"), { code: "invalid-query" });
  const cursor = JSON.parse(first.nextPage); cursor[2] = 1010;
  await assert.rejects(value.client.search(query, undefined, JSON.stringify(cursor)), { code: "invalid-query" });
  assert.equal(value.calls.length, 5);
});

test("último offset permitido mantém a lista manual e não oferece continuação inválida", async () => {
  const value = setup({ session: connected(), fetch: () => page([payload()], "more") });
  const first = await value.client.search(query);
  const cursor = JSON.parse(first.nextPage); cursor[2] = 1000;
  const last = await value.client.search(query, undefined, JSON.stringify(cursor));
  assert.equal(last.complete, false);
  assert.equal(last.nextPage, undefined);
  assert.equal(value.calls.at(-1).url.searchParams.get("offset"), "1000");
});


test("diagnóstico registra consulta, estratégia, paginação e resultados sem cabeçalhos ou tokens", async () => {
  const events = [];
  const value = setup({ session: connected(), fetch: (url) => url.searchParams.get("q").includes("album:")
    ? page([]) : Response.json({ albums: { items: [payload()], next: null, total: 1, offset: 0, limit: 10,
      href: "https://api.spotify.com/v1/search?q=Discovery%20Daft%20Punk&type=album" } }) });
  await value.client.search(query, undefined, undefined, event => events.push(event));
  const pages = events.filter(event => event.kind === "page");
  assert.deepEqual(pages.map(event => event.strategy), ["filtered", "free-text"]);
  assert.equal(pages[1].expression, "Discovery Daft Punk");
  assert.equal(pages[1].returnedQuery, "Discovery Daft Punk");
  assert.equal(pages[1].total, 1);
  assert.equal(pages[1].candidates[0].id, albumId);
  assert.ok(events.some(event => event.kind === "response" && event.status === 200));
  assert.doesNotMatch(JSON.stringify(events), /existing-access|existing-refresh|Authorization|Bearer/);
});

test("diagnóstico inclui os dois códigos HTTP quando uma busca renova após 401", async () => {
  const events = [];
  let searches = 0;
  const value = setup({ session: connected(), fetch: (url) => url.pathname === "/api/token"
    ? Response.json(token()) : ++searches === 1 ? new Response(null, { status: 401 }) : page() });
  await value.client.search(query, undefined, undefined, event => events.push(event));
  assert.deepEqual(events.filter(event => event.kind === "response").map(event => event.status), [401, 200]);
  assert.ok(events.every(event => new URL(event.endpoint).pathname === "/v1/search"));
  assert.doesNotMatch(JSON.stringify(events), /test-access|test-refresh|code_verifier|api\/token/);
});

test("capa usa imagem HTTPS do Spotify com tamanho adequado para o card", async () => {
  const value = setup({session: connected(), fetch: () => page([{...payload(), images: [
    {url: "https://i.scdn.co/image/large", width: 640}, {url: "https://i.scdn.co/image/small", width: 64},
    {url: "https://i.scdn.co/image/medium", width: 160},
  ]}])});
  assert.equal((await value.client.search(query))[0].artworkUrl, "https://i.scdn.co/image/medium");
});

test("capa inválida, ausente ou de outro domínio não impede a busca", async () => {
  for (const images of [undefined, [], [{url: "javascript:alert(1)"}], [{url: "https://other.example/image/cover"}], [{url: "https://user:password@i.scdn.co/image/cover"}]]) {
    const value = setup({session: connected(), fetch: () => page([{...payload(), images}])});
    assert.equal((await value.client.search(query))[0].artworkUrl, undefined);
  }
});

test("detalhes preservam UPC/EAN brutos no diagnóstico sem credenciais", async () => {
  const events = [];
  const value = setup({session: connected(), fetch: () => Response.json({...payload(), external_ids: {upc: "745099040628", ean: "0745099040628"}})});
  const result = await value.client.albumDetails(albumId, undefined, event => events.push(event));
  assert.deepEqual(result.externalIds, {upc: "745099040628", ean: "0745099040628"});
  assert.equal(result.album.upc, "745099040628");
  assert.equal(events.find(event => event.kind === "album-details").externalIds.ean, "0745099040628");
  assert.doesNotMatch(JSON.stringify(events), /existing-access|existing-refresh|Bearer/);
});

test("consulta Libib remove artista repetido e mídia preservando termos de edição e identidade original", async () => {
  const value = setup({session: connected()});
  await value.client.search({...query, title: "The Smiths -...Best Ii [CD]", artist: "The Smiths"});
  assert.equal(value.calls[0].url.searchParams.get("q"), 'album:"best ii" artist:"The Smiths"');
  await value.client.search({...query, title: "The Smiths - Best II (2011 Remaster) [Deluxe]", artist: "The Smiths"});
  assert.equal(value.calls[1].url.searchParams.get("q"), 'album:"best ii 2011 remaster deluxe" artist:"The Smiths"');
  await value.client.search({...query, title: "The Smiths -...Best Ii [CD]", artist: "The Smiths", source: {...query.source, catalogId: "preview"}});
  assert.equal(value.calls[2].url.searchParams.get("q"), 'album:"The Smiths -...Best Ii [CD]" artist:"The Smiths"');
  await value.client.search({...query, title: "Eminem Show Stickered explicit_lyrics", artist: "Eminem"});
  assert.equal(value.calls[3].url.searchParams.get("q"), 'album:"eminem show" artist:"Eminem"');
});

test("verificação de UPC registra código divergente antes de seguir por metadados", async () => {
  const events = [];
  const value = setup({session: connected(), fetch: url => url.pathname.startsWith("/v1/albums/")
    ? Response.json({...payload(), external_ids: {upc: "745099040628"}}) : page()});
  await value.client.search({...query, upc: "036000291452"}, undefined, undefined, event => events.push(event));
  assert.ok(events.some(event => event.kind === "album-details" && event.externalIds.upc === "745099040628"));
  assert.ok(events.some(event => event.kind === "identifier-check" && event.requestedIdentifier === "036000291452" && event.matchesIdentifier === false));
});

test("sem artista consulta UPC antes do título", async () => {
  const value = setup({session: connected(), fetch: () => page([{...payload(), external_ids: {upc: "036000291452"}}])});
  const result = await searchAlbums(value.client, {...query, artist: "", upc: "036000291452"});
  assert.equal(result.reason, "identifier");
  assert.equal(value.calls[0].url.searchParams.get("q"), "upc:036000291452");
});

test("sem artista e sem código usa filtro de título e não envia filtro vazio", async () => {
  const value = setup({session: connected()});
  await value.client.search({...query, artist: ""});
  assert.equal(value.calls[0].url.searchParams.get("q"), 'album:"Discovery"');
});

test("sem artista UPC ausente ainda permite a alternativa por título", async () => {
  const value = setup({session: connected(), fetch: url => url.searchParams.get("q").startsWith("upc:") ? page([]) : page()});
  await value.client.search({...query, artist: "", upc: "036000291452"});
  assert.equal(value.calls.at(-1).url.searchParams.get("q"), 'album:"Discovery"');
});
