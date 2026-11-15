import test from "node:test";
import assert from "node:assert/strict";
import {ARTWORK_BYTE_LIMIT, albumArtworkVariants, fetchAlbumArtwork, imageFormat, isAlbumArtworkUrl, loadAlbumArtworkResource} from "../src/albums/album-artwork.ts";

const png = Uint8Array.from([137,80,78,71,13,10,26,10,1]);
const album = (changes = {}) => ({service: "spotify", id: "A".repeat(22), title: "Discovery", artists: [{id: "artist", name: "Daft Punk"}],
  url: "https://open.spotify.com/album/" + "A".repeat(22), artworkUrl: "https://i.scdn.co/image/cover", ...changes});
const image = (width = 640, height = 640, onClose = () => {}) => ({width, height, close: onClose});
const success = changes => fetchAlbumArtwork(album(changes), {fetch: async () => new Response(png), decode: async () => image()});

test("preserva variantes válidas e dimensões opcionais, excluindo destinos externos e credenciais", () => {
  const variants = albumArtworkVariants("spotify", [
    {url: "https://i.scdn.co/image/cover", width: 640, height: 640},
    {url: "https://i.scdn.co/image/unknown", width: null, height: -1},
    {url: "https://evil.test/image/cover", width: 9000},
    {url: "https://user:pass@i.scdn.co/image/secret"},
    {url: "http://i.scdn.co/image/cover"}, {url: "https://i.scdn.co:8443/image/cover"},
  ]);
  assert.deepEqual(variants, [{url: "https://i.scdn.co/image/cover", width: 640, height: 640}, {url: "https://i.scdn.co/image/unknown"}]);
  for (const url of ["data:image/png;base64,aaa", "file:///tmp/cover", "https://i.scdn.co.evil.test/image/cover", "https://i.scdn.co/other/cover", "https://i.scdn.co/image/cover#fragment"])
    assert.equal(isAlbumArtworkUrl("spotify", url), false);
  assert.equal(isAlbumArtworkUrl("youtube-music", "https://yt3.googleusercontent.com/cover=w544-h544-rj"), true);
  assert.equal(isAlbumArtworkUrl("youtube-music", "https://i.scdn.co/image/cover"), false);
});

test("escolhe pelas dimensões decodificadas mesmo com metadados fora de ordem ou incorretos", async () => {
  const sizes = new Map([[1, 640], [2, 160], [3, 1200]]), calls = [], closed = [];
  const source = album({artworkUrl: undefined, artworkVariants: [
    {url: "https://i.scdn.co/image/one", width: 9000}, {url: "https://i.scdn.co/image/two", width: 160}, {url: "https://i.scdn.co/image/three"},
  ]});
  const result = await fetchAlbumArtwork(source, {fetch: async (url, init) => {
    calls.push([url, init]); const number = ["one", "two", "three"].indexOf(url.split("/").at(-1)) + 1;
    return new Response(Uint8Array.from([...png.slice(0,8), number]), {headers: {"Content-Type": "application/octet-stream"}});
  }, decode: async blob => {const n = new Uint8Array(await blob.arrayBuffer())[8]; return image(sizes.get(n), sizes.get(n), () => closed.push(n));}});
  assert.equal(result.width, 1200); assert.equal(result.height, 1200); assert.equal(result.sourceUrl, "https://i.scdn.co/image/three");
  assert.equal(result.mimeType, "image/png"); assert.equal(result.byteLength, 9); assert.deepEqual(result.warnings, []);
  assert.equal(calls.every(([,init]) => init.credentials === "omit" && init.redirect === "error" && init.referrerPolicy === "no-referrer" && init.method === "GET"), true);
  assert.deepEqual(closed, [1,2,3]);
});

test("YouTube solicita s0 e mede a imagem recebida sem ampliar a miniatura", async () => {
  const calls = [];
  const result = await fetchAlbumArtwork(album({service: "youtube-music", id: "MPREcontrolled", artworkUrl: "https://yt3.googleusercontent.com/cover=w544-h544-l90-rj"}), {
    fetch: async url => {calls.push(url); return new Response(Uint8Array.from([...png.slice(0,8), url.endsWith("=s0") ? 4 : 1]));},
    decode: async blob => image(new Uint8Array(await blob.arrayBuffer())[8] * 1000, 4000),
  });
  assert.equal(calls.includes("https://yt3.googleusercontent.com/cover=s0"), true);
  assert.equal(result.width, 4000); assert.equal(result.sourceUrl.endsWith("=s0"), true);
});

test("não inventa variante original para ytimg nem altera URL com parâmetros", async () => {
  for (const url of ["https://i.ytimg.com/vi/controlled/hqdefault.jpg", "https://lh3.googleusercontent.com/cover=w544-h544?signature=controlled"]) {
    const calls = [];
    await fetchAlbumArtwork(album({service: "youtube-music", id: "MPREcontrolled", artworkUrl: url}), {fetch: async value => {calls.push(value); return new Response(png);}, decode: async () => image()});
    assert.deepEqual(calls, [url]);
  }
});

test("arquivo pequeno é permitido com aviso quando qualquer dimensão estiver abaixo de 300", async () => {
  for (const [width,height] of [[299,300], [300,299], [60,60], [300,300]]) {
    const value = await fetchAlbumArtwork(album(), {fetch: async () => new Response(png), decode: async () => image(width,height)});
    assert.equal(value.warnings.includes("low-resolution"), width < 300 || height < 300);
  }
});

test("content-length acima de 20 MB interrompe antes de decodificar e cancela o corpo", async () => {
  let decoded = false, cancelled = false;
  await assert.rejects(fetchAlbumArtwork(album(), {fetch: async () => new Response(new ReadableStream({cancel() {cancelled = true;}}), {headers: {"Content-Length": String(ARTWORK_BYTE_LIMIT + 1)}}),
    decode: async () => {decoded = true; return image();}}), error => error.code === "too-large");
  assert.equal(decoded, false); assert.equal(cancelled, true);
});

test("stream sem tamanho confiável é interrompido ao exceder o limite real", async () => {
  for (const headers of [{}, {"Content-Length": "1"}]) {
    let cancelled = false, sent = 0;
    await assert.rejects(fetchAlbumArtwork(album(), {fetch: async () => new Response(new ReadableStream({pull(controller) {
      controller.enqueue(new Uint8Array(1_000_000)); if (++sent === 22) controller.close();
    }, cancel() {cancelled = true;}}), {headers}), decode: async () => image()}), error => error.code === "too-large");
    assert.equal(cancelled, true); assert.ok(sent <= 22);
  }
});

test("limite exato é aceito e o peso corresponde aos bytes preservados", async () => {
  const bytes = new Uint8Array(ARTWORK_BYTE_LIMIT); bytes.set(png);
  const result = await fetchAlbumArtwork(album(), {fetch: async () => new Response(bytes), decode: async () => image()});
  assert.equal(result.byteLength, ARTWORK_BYTE_LIMIT);
  assert.equal(Buffer.from(result.dataBase64, "base64").length, ARTWORK_BYTE_LIMIT);
});

test("JPEG, PNG, GIF e WebP são reconhecidos pelo conteúdo e SVG/HTML são recusados", async () => {
  const formats = [["jpeg", Uint8Array.from([255,216,255,1])], ["png", png], ["gif", new TextEncoder().encode("GIF89a")], ["webp", new TextEncoder().encode("RIFFxxxxWEBP")]];
  for (const [format,bytes] of formats) {
    assert.equal(imageFormat(bytes), format);
    const result = await fetchAlbumArtwork(album(), {fetch: async () => new Response(bytes, {headers: {"Content-Type": "text/html"}}), decode: async () => image()});
    assert.equal(result.format, format); assert.equal(result.mimeType, "image/" + format);
  }
  for (const value of ["<svg></svg>", "<html>login</html>", "", "not-image"])
    await assert.rejects(fetchAlbumArtwork(album(), {fetch: async () => new Response(value), decode: async () => image()}), error => error.code === "unsupported-format");
});

test("assinatura válida não basta: falha de decodificação ou dimensões inválidas impedem uso", async () => {
  for (const decode of [async () => {throw Error("private-decoder-error");}, async () => image(0,100), async () => image(Infinity,100)])
    await assert.rejects(fetchAlbumArtwork(album(), {fetch: async () => new Response(png), decode}), error => error.code === "invalid-image" && !error.message.includes("private"));
});

test("variante inválida ou grande demais não elimina alternativa válida e gera aviso", async () => {
  const source = album({artworkVariants: [{url: "https://i.scdn.co/image/huge", width: 4000}], artworkUrl: "https://i.scdn.co/image/cover"});
  const result = await fetchAlbumArtwork(source, {fetch: async url => url.endsWith("huge") ? new Response("", {headers: {"Content-Length": String(ARTWORK_BYTE_LIMIT+1)}}) : new Response(png), decode: async () => image()});
  assert.equal(result.sourceUrl, source.artworkUrl); assert.deepEqual(result.warnings, ["unavailable-variants"]);
});

test("falhas e ausência de capa preservam o álbum de entrada e não acessam catálogo", async () => {
  for (const source of [album({artworkUrl: undefined}), album({artworkUrl: "https://evil.test/cover"}), album({id: "../invalid"}), album({service: "deezer"})]) {
    const before = structuredClone(source); let calls = 0;
    await assert.rejects(fetchAlbumArtwork(source, {fetch: async () => {calls++; return new Response(png);}}));
    assert.deepEqual(source, before); assert.equal(calls, 0);
  }
  for (const fetcher of [async () => new Response("private-body", {status: 404}), async () => {throw Error("private-network");}])
    await assert.rejects(fetchAlbumArtwork(album(), {fetch: fetcher}), error => error.code === "network" && !error.message.includes("private"));
});

test("cancelamento antes, durante a leitura e depois de decodificar não retorna imagem antiga", async () => {
  const before = new AbortController(); before.abort(); let calls = 0;
  await assert.rejects(fetchAlbumArtwork(album(), {signal: before.signal, fetch: async () => {calls++; return new Response(png);}}), error => error.code === "cancelled");
  assert.equal(calls, 0);
  const later = new AbortController();
  await assert.rejects(fetchAlbumArtwork(album(), {signal: later.signal, fetch: async () => {later.abort(); throw Error("aborted");}}), error => error.code === "cancelled");
  const decoded = new AbortController(); let closed = false;
  await assert.rejects(fetchAlbumArtwork(album(), {signal: decoded.signal, fetch: async () => new Response(png), decode: async () => {decoded.abort(); return image(640,640,()=>{closed=true;});}}), error => error.code === "cancelled");
  assert.equal(closed, true);
});

test("File preserva bytes, formato e nome; referências mantêm prévia até o último uso", async () => {
  const data = await success(), revoked = [], created = [];
  const resource = await loadAlbumArtworkResource(album(), async () => data, {urls: {createObjectURL(file) {created.push(file); return "blob:controlled";}, revokeObjectURL(url) {revoked.push(url);}}});
  assert.equal(resource.file.type, "image/png"); assert.equal(resource.file.size, png.length);
  assert.deepEqual(new Uint8Array(await resource.file.arrayBuffer()), png); assert.equal(resource.file.name.endsWith(".png"), true);
  assert.equal("dataBase64" in resource.metadata, false); assert.equal(created.length, 1);
  resource.retain(); resource.release(); assert.deepEqual(revoked, []);
  resource.release(); resource.release(); assert.deepEqual(revoked, ["blob:controlled"]);
  assert.throws(() => resource.retain(), error => error.code === "invalid-input");
});

test("recurso descartado antes da resposta não cria URL nem modifica o álbum", async () => {
  const data = await success(), controller = new AbortController(); let created = 0;
  const source = album(), before = structuredClone(source);
  await assert.rejects(loadAlbumArtworkResource(source, async value => {value.title = "Mutated request"; controller.abort(); return data;}, {signal: controller.signal, urls: {createObjectURL() {created++; return "blob:unused";}, revokeObjectURL() {}}}), error => error.code === "cancelled");
  assert.equal(created, 0); assert.deepEqual(source, before);
});

test("resposta para outro álbum, bytes divergentes ou dimensões inválidas não cria prévia", async () => {
  const data = await success(); let created = 0;
  for (const change of [{service: "youtube-music"}, {albumId: "other"}, {byteLength: data.byteLength+1}, {width: 0}, {dataBase64: "!invalid!"}, {format: "jpeg"}, {mimeType: "text/html"}, {sourceUrl: "https://evil.test/cover"}])
    await assert.rejects(loadAlbumArtworkResource(album(), async () => ({...data,...change}), {urls: {createObjectURL() {created++; return "blob:unused";}, revokeObjectURL() {}}}));
  assert.equal(created, 0);
});
