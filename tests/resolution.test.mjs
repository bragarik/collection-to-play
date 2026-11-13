import test from "node:test";
import assert from "node:assert/strict";
import {
  createRememberedChoice,
  getLookupKey,
  normalizeMetadata,
  resolveCandidates,
  searchAlbums,
  StreamingError,
} from "../dist/resolution.js";
import { normalizeProductCode, productCodesMatch } from "../dist/identifiers.js";

const query = {
  title: "Discovery",
  artist: "Daft Punk",
  source: { catalogId: "libib", itemId: "record-42", itemUrl: "https://www.libib.com/library/42" },
};
function album(id, title = "Discovery", artistId = "daft-punk", name = "Daft Punk", service = "spotify") {
  return { service, id, title, artists: [{ id: artistId, name }], url: `https://open.spotify.com/album/${id}` };
}
const original = album("original");
const deluxe = album("deluxe", "Discovery (Deluxe Edition)");
const unrelated = album("unrelated", "Discovery", "data-punk", "Data Punk");

test("abre uma correspondência única por título e artista, ignorando resultados de outro artista", () => {
  const result = resolveCandidates(query, "spotify", [unrelated, original]);
  assert.equal(result.status, "resolved");
  assert.equal(result.album.id, "original");
  assert.equal(result.reason, "exact-match");
});

test("mantém original e deluxe como opções e não marca lembrar por padrão", () => {
  const result = resolveCandidates(query, "spotify", [deluxe, unrelated, original]);
  assert.equal(result.status, "choose");
  assert.deepEqual(result.candidates.map((item) => item.id), ["original", "deluxe"]);
  assert.equal(result.rememberAlbumByDefault, false);
});

test("lembra artista sem lembrar álbum e filtra o próximo clique pelo ID do artista", () => {
  const choice = createRememberedChoice(query, original, "daft-punk");
  assert.equal(choice.album, undefined);
  const result = resolveCandidates(query, "spotify", [unrelated, deluxe, original], choice);
  assert.equal(result.status, "choose");
  assert.deepEqual(result.candidates.map((item) => item.id), ["original", "deluxe"]);
  assert.equal(result.rememberAlbumByDefault, false);
});

test("um único resultado do artista lembrado identifica o álbum mesmo entre dez resultados", () => {
  const others = Array.from({ length: 9 }, (_, index) => album(`other-${index}`, "Discovery", `artist-${index}`, `Other ${index}`));
  const choice = createRememberedChoice(query, original, "daft-punk");
  const result = resolveCandidates(query, "spotify", [...others, original], choice);
  assert.equal(result.status, "resolved");
  assert.equal(result.album.id, "original");
  assert.equal(result.reason, "remembered-artist");
});

test("álbum salvo tem precedência e dispensa nova chamada ao serviço", async () => {
  const choice = createRememberedChoice(query, deluxe, "daft-punk", true);
  let requests = 0;
  const result = await searchAlbums({ id: "spotify", search: async () => { requests++; throw new Error("offline"); } }, query, choice);
  assert.equal(result.status, "resolved");
  assert.equal(result.album.id, "deluxe");
  assert.equal(result.reason, "remembered-album");
  assert.equal(requests, 0);
});

test("sem registro lembrado, a escolha anterior deixa de restringir o artista", () => {
  const changedQuery = { ...query, artist: "Artista escrito incorretamente" };
  const result = resolveCandidates(changedQuery, "spotify", [original, unrelated]);
  assert.equal(result.status, "choose");
  assert.deepEqual(result.candidates.map((item) => item.id), ["original", "unrelated"]);
});

test("não reutiliza lembranças de outro item, serviço ou catálogo", async () => {
  const remembered = createRememberedChoice(query, deluxe, "daft-punk", true);
  const otherItem = { ...query, source: { ...query.source, itemId: "record-43" } };
  const otherCatalog = { ...query, source: { ...query.source, catalogId: "another-library" } };
  assert.notEqual(getLookupKey(otherItem, "spotify"), remembered.key);
  assert.notEqual(getLookupKey(otherCatalog, "spotify"), remembered.key);
  assert.notEqual(getLookupKey(query, "deezer"), remembered.key);
  let requests = 0;
  const adapter = { id: "spotify", search: async () => { requests++; return [original]; } };
  const result = await searchAlbums(adapter, otherItem, remembered);
  assert.equal(requests, 1);
  assert.equal(result.album.id, "original");
  assert.equal(result.reason, "exact-match");
});

test("sem ID de item, a chave distingue álbuns na mesma página da coleção", () => {
  const source = { catalogId: "libib", itemUrl: "https://www.libib.com/library" };
  assert.notEqual(getLookupKey({ ...query, source }, "spotify"), getLookupKey({ ...query, title: "Homework", source }, "spotify"));
});

test("normaliza acentos e pontuação sem apagar diferenças de edição", () => {
  assert.equal(normalizeMetadata("  João  Gilberto! "), normalizeMetadata("Joao Gilberto"));
  assert.notEqual(normalizeMetadata("Discovery"), normalizeMetadata("Discovery (Deluxe Edition)"));
  assert.notEqual(normalizeMetadata("Discovery"), normalizeMetadata("Discovery - 2011 Remaster"));
});

test("artistas homônimos com IDs distintos exigem escolha", () => {
  const homonym = album("homonym", "Discovery", "another-daft-punk", "Daft Punk");
  const result = resolveCandidates(query, "spotify", [original, homonym]);
  assert.equal(result.status, "choose");
  assert.equal(result.candidates.length, 2);
  const choice = createRememberedChoice(query, homonym, "another-daft-punk");
  assert.equal(resolveCandidates(query, "spotify", [original, homonym], choice).album.id, "homonym");
});

test("um resultado de título ou artista diferente não é aberto automaticamente", () => {
  assert.equal(resolveCandidates(query, "spotify", [unrelated]).status, "choose");
  assert.equal(resolveCandidates(query, "spotify", [album("homework", "Homework")]).status, "choose");
});

test("ausência oferece busca explícita, sem substituir pelo resultado de outro artista", () => {
  const choice = createRememberedChoice(query, original, "daft-punk");
  for (const candidates of [[], [unrelated]]) {
    const result = resolveCandidates(query, "spotify", candidates, choice);
    assert.equal(result.status, "not-found");
    assert.equal(result.offerSearch, true);
  }
});

test("deduplica o mesmo álbum sem mutar os resultados do serviço", () => {
  const candidates = Object.freeze([Object.freeze(original), Object.freeze({ ...original })]);
  const result = resolveCandidates(query, "spotify", candidates);
  assert.equal(result.status, "resolved");
  assert.equal(candidates.length, 2);
});

test("rejeita seleção com artista que não pertence ao álbum", () => {
  assert.throws(() => createRememberedChoice(query, original, "other-artist"), /pertencer ao álbum/);
});

test("o álbum lembrado é um snapshot independente da resposta original", () => {
  const candidate = album("snapshot");
  const choice = createRememberedChoice(query, candidate, "daft-punk", true);
  candidate.title = "Alterado";
  candidate.artists[0].name = "Outro nome";
  assert.equal(choice.album.title, "Discovery");
  assert.equal(choice.album.artists[0].name, "Daft Punk");
});

test("consultas incompletas falham antes de chamar a API", async () => {
  let requests = 0;
  const result = await searchAlbums({ id: "spotify", search: async () => { requests++; return []; } }, { ...query, title: " " });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "invalid-query");
  assert.equal(requests, 0);
});

test("não abre URLs executáveis nem trata uma resposta inválida como ausência", () => {
  const result = resolveCandidates(query, "spotify", [{ ...original, url: "javascript:alert(1)" }]);
  assert.equal(result.status, "failed");
  assert.equal(result.code, "invalid-response");
  assert.equal(resolveCandidates(query, "spotify", null).code, "invalid-response");
  assert.equal(resolveCandidates(query, "spotify", [album("other-service", "Discovery", "daft-punk", "Daft Punk", "deezer")]).code, "invalid-response");
});

test("erros de autenticação, quota e indisponibilidade não viram álbum não encontrado", async () => {
  for (const code of ["authentication-required", "rate-limited", "unavailable"]) {
    const result = await searchAlbums({ id: "spotify", search: async () => { throw new StreamingError(code, "Teste de erro", 30); } }, query);
    assert.equal(result.status, "failed");
    assert.equal(result.code, code);
    assert.equal(result.retryAfterSeconds, 30);
  }
});

test("falha de rede e falha inesperada são estados distintos", async () => {
  for (const [error, code] of [[new TypeError("fetch failed"), "network"], [new Error("unhandled"), "unexpected"]]) {
    const result = await searchAlbums({ id: "spotify", search: async () => { throw error; } }, query);
    assert.equal(result.status, "failed");
    assert.equal(result.code, code);
  }
});

test("cancelamento anterior impede a busca e cancelamento durante a busca impede abrir o álbum", async () => {
  const before = new AbortController();
  before.abort();
  let requests = 0;
  const cancelled = await searchAlbums({ id: "spotify", search: async () => { requests++; return [original]; } }, query, undefined, before.signal);
  assert.equal(cancelled.code, "cancelled");
  assert.equal(requests, 0);
  const during = new AbortController();
  const result = await searchAlbums({ id: "spotify", search: async () => { during.abort(); return [original]; } }, query, undefined, during.signal);
  assert.equal(result.code, "cancelled");
});

test("UPC e EAN preservam zeros, validam o dígito e reconhecem a representação equivalente", () => {
  assert.equal(normalizeProductCode("0 36000-29145 2"), "036000291452");
  assert.equal(normalizeProductCode("4006381333931"), "4006381333931");
  assert.equal(normalizeProductCode("036000291453"), undefined);
  assert.equal(normalizeProductCode("000000000000"), undefined);
  assert.equal(normalizeProductCode("9780132350"), undefined);
  assert.equal(productCodesMatch("036000291452", "0036000291452"), true);
  assert.equal(productCodesMatch("036000291452", "4006381333931"), false);
});

test("um código confirmado resolve o álbum mesmo quando o nome do artista difere", () => {
  const requested = { ...query, artist: "Shaaman", upc: "036000291452" };
  const candidate = { ...original, upc: "0036000291452" };
  const result = resolveCandidates(requested, "spotify", [candidate, unrelated]);
  assert.equal(result.status, "resolved");
  assert.equal(result.reason, "identifier");
  assert.equal(result.album.id, "original");
});

test("dois álbuns com o mesmo código confirmado continuam exigindo escolha", () => {
  const result = resolveCandidates({ ...query, upc: "036000291452" }, "spotify", [
    { ...original, upc: "036000291452" }, { ...deluxe, ean: "0036000291452" },
  ]);
  assert.equal(result.status, "choose");
  assert.equal(result.candidates.length, 2);
  assert.equal(result.rememberAlbumByDefault, false);
});

test("sem ID de item, códigos diferentes distinguem edições e UPC/EAN equivalentes compartilham chave", () => {
  const source = { catalogId: "libib", itemUrl: "https://www.libib.com/library" };
  const first = getLookupKey({ ...query, source, upc: "036000291452" }, "spotify");
  assert.notEqual(first, getLookupKey({ ...query, source, ean: "4006381333931" }, "spotify"));
  assert.equal(first, getLookupKey({ ...query, source, ean: "0036000291452" }, "spotify"));
});

test("artista ausente permite busca e escolha sem inventar um nome no catálogo", async () => {
  const incomplete = {...query, artist: ""};
  const result = await searchAlbums({id: "spotify", search: async () => [original, deluxe]}, incomplete);
  assert.equal(result.status, "choose");
  const saved = createRememberedChoice(incomplete, original, original.artists[0].id, true);
  assert.equal(saved.query.artist, "");
  const again = await searchAlbums({id: "spotify", search: () => {throw Error("não consultar");}}, incomplete, saved);
  assert.equal(again.reason, "remembered-album");
});

test("artista vazio não altera chaves de itens completos e mantém isolamento por código", () => {
  const metadata = {...query, source: {catalogId: "libib", itemUrl: "https://www.libib.com/library"}};
  const blank = {...metadata, artist: ""};
  assert.equal(getLookupKey({...query, artist: ""}, "spotify"), getLookupKey(query, "spotify"));
  assert.notEqual(getLookupKey(blank, "spotify"), getLookupKey(metadata, "spotify"));
  assert.notEqual(getLookupKey({...blank, upc: "036000291452"}, "spotify"), getLookupKey(blank, "spotify"));
  assert.equal(getLookupKey({...blank, upc: "036000291452"}, "spotify"), getLookupKey({...blank, ean: "0036000291452"}, "spotify"));
});
