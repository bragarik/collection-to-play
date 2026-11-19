import test from "node:test";
import assert from "node:assert/strict";
import {LibibEditClient, LibibEditError} from "../src/libib/libib-edit.ts";
import {createLibibEditDiagnostics} from "../src/libib/libib-edit-diagnostics.ts";
import {sanitizeLibibEditDiagnostic, sanitizeLibibDiagnosticEvent} from "../src/libib/libib-diagnostics.ts";
import {LibibDiagnosticsStore} from "../src/libib/libib-diagnostic-store.ts";
import {libibDiagnosticSummary} from "../src/libib/libib-diagnostic-ui.ts";

const version = "0.2.16";
const at = "2026-11-14T15:00:00.000Z";
const target = {joinId: "101", libraryId: "202"};
const healthy = {page: "ready", collection: {containerFound: true, musicItems: 1, itemsWithTitleElement: 1}};
const snapshot = {outcome: "success", item: {title: "private-title", title_override: "private-order", creators: ["private-artist"]}, input_fields: {title: "private-html", creators: "private-html"}};
function environment(editor = "quick") {
  let data, fail = false, writes = 0;
  const pending = [];
  const storage = {load: async () => structuredClone(data), save: async value => {
    if (fail) throw Error("private-storage-error");
    data = structuredClone(value); writes++;
  }};
  const store = new LibibDiagnosticsStore(storage, version, () => new Date(at));
  const reporter = createLibibEditDiagnostics(editor, event => {
    const task = store.recordEdit(event); pending.push(task); return task;
  });
  return {store, reporter, storage, get data() {return structuredClone(data);}, set data(value) {data = value;},
    set fail(value) {fail = value;}, get writes() {return writes;},
    async flush() {await Promise.allSettled(pending);},
  };
}
const readClient = fetcher => new LibibEditClient({pageUrl: () => "https://www.libib.com/library", fetch: fetcher, timeoutMs: 5});

test("consulta validada registra sucesso sem conteúdo privado nem confirmação de gravação", async () => {
  const env = environment();
  const client = readClient(async () => Response.json(snapshot));
  assert.equal((await env.reporter.read(() => client.load(target))).title, "private-title");
  await env.flush();
  assert.deepEqual(env.data.report.events, [{at, operation: "update-item", code: "read-confirmed", editor: "quick", stage: "load", extensionVersion: version}]);
  assert.equal(JSON.stringify(env.data).includes("private-"), false);
  assert.equal(env.data.latest.checks.every(check => check.state === "unverified"), true);
});

test("registra falhas reais de consulta HTTP, rede, JSON e esquema sem guardar a resposta", async () => {
  for (const [fetcher, code, errorCode, status] of [
    [async () => new Response("private-body", {status: 503}), "request-failed", "http", 503],
    [async () => {throw Error("private-network");}, "request-failed", "network", undefined],
    [async () => new Response("<html>private-login</html>"), "response-invalid", "invalid-response", 200],
    [async () => Response.json({outcome: "success", item: "private-invalid"}), "response-invalid", "invalid-response", undefined],
    [async () => Response.json({outcome: "error", info: "private-info"}), "request-failed", "rejected", 200],
  ]) {
    const env = environment(), client = readClient(fetcher);
    await assert.rejects(env.reporter.read(() => client.load(target)), LibibEditError);
    await env.flush();
    const event = env.data.report.events.at(-1);
    assert.equal(event.code, code); assert.equal(event.errorCode, errorCode); assert.equal(event.httpStatus, status);
    assert.equal(JSON.stringify(env.data).includes("private-"), false);
  }
});

test("timeout de leitura é falha e cancelamento anterior ao envio é bloqueio, sem escrita", async () => {
  const env = environment();
  const client = readClient(async (_url, options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(Error("aborted")))));
  await assert.rejects(env.reporter.read(() => client.load(target)), error => error.code === "timeout");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(env.reporter.read(() => client.load(target, controller.signal)), error => error.code === "cancelled");
  await env.flush();
  assert.deepEqual(env.data.report.events.map(event => [event.code, event.errorCode]), [["request-failed", "timeout"], ["edit-blocked", "cancelled"]]);
});

test("gravação parcial mantém sucesso do título e falha dos artistas em eventos separados", async () => {
  const env = environment(); await env.store.record(healthy); const before = env.data.latest;
  env.reporter.native("title", {confirmed: true, writeMayHaveOccurred: true, httpStatus: 200});
  env.reporter.native("creators", {confirmed: false, writeMayHaveOccurred: true, code: "http", httpStatus: 500});
  await env.flush();
  const events = env.data.report.events.slice(-2);
  assert.deepEqual(events.map(event => [event.stage, event.code, event.httpStatus]), [["title", "save-confirmed", 200], ["creators", "save-unconfirmed", 500]]);
  assert.deepEqual(env.data.latest, before);
  assert.equal(libibDiagnosticSummary(env.data, version).tone, "warning");
});

test("gravações não confirmadas distinguem erro, rejeição, timeout e cancelamento", async () => {
  const env = environment();
  for (const code of ["invalid-response", "rejected", "timeout", "cancelled", "network"])
    env.reporter.native("title", {confirmed: false, writeMayHaveOccurred: true, code});
  env.reporter.native("title", {confirmed: false, writeMayHaveOccurred: false, code: "invalid-context"});
  await env.flush();
  assert.deepEqual(env.data.report.events.map(event => event.code), [...Array(5).fill("save-unconfirmed"), "edit-blocked"]);
  assert.equal(libibDiagnosticSummary(env.data, version).tone, "warning", "bloquear nova tentativa não apaga falha anterior");
});

test("edição completa registra preenchimento sem alegar Save e preserva falha anterior da edição rápida", async () => {
  const env = environment("full");
  await env.store.recordEdit({editor: "quick", stage: "title", code: "save-unconfirmed", errorCode: "timeout"});
  let fills = 0; env.reporter.fill(() => {fills++;}); await env.flush();
  assert.equal(fills, 1);
  assert.equal(env.data.report.events.at(-1).code, "fields-filled");
  assert.equal(env.data.report.events.some(event => event.code === "save-confirmed"), false);
  assert.equal(libibDiagnosticSummary(env.data, version).tone, "warning");
  const error = Error("private-context");
  assert.throws(() => env.reporter.fill(() => {throw error;}), value => value === error);
  await env.flush(); assert.equal(env.data.report.events.at(-1).code, "edit-blocked");
  assert.equal(JSON.stringify(env.data).includes("private-"), false);
});

test("diagnóstico indisponível não bloqueia leitura, preenchimento ou resultado nativo", async () => {
  for (const send of [() => {throw Error("storage");}, async () => {throw Error("storage");}, () => new Promise(() => {})]) {
    const quick = createLibibEditDiagnostics("quick", send);
    assert.equal(await quick.read(async () => 42), 42);
    assert.doesNotThrow(() => quick.native("title", {confirmed: true, writeMayHaveOccurred: true}));
    assert.doesNotThrow(() => createLibibEditDiagnostics("full", send).fill(() => {}));
    const error = new LibibEditError("http", "load", false, 403);
    await assert.rejects(quick.read(async () => {throw error;}), value => value === error);
  }
});

test("armazenamento ignora dados arbitrários e controla data e versão dos eventos", async () => {
  const env = environment();
  await env.store.recordEdit({editor: "quick", stage: "title", code: "save-confirmed", httpStatus: 200,
    at: "private-date", extensionVersion: "private-version", title: "private-title", creators: "private-artist", joinId: "private-item", url: "private-url", body: "private-body", error: "private-error", headers: {Cookie: "private-cookie"}});
  assert.equal(JSON.stringify(env.data).includes("private-"), false);
  assert.equal(env.data.report.events[0].at, at);
  assert.equal(env.data.report.events[0].extensionVersion, version);
  assert.deepEqual(await env.store.read(), env.data);
});

test("rejeita combinações impossíveis antes de persistir e mantém compatibilidade dos eventos antigos", async () => {
  const env = environment();
  for (const event of [null, {}, {editor: "full", stage: "fill", code: "save-confirmed"},
    {editor: "quick", stage: "load", code: "save-confirmed"}, {editor: "quick", stage: "fill", code: "fields-filled"},
    {editor: "quick", stage: "title", code: "save-confirmed", httpStatus: 500},
    {editor: "full", stage: "fill", code: "fields-filled", httpStatus: 200},
    {editor: "quick", stage: "title", code: "save-confirmed", errorCode: "http"},
    {editor: "quick", stage: "title", code: "save-unconfirmed", errorCode: "private-message"},
  ]) {
    assert.equal(sanitizeLibibEditDiagnostic(event), undefined);
    await assert.rejects(env.store.recordEdit(event), TypeError);
  }
  assert.equal(env.writes, 0);
  assert.deepEqual(sanitizeLibibDiagnosticEvent({at, operation: "update-item", code: "save-confirmed"}), {at, operation: "update-item", code: "save-confirmed"});
});

test("serializa resultados junto às observações, limita histórico e recupera falhas de armazenamento", async () => {
  const env = environment(); env.fail = true;
  await assert.rejects(env.store.recordEdit({editor: "quick", stage: "title", code: "save-confirmed"}));
  env.fail = false;
  await Promise.all([env.store.record(healthy), ...Array.from({length: 110}, () => env.store.recordEdit({editor: "quick", stage: "title", code: "save-confirmed"}))]);
  assert.equal(env.data.report.events.length, 100);
  assert.equal(env.data.latest.checks[0].state, "recognized");
  assert.equal((await env.store.read()).report.events.length, 100);
});

test("resultado de edição preserva formatos futuros e snapshots inválidos", async () => {
  const env = environment();
  for (const data of [{format: "future", schemaVersion: 2}, {format: "collection-to-play-libib-state", schemaVersion: 1, latest: {}, report: {}}]) {
    env.data = data;
    await assert.rejects(env.store.recordEdit({editor: "quick", stage: "title", code: "save-confirmed"}), TypeError);
    assert.deepEqual(env.data, data);
  }
  assert.equal(env.writes, 0);
});

test("sucesso posterior resolve aviso somente da mesma etapa e versão", async () => {
  const env = environment(); await env.store.record(healthy);
  await env.store.recordEdit({editor: "quick", stage: "load", code: "response-invalid", errorCode: "invalid-response"});
  await env.store.recordEdit({editor: "quick", stage: "creators", code: "save-unconfirmed", errorCode: "timeout"});
  await env.store.recordEdit({editor: "quick", stage: "title", code: "save-confirmed"});
  assert.equal(libibDiagnosticSummary(env.data, version).tone, "warning");
  await env.store.recordEdit({editor: "quick", stage: "creators", code: "save-confirmed"});
  assert.equal(libibDiagnosticSummary(env.data, version).tone, "warning");
  await env.store.recordEdit({editor: "quick", stage: "load", code: "read-confirmed"});
  assert.equal(libibDiagnosticSummary(env.data, version).tone, "neutral");
  assert.equal(libibDiagnosticSummary(env.data, "0.3.0").tone, "neutral");
  const old = env.data; env.data = {...old, latest: {...old.latest, extensionVersion: "0.1.0"}};
  await env.store.recordEdit({editor: "quick", stage: "title", code: "save-unconfirmed", errorCode: "http", httpStatus: 500});
  assert.equal(libibDiagnosticSummary(env.data, version).tone, "warning", "falha atual aparece mesmo antes de nova observação estrutural");
});

test("preenchimento assíncrono só é confirmado depois de validar e atribuir o arquivo", async () => {
  const env=environment("full");let finish;const pending=env.reporter.fillAsync(()=>new Promise(resolve=>{finish=resolve;}));
  await env.flush();assert.equal(env.data,undefined);finish();await pending;await env.flush();
  assert.equal(env.data.report.events.at(-1).code,"fields-filled");
});
test("falha de validação assíncrona não registra preenchimento nem gravação", async () => {
  const env=environment("full"),error=Error("private-image-error");
  await assert.rejects(env.reporter.fillAsync(async()=>{throw error;}),value=>value===error);await env.flush();
  assert.equal(env.data.report.events.at(-1).code,"edit-blocked");assert.equal(JSON.stringify(env.data).includes("private-"),false);
});

test("diagnóstico confirma capa separadamente e recupera aviso após nova confirmação",async()=>{
 const env=environment();await env.store.record(healthy);
 env.reporter.native("image",{confirmed:false,writeMayHaveOccurred:true,code:"http",httpStatus:500});await env.flush();
 assert.equal(env.data.report.events.at(-1).stage,"image");assert.equal(libibDiagnosticSummary(env.data,version).tone,"warning");
 env.reporter.native("image",{confirmed:true,writeMayHaveOccurred:true,httpStatus:200});await env.flush();
 assert.equal(env.data.report.events.at(-1).code,"save-confirmed");assert.equal(libibDiagnosticSummary(env.data,version).tone,"neutral");
});
test('diagnóstico de extras confirma ou sinaliza incerteza sem registrar valores dos campos',async()=>{
 const env=environment();
 env.reporter.native('extra',{confirmed:false,writeMayHaveOccurred:true,code:'network',value:'private-notes'});await env.flush();
 assert.equal(env.data.report.events.at(-1).stage,'extra');assert.equal(env.data.report.events.at(-1).code,'save-unconfirmed');
 assert.equal(JSON.stringify(env.data).includes('private-notes'),false);
 env.reporter.native('extra',{confirmed:true,writeMayHaveOccurred:true,httpStatus:200});await env.flush();
 assert.equal(env.data.report.events.at(-1).code,'save-confirmed');
});
