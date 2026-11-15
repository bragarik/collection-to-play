import test from "node:test";
import assert from "node:assert/strict";
import {AlbumComposition} from "../src/albums/album-composition.ts";
import {AlbumArtworkResource, ArtworkError} from "../src/albums/album-artwork.ts";
import {MetadataSearchSession} from "../src/streamings/metadata-search.ts";

const spotify = (id = "A".repeat(22), changes = {}) => ({service: "spotify", id, title: "Spotify title", artists: [{id: "sp-artist", name: "Spotify artist"}], url: "https://open.spotify.com/album/" + id, ...changes});
const youtube = (id = "MPREcontrolled", changes = {}) => ({service: "youtube-music", id, title: "YouTube title", artists: [{id: "yt-artist", name: "YouTube artist"}], url: "https://music.youtube.com/browse/" + id, ...changes});
const deferred = () => {let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes; reject=no;}); return {promise,resolve,reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));
function resource(source, events = []) {
  const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,1]);
  return new AlbumArtworkResource({service: source.service, albumId: source.id, sourceUrl: source.service === "spotify" ? "https://i.scdn.co/image/controlled" : "https://yt3.googleusercontent.com/controlled=s0",
    format: "png", mimeType: "image/png", width: 640, height: 640, byteLength: bytes.length, warnings: []}, bytes,
  {createObjectURL() {const url="blob:controlled-" + source.service + "-" + source.id; events.push(["create",url]); return url;}, revokeObjectURL(url) {events.push(["revoke",url]);}});
}

test("valores iniciais não são enviados e selecionar cards não altera o formulário", () => {
  const artists = ["Original artist"], model = new AlbumComposition({title: "Original title", artists});
  artists.push("External mutation"); model.addAlbum(spotify()); model.addAlbum(youtube()); model.selectAlbum("youtube-music");
  const snapshot = model.snapshot();
  assert.equal(snapshot.selectedService, "youtube-music"); assert.equal(snapshot.cards.length, 2);
  assert.equal(snapshot.fields.title.value, "Original title"); assert.deepEqual(snapshot.fields.artists.value, ["Original artist"]);
  assert.equal(snapshot.fields.title.source.kind, "catalog"); assert.deepEqual(model.changes(), {}); model.dispose();
});

test("um álbum por serviço: trocar exige remover o card, mantendo valores copiados", () => {
  const model = new AlbumComposition(); model.addAlbum(spotify()); model.selectAlbum("spotify"); model.copyAll();
  assert.throws(() => model.addAlbum(spotify("B".repeat(22))), /Remova/); assert.equal(model.snapshot().cards.length, 1);
  model.removeAlbum("spotify"); model.addAlbum(spotify("B".repeat(22), {title: "Replacement"})); model.selectAlbum("spotify");
  assert.equal(model.snapshot().fields.title.value, "Spotify title"); assert.equal(model.snapshot().fields.title.source.albumId, "A".repeat(22));
  model.copyField("title"); assert.equal(model.snapshot().fields.title.value, "Replacement"); assert.equal(model.snapshot().fields.title.source.albumId, "B".repeat(22)); model.dispose();
});

test("mistura campos entre serviços e substitui integralmente a lista de artistas", () => {
  const model = new AlbumComposition({artists: ["Initial"]}); model.addAlbum(spotify()); model.addAlbum(youtube("MPREcontrolled", {artists: [{id:"one",name:"One"},{id:"two",name:"Two"}]}));
  model.copyField("title", "spotify"); model.copyField("artists", "youtube-music");
  assert.deepEqual(model.changes(), {title: "Spotify title", artists: ["One", "Two"]});
  assert.equal(model.snapshot().fields.title.source.service, "spotify"); assert.equal(model.snapshot().fields.artists.source.service, "youtube-music");
  model.copyField("artists", "spotify"); assert.deepEqual(model.changes().artists, ["Spotify artist"]); model.dispose();
});

test("copiar valor igual ao inicial ainda o marca para aplicação, sem incluir outros campos", () => {
  const model = new AlbumComposition({title: "Spotify title", artists: ["Original"]}); model.addAlbum(spotify());
  model.copyField("title", "spotify"); assert.deepEqual(model.changes(), {title: "Spotify title"});
  assert.equal(model.snapshot().fields.artists.included, false); model.dispose();
});

test("+ todos preserva campos ausentes e não faz cópia automática quando a capa chega", async () => {
  const pending = deferred(), events = [];
  const model = new AlbumComposition({title: "Original", artists: ["Original artist"]}, {loadArtwork: () => pending.promise});
  model.addAlbum(spotify(undefined, {title: undefined, artists: undefined}));
  model.selectAlbum("spotify"); assert.equal(model.copyAll(), false); assert.deepEqual(model.changes(), {});
  model.removeAlbum("spotify"); model.addAlbum(spotify()); model.selectAlbum("spotify");
  const loading = model.loadArtwork("spotify"); await tick(); model.copyAll(); assert.equal("artwork" in model.changes(), false);
  pending.resolve(resource(spotify(), events)); assert.equal(await loading, true); assert.equal("artwork" in model.changes(), false);
  model.copyAll(); assert.equal(model.changes().artwork instanceof File, true); model.dispose();
  assert.equal(events.filter(([event]) => event === "revoke").length, 1);
});

test("edição manual conserva texto exato e informa a origem anterior sem acumular histórico recursivo", () => {
  const model = new AlbumComposition(); model.addAlbum(spotify()); model.copyAll("spotify");
  model.editTitle("  Manual draft  "); model.editTitle("Second draft");
  model.editArtists(["Name, with comma", 'Name "quoted"', "Name\nwith newline"]);
  const fields = model.snapshot().fields;
  assert.equal(fields.title.source.kind, "manual"); assert.equal(fields.title.source.basedOn.kind, "streaming");
  assert.equal(fields.title.source.basedOn.service, "spotify"); assert.equal("basedOn" in fields.title.source.basedOn, false);
  assert.deepEqual(model.changes().artists, ["Name, with comma", 'Name "quoted"', "Name\nwith newline"]);
  model.editTitle(""); model.editArtists([]); assert.deepEqual(model.changes(), {title: "", artists: []}); model.dispose();
});

test("excluir campo da aplicação conserva o rascunho e permite incluí-lo novamente", () => {
  const model = new AlbumComposition(); model.editTitle("Manual title"); model.editArtists(["Artist"]);
  model.setIncluded("title", false); assert.deepEqual(model.changes(), {artists: ["Artist"]});
  assert.equal(model.snapshot().fields.title.value, "Manual title"); model.setIncluded("title", true);
  assert.equal(model.changes().title, "Manual title"); assert.throws(() => model.setIncluded("artwork", true), /Escolha uma capa/); model.dispose();
});

test("alteração apenas de capa inclui somente File e mantém origem após remover o card", async () => {
  const events = [], source = spotify(), cover = resource(source, events);
  const model = new AlbumComposition({title: "Original", artists: ["Initial"]}, {loadArtwork: async () => cover});
  model.addAlbum(source); await model.loadArtwork("spotify"); model.copyField("artwork", "spotify");
  const patch = model.changes(); assert.deepEqual(Object.keys(patch), ["artwork"]); assert.equal(patch.artwork, cover.file);
  model.removeAlbum("spotify"); assert.equal(events.filter(([event]) => event === "revoke").length, 0);
  assert.equal(model.snapshot().fields.artwork.source.albumId, source.id); assert.equal(model.snapshot().fields.artwork.value.previewUrl, cover.previewUrl);
  model.dispose(); assert.equal(events.filter(([event]) => event === "revoke").length, 1);
});

test("trocar a capa composta libera só sua referência e não a imagem de um card ainda existente", async () => {
  const events = [], model = new AlbumComposition({}, {loadArtwork: async source => resource(source, events)});
  model.addAlbum(spotify()); model.addAlbum(youtube()); await model.loadArtwork("spotify"); await model.loadArtwork("youtube-music");
  model.copyField("artwork", "spotify"); model.copyField("artwork", "spotify"); model.copyField("artwork", "youtube-music");
  assert.equal(events.filter(([event]) => event === "revoke").length, 0);
  model.removeAlbum("spotify"); assert.equal(events.filter(([event]) => event === "revoke").length, 1);
  model.removeAlbum("youtube-music"); assert.equal(events.filter(([event]) => event === "revoke").length, 1);
  model.dispose(); assert.equal(events.filter(([event]) => event === "revoke").length, 2);
});

test("capa inicial e edição manual mantêm referências independentes dos proprietários externos", () => {
  const events = [], initial = resource(spotify(), events), replacement = resource(youtube(), events);
  const model = new AlbumComposition({artwork: initial}); initial.release(); assert.deepEqual(model.changes(), {});
  model.editArtwork(replacement); replacement.release();
  assert.equal(events.filter(([event]) => event === "revoke").length, 1);
  assert.equal(model.snapshot().fields.artwork.source.kind, "manual"); assert.equal(model.snapshot().fields.artwork.source.basedOn.service, "youtube-music");
  model.dispose(); model.dispose(); assert.equal(events.filter(([event]) => event === "revoke").length, 2);
});

test("remoção durante carregamento descarta imagem antiga mesmo após readicionar o mesmo álbum", async () => {
  const pending = deferred(), events = []; let signal;
  const model = new AlbumComposition({}, {loadArtwork: (_source, value) => {signal=value; return pending.promise;}});
  model.addAlbum(spotify()); const loading = model.loadArtwork("spotify"); await tick(); model.removeAlbum("spotify"); model.addAlbum(spotify());
  assert.equal(signal.aborted, true); pending.resolve(resource(spotify(), events)); assert.equal(await loading, false);
  assert.equal(model.snapshot().cards[0].artwork, undefined); assert.deepEqual(model.changes(), {});
  assert.equal(events.filter(([event]) => event === "revoke").length, 1); model.dispose();
});

test("falha da capa mantém composição e permite nova tentativa explícita, sem expor erros arbitrários", async () => {
  let fail = true, calls = 0;
  const model = new AlbumComposition({title: "Initial"}, {loadArtwork: async source => {calls++; if (fail) throw Error("private-error"); return resource(source);}});
  model.addAlbum(spotify()); model.copyAll("spotify"); model.editTitle("Manual"); const before = model.changes();
  assert.equal(await model.loadArtwork("spotify"), false); assert.deepEqual(model.changes(), before);
  assert.equal(model.snapshot().cards[0].artworkError.code, "network"); assert.equal(JSON.stringify(model.snapshot()).includes("private-error"), false);
  assert.equal(calls, 1); fail = false; assert.equal(await model.loadArtwork("spotify"), true); assert.equal(calls, 2);
  assert.equal(model.snapshot().cards[0].artworkError, undefined); assert.deepEqual(model.changes(), before); model.dispose();
});

test("capa de outro álbum é rejeitada e liberada; solicitações simultâneas são deduplicadas", async () => {
  const pending = deferred(), events = []; let calls = 0;
  const model = new AlbumComposition({}, {loadArtwork: () => {calls++; return pending.promise;}}); model.addAlbum(spotify());
  const a = model.loadArtwork("spotify"), b = model.loadArtwork("spotify"); assert.equal(a,b); await tick(); assert.equal(calls,1);
  pending.resolve(resource(youtube(),events)); assert.equal(await a,false); assert.equal(model.snapshot().cards[0].artworkError.code,"invalid-input");
  assert.equal(events.filter(([event]) => event === "revoke").length,1); model.dispose();
});

test("encerrar composição cancela carregamento e libera resposta tardia sem notificar a interface", async () => {
  const pending = deferred(), events = []; let notifications = 0;
  const model = new AlbumComposition({}, {loadArtwork: () => pending.promise}); model.subscribe(() => {notifications++;}); model.addAlbum(spotify());
  const loading = model.loadArtwork("spotify"); await tick(); model.dispose(); const before=notifications;
  pending.resolve(resource(spotify(),events)); assert.equal(await loading,false); assert.equal(notifications,before);
  assert.equal(events.filter(([event]) => event === "revoke").length,1);
  assert.throws(() => model.snapshot(), /encerrada/); assert.throws(() => model.editTitle("Late"), /encerrada/);
});

test("snapshots, entradas e patches não permitem alterar o estado por referência", () => {
  const model = new AlbumComposition(), source=spotify(); model.addAlbum(source); source.title="Mutated"; model.copyAll("spotify");
  const state=model.snapshot(); state.cards[0].album.title="Mutated snapshot"; state.fields.artists.value.push("Other"); state.fields.title.source.albumId="Other";
  const patch=model.changes(); patch.artists.push("Other patch");
  assert.equal(model.snapshot().cards[0].album.title,"Spotify title"); assert.deepEqual(model.changes().artists,["Spotify artist"]);
  assert.equal(model.snapshot().fields.title.source.albumId,spotify().id); model.dispose();
});

test("fontes e operações inválidas não alteram os dados; falha de assinante não impede os demais", () => {
  const model=new AlbumComposition({title:"Initial"}); let notices=0;
  model.subscribe(()=>{throw Error("view failure");}); const stop=model.subscribe(()=>{notices++;});
  for(const source of [spotify(undefined,{service:"deezer"}),spotify("../invalid"),spotify(undefined,{url:"https://evil.test/album"}),spotify(undefined,{artists:[null]})]) assert.throws(()=>model.addAlbum(source));
  assert.deepEqual(model.changes(),{}); assert.equal(model.snapshot().cards.length,0);
  assert.throws(()=>model.copyField("title"),/Selecione/); assert.throws(()=>model.editTitle(null),TypeError); assert.throws(()=>model.editArtists([null]),TypeError);
  model.editTitle("Edited"); assert.equal(notices,1); stop(); model.editTitle("Second"); assert.equal(notices,1); model.dispose();
});

test("busca, troca de serviço e reconexão preservam cards e formulário composto", async () => {
  let connected=true;
  const search=new MetadataSearchSession("spotify",{services:async()=>({configurationUrl:"chrome-extension://controlled/setup.html",services:[
    {id:"spotify",name:"Spotify",requiresAuthentication:true,connected},{id:"youtube-music",name:"YouTube Music",requiresAuthentication:false,connected:true}]}),
  search:async service=>({service,configurationUrl:"chrome-extension://controlled/setup.html",connectionRequired:false,searchUrl:"https://example.com/search",resolution:{status:"resolved",album:service==="spotify"?spotify():youtube(),reason:"exact-match"}})});
  const model=new AlbumComposition(); await search.search({title:"Album",artist:"Artist",sourceUrl:"https://www.libib.com/library"});
  model.addAlbum(search.snapshot().albums[0]); model.copyAll("spotify"); model.editTitle("Manual draft");
  search.selectService("youtube-music"); await search.search({title:"Album",artist:"Artist",sourceUrl:"https://www.libib.com/library"}); model.addAlbum(search.snapshot().albums[0]);
  connected=false; search.selectService("spotify"); const input={title:"Other",artist:"Artist",sourceUrl:"https://www.libib.com/library"};
  assert.equal((await search.search(input)).connectionRequired,true); connected=true; await search.refreshServices();
  assert.equal(model.snapshot().cards.length,2); assert.equal(model.changes().title,"Manual draft"); assert.equal(model.snapshot().fields.title.source.basedOn.service,"spotify"); model.dispose();
});

test("erro controlado de capa é mantido e card sem dados não apaga imagem já copiada", async () => {
  const model=new AlbumComposition({}, {loadArtwork:async source=>{if(source.service==="youtube-music"){const error=new ArtworkError("too-large");error.message="private-error";throw error;} return resource(source);}});
  model.addAlbum(spotify()); await model.loadArtwork("spotify"); model.copyField("artwork","spotify"); const file=model.changes().artwork;
  model.addAlbum(youtube(undefined,{title:"",artists:[]})); await model.loadArtwork("youtube-music"); assert.equal(model.copyAll("youtube-music"),false);
  assert.equal(model.changes().artwork,file); assert.equal(model.snapshot().cards[1].artworkError.code,"too-large");
  assert.equal(JSON.stringify(model.snapshot()).includes("private-error"),false); model.dispose();
});
