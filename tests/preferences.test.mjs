import test from "node:test";
import assert from "node:assert/strict";
import { LibraryPreferences } from "../dist/preferences.js";
import { searchAlbums } from "../dist/resolution.js";
const query = {title: "Reason", artist: "Shaaman", source: {catalogId: "libib", itemUrl: "https://www.libib.com/library"}};
const album = {service: "spotify", id: "A".repeat(22), title: "Reason", artists: [{id: "artist", name: "Shaman"}], url: `https://open.spotify.com/album/${"A".repeat(22)}`};
function setup() {
  let stored;
  let fail = false;
  const port = {load: async () => structuredClone(stored), save: async value => {
    if (fail) { fail = false; throw new Error("quota"); }
    stored = structuredClone(value);
  }};
  return {preferences: new LibraryPreferences(port), reload: () => new LibraryPreferences(port), fail: () => {fail = true;}, corrupt: value => {stored = value;}};
}
test("streaming começa sem padrão e a preferência sobrevive à reabertura", async () => {
  const value = setup(); assert.equal(await value.preferences.getService(), undefined);
  await value.preferences.setService("spotify"); assert.equal(await value.reload().getService(), "spotify");
});
test("escolha de artista é persistida mesmo sem lembrar álbum e os dados são independentes", async () => {
  const value = setup(); await value.preferences.saveChoice(query, album, "artist");
  const choice = await value.reload().getChoice(query, "spotify");
  assert.equal(choice.artist.id, "artist"); assert.equal(choice.album, undefined);
  choice.artist.name = "alterado";
  assert.equal((await value.preferences.getChoice(query, "spotify")).artist.name, "Shaman");
});
test("álbum explicitamente lembrado dispensa nova chamada após reabrir a extensão", async () => {
  const value = setup(); await value.preferences.saveChoice(query, album, "artist", true);
  const remembered = await value.reload().getChoice(query, "spotify");
  const result = await searchAlbums({id: "spotify", search: () => {throw Error("não deve consultar");}}, query, remembered);
  assert.equal(result.reason, "remembered-album"); assert.equal(result.album.id, album.id);
});
test("exclusão esquece artista e álbum e preserva preferência e outros registros", async () => {
  const value = setup(); await value.preferences.setService("spotify");
  await value.preferences.saveChoice(query, album, "artist", true);
  await value.preferences.saveChoice({...query, title: "Outro"}, album, "artist");
  await value.preferences.deleteChoice((await value.preferences.getChoice(query, "spotify")).key);
  assert.equal(await value.preferences.getChoice(query, "spotify"), undefined);
  assert.equal((await value.reload().listChoices()).length, 1);
  assert.equal(await value.preferences.getService(), "spotify");
});
test("operações concorrentes preservam cada escolha e a preferência", async () => {
  const value = setup(); await Promise.all([
    value.preferences.setService("deezer"), value.preferences.saveChoice(query, album, "artist"),
    value.preferences.saveChoice({...query, title: "Outro"}, album, "artist", true),
  ]); assert.equal((await value.preferences.listChoices()).length, 2); assert.equal(await value.preferences.getService(), "deezer");
});
test("trocar lembrança de álbum por artista não mantém o álbum antigo", async () => {
  const value = setup(); await value.preferences.saveChoice(query, album, "artist", true);
  await value.preferences.saveChoice(query, album, "artist", false);
  assert.equal((await value.preferences.getChoice(query, "spotify")).album, undefined);
  assert.equal((await value.preferences.listChoices()).length, 1);
});
test("serviços e itens diferentes não compartilham lembranças", async () => {
  const value = setup(); await value.preferences.saveChoice(query, album, "artist", true);
  assert.equal(await value.preferences.getChoice(query, "deezer"), undefined);
  assert.equal(await value.preferences.getChoice({...query, title: "Outro"}, "spotify"), undefined);
});
test("falha de gravação é informada e não impede tentativas posteriores", async () => {
  const value = setup(); value.fail(); await assert.rejects(value.preferences.setService("spotify"), /quota/);
  await value.preferences.saveChoice(query, album, "artist"); assert.equal((await value.preferences.listChoices()).length, 1);
});
test("dados inválidos não são usados e versão desconhecida não é sobrescrita", async () => {
  const value = setup(); value.corrupt({version: 1, choices: [{key: "bad", artist: null}]});
  assert.deepEqual(await value.preferences.listChoices(), []);
  value.corrupt({version: 99, choices: []}); await assert.rejects(value.preferences.setService("spotify"));
});

test("lembrança de item sem artista sobrevive à reabertura com o artista vindo do Spotify", async () => {
  const value = setup(); const blank = {...query, artist: ""};
  await value.preferences.saveChoice(blank, album, "artist", true);
  const saved = await value.reload().getChoice(blank, "spotify");
  assert.equal(saved.artist.name, "Shaman");
  assert.equal(saved.query.artist, "");
  assert.equal(saved.album.id, album.id);
});
