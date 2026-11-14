import test from "node:test";
import assert from "node:assert/strict";
import {LibibDiagnosticsStore} from "../dist/libib-diagnostic-store.js";
import {createLibibObservationPublisher} from "../dist/libib-observer.js";

const healthy = {page: "ready", collection: {containerFound: true, musicItems: 2, itemsWithTitleElement: 2}};
const changed = {...healthy, collection: {...healthy.collection, itemsWithTitleElement: 1}};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function setup() {
  let data, writes = 0, fail = false;
  const storage = {load: async () => structuredClone(data), save: async value => {
    if (fail) throw Error("Storage failure");
    await sleep(1); data = structuredClone(value); writes++;
  }};
  return {store: new LibibDiagnosticsStore(storage, "0.2.3"), storage,
    get data() {return structuredClone(data);}, set data(value) {data = structuredClone(value);},
    get writes() {return writes;}, set fail(value) {fail = value;}};
}
test("armazena somente avaliação calculada e registra mudanças por operação", async () => {
  const value = setup();
  assert.deepEqual(await value.store.record(healthy), {recorded: true});
  assert.equal(value.data.report.events.length, 3);
  assert.equal(value.data.latest.checks[0].state, "recognized");
  await value.store.record(changed);
  assert.equal(value.data.report.events.length, 4);
  assert.equal(value.data.report.events.at(-1).reason, "title-element-missing");
  await value.store.record(healthy);
  assert.equal(value.data.report.events.length, 5);
  assert.equal(value.data.report.events.at(-1).code, "structure-recognized");
});
test("deduplica verificações saudáveis mesmo com mudança de quantidade ou reinício do worker", async () => {
  const value = setup();
  await value.store.record(healthy);
  assert.deepEqual(await value.store.record({...healthy, collection: {...healthy.collection, musicItems: 10, itemsWithTitleElement: 10}}), {recorded: false});
  const restarted = new LibibDiagnosticsStore(value.storage, "0.2.3");
  assert.deepEqual(await restarted.record(healthy), {recorded: false});
  assert.equal(value.writes, 1);
});
test("atualizar a versão registra nova avaliação uma única vez", async () => {
  const value = setup(); await value.store.record(healthy);
  const updated = new LibibDiagnosticsStore(value.storage, "0.2.4");
  await updated.record(healthy); await updated.record(healthy);
  assert.equal(value.writes, 2);
  assert.equal(value.data.report.events.length, 6);
  assert.equal(value.data.latest.extensionVersion, "0.2.4");
});
test("campos privados e alegação de edição pelo remetente são ignorados", async () => {
  const value = setup();
  await value.store.record({...healthy, title: "private-title", url: "private-url", token: "private-token", cookie: "private-cookie", code: "save-confirmed",
    editor: {music: true, titleFieldFound: true, creatorFieldFound: true, saveActionFound: true}});
  assert.equal(JSON.stringify(value.data).includes("private-"), false);
  assert.equal(value.data.latest.checks.find(item => item.operation === "update-item").state, "unverified");
  assert.equal(value.data.report.events.some(item => item.code === "save-confirmed"), false);
});
test("rejeita observações inválidas antes de gravar", async () => {
  const value = setup();
  for (const observation of [null, {}, {...healthy, page: "outside-library"}, {...healthy, collection: {...healthy.collection, musicItems: -1}},
    {...healthy, collection: {...healthy.collection, musicItems: 100001}}, {...healthy, details: {music: "true", titleElementFound: false}}]) {
    await assert.rejects(value.store.record(observation), TypeError);
  }
  assert.equal(value.writes, 0);
});
test("serializa observações concorrentes e se recupera depois de falha de armazenamento", async () => {
  const value = setup();
  value.fail = true;
  await assert.rejects(value.store.record(healthy), /Storage failure/);
  value.fail = false;
  await Promise.all([value.store.record(healthy), value.store.record(changed)]);
  assert.equal(value.data.report.events.length, 4);
  assert.equal(value.data.latest.checks[0].state, "changed");
});
test("versões desconhecidas são preservadas e o histórico permanece limitado", async () => {
  const value = setup();
  value.data = {format: "collection-to-play-libib-state", schemaVersion: 2, report: {}};
  const before = value.data;
  await assert.rejects(value.store.record(healthy), TypeError);
  assert.deepEqual(value.data, before);
  value.data = undefined;
  for (let index = 0; index < 105; index++) await value.store.record(index % 2 ? changed : healthy);
  assert.equal(value.data.report.events.length, 100);
});
test("publicador espera estabilidade, evita repetição e descarta mudanças transitórias", async () => {
  let current = healthy; const sent = [];
  const publisher = createLibibObservationPublisher({collect: () => current, send: async value => {sent.push(value);}, settleMs: 10});
  publisher.schedule(); current = changed; publisher.schedule(); current = healthy; publisher.schedule();
  await sleep(30);
  assert.deepEqual(sent, [healthy]);
  for (let index = 0; index < 20; index++) publisher.schedule();
  await sleep(30);
  assert.equal(sent.length, 1);
  current = changed; publisher.schedule(); await sleep(30);
  assert.equal(sent.length, 2); publisher.stop();
});
test("publicador tenta novamente após erro e cancela ao sair do contexto", async () => {
  let current = healthy, calls = 0;
  const publisher = createLibibObservationPublisher({collect: () => current, send: async () => {if (++calls === 1) throw Error("offline");}, settleMs: 10});
  publisher.schedule(); await sleep(30); publisher.schedule(); await sleep(30);
  assert.equal(calls, 2);
  current = changed; publisher.schedule(); current = undefined; publisher.schedule(); await sleep(30);
  assert.equal(calls, 2); publisher.stop();
});
test("retorno a estado anterior durante envio pendente também é comunicado", async () => {
  let current = healthy, release;
  const sent = [];
  const publisher = createLibibObservationPublisher({collect: () => current, send: async value => {
    sent.push(value); if (value === changed) await new Promise(resolve => {release = resolve;});
  }, settleMs: 10});
  publisher.schedule(); await sleep(30);
  current = changed; publisher.schedule(); await sleep(30);
  current = healthy; publisher.schedule(); await sleep(30);
  release(); await sleep(10);
  assert.deepEqual(sent, [healthy, changed, healthy]); publisher.stop();
});

test("leitura espera gravações e retorna somente campos permitidos", async () => {
  const value = setup();
  const write = value.store.record(healthy);
  const read = value.store.read();
  await write;
  assert.equal((await read).latest.checks[0].state, "recognized");
  const stored = value.data;
  value.data = {...stored, token: "private-root", latest: {...stored.latest, url: "private-url", checks: stored.latest.checks.map(check => ({...check, message: "private-check"}))},
    report: {...stored.report, body: "private-body", events: stored.report.events.map(event => ({...event, headers: {Cookie: "private-cookie"}}))}};
  const sanitized = await value.store.read();
  assert.equal(JSON.stringify(sanitized).includes("private-"), false);
  assert.equal(JSON.stringify(value.data).includes("private-"), true);
});

test("leitura recusa formatos futuros e snapshots incoerentes sem gravar", async () => {
  const value = setup(); await value.store.record(healthy);
  const original = value.data;
  for (const modified of [
    {...original, schemaVersion: 2},
    {...original, latest: {...original.latest, at: "invalid"}},
    {...original, latest: {...original.latest, checks: [original.latest.checks[0], original.latest.checks[0], original.latest.checks[2]]}},
    {...original, latest: {...original.latest, checks: original.latest.checks.map(check => ({...check, state: "recognized", reason: "not-observed"}))}},
    {...original, latest: {...original.latest, checks: original.latest.checks.map((check, index) => index === 0 ? {...check, state: "changed", reason: "editor-fields-missing"} : check)}},
  ]) {
    value.data = modified;
    const before = value.data;
    await assert.rejects(value.store.read(), TypeError);
    assert.deepEqual(value.data, before);
  }
  assert.equal(value.writes, 1);
});

test("leitura sem observações retorna vazio sem fabricar compatibilidade", async () => {
  const value = setup();
  assert.equal(await value.store.read(), undefined);
  assert.equal(value.writes, 0);
});
