import test from "node:test";
import assert from "node:assert/strict";
import {assessLibibCompatibility, sanitizeLibibDiagnosticEvent, appendLibibDiagnostic, LIBIB_DIAGNOSTIC_LIMIT} from "../dist/libib-diagnostics.js";

const ready = {page: "ready", collection: {containerFound: true, musicItems: 2, itemsWithTitleElement: 2}};
const event = {at: "2026-11-13T18:00:00.000Z", operation: "update-item", code: "request-failed", extensionVersion: "0.2.3", httpStatus: 403, responseFormat: "html"};
const check = (value, operation) => assessLibibCompatibility(value).find(item => item.operation === operation);

test("carregamento e contexto externo não são classificados como quebra", () => {
  assert.ok(assessLibibCompatibility({...ready, page: "loading"}).every(item => item.state === "unverified"));
  assert.ok(assessLibibCompatibility({...ready, page: "outside-library"}).every(item => item.state === "not-applicable"));
});
test("coleção vazia, sem música ou ainda não observada não garante compatibilidade nem quebra", () => {
  for (const observation of [{page: "ready"}, {...ready, collection: {containerFound: false, musicItems: 0, itemsWithTitleElement: 0}}, {...ready, collection: {containerFound: true, musicItems: 0, itemsWithTitleElement: 0}}]) {
    assert.equal(check(observation, "read-collection").state, "unverified");
  }
});
test("ausência do elemento de título em itens musicais sinaliza mudança na leitura", () => {
  assert.deepEqual(check({...ready, collection: {...ready.collection, itemsWithTitleElement: 1}}, "read-collection"), {
    operation: "read-collection", state: "changed", reason: "title-element-missing",
  });
});
test("reconhecer a coleção não declara compatibilidade da edição", () => {
  assert.equal(check(ready, "read-collection").state, "recognized");
  assert.equal(check(ready, "update-item").state, "unverified");
});
test("artista sem dados e versão de CSS não determinam compatibilidade da estrutura", () => {
  const value = {...ready, artist: "", assetVersion: "changed-css-version"};
  assert.equal(check(value, "read-collection").state, "recognized");
});
test("contagens incoerentes permanecem sem verificação", () => {
  for (const [musicItems, itemsWithTitleElement] of [[-1, 0], [1, 2], [NaN, 0], [Infinity, 0], [1.5, 1], [100001, 0]]) {
    assert.equal(check({...ready, collection: {containerFound: true, musicItems, itemsWithTitleElement}}, "read-collection").reason, "invalid-observation");
  }
});
test("detalhes de outra mídia são não aplicáveis e título ausente sinaliza mudança", () => {
  assert.equal(check({...ready, details: {music: false, titleElementFound: false}}, "read-details").state, "not-applicable");
  assert.equal(check({...ready, details: {music: true, titleElementFound: false}}, "read-details").state, "changed");
});
test("edição musical exige elementos de título, criadores e salvar", () => {
  const editor = {music: true, titleFieldFound: true, creatorFieldFound: true, saveActionFound: true};
  assert.equal(check({...ready, editor}, "update-item").state, "recognized");
  for (const key of ["titleFieldFound", "creatorFieldFound", "saveActionFound"]) {
    assert.equal(check({...ready, editor: {...editor, [key]: false}}, "update-item").reason, "editor-fields-missing");
  }
  assert.equal(check({...ready, editor: {...editor, music: false}}, "update-item").state, "not-applicable");
});
test("somente metadados controlados entram no log, sem corpos, tokens ou URLs", () => {
  const clean = sanitizeLibibDiagnosticEvent({...event, body: {token: "private-body"}, cookie: "private-cookie", url: "https://example.com?token=private-url", message: "private-message", headers: {Authorization: "private-header"}});
  assert.deepEqual(clean, event);
  assert.equal(JSON.stringify(clean).includes("private-"), false);
  assert.deepEqual(sanitizeLibibDiagnosticEvent({...event, reason: "editor-fields-missing"}), {...event, reason: "editor-fields-missing"});
});
test("campos opcionais inválidos ou texto arbitrário não entram no diagnóstico", () => {
  const clean = sanitizeLibibDiagnosticEvent({...event, extensionVersion: "Bearer private-version", httpStatus: 999, responseFormat: "private-format", reason: "private-reason"});
  assert.deepEqual(clean, {at: event.at, operation: event.operation, code: event.code});
});
test("códigos desconhecidos, datas inválidas e confirmação de gravação em leitura são recusados", () => {
  for (const value of [null, {}, {...event, at: "private-date"}, {...event, at: "2026-99-99T00:00:00.000Z"}, {...event, at: "2026-02-31T00:00:00.000Z"}, {...event, operation: "unknown"}, {...event, code: "unknown"}, {...event, operation: "read-collection", code: "save-confirmed"}]) {
    assert.equal(sanitizeLibibDiagnosticEvent(value), undefined);
  }
});
test("histórico é limitado, acumulado e não modifica objetos anteriores", () => {
  let report;
  for (let index = 0; index < LIBIB_DIAGNOSTIC_LIMIT + 5; index++) report = appendLibibDiagnostic(report, {...event, at: new Date(Date.parse(event.at) + index * 1000).toISOString()});
  assert.equal(report.events.length, LIBIB_DIAGNOSTIC_LIMIT);
  assert.equal(report.events[0].at, "2026-11-13T18:00:05.000Z");
  const before = structuredClone(report);
  const next = appendLibibDiagnostic(report, {...event, code: "save-confirmed", httpStatus: 200});
  assert.deepEqual(report, before);
  assert.equal(next.events.at(-1).code, "save-confirmed");
  assert.notEqual(next.events[0], report.events[1]);
});
test("versão futura ou formato desconhecido do histórico é preservado por rejeição", () => {
  for (const report of [{format: "collection-to-play-libib", schemaVersion: 2, events: []}, {format: "unknown", schemaVersion: 1, events: []}]) {
    const before = structuredClone(report);
    assert.throws(() => appendLibibDiagnostic(report, event), TypeError);
    assert.deepEqual(report, before);
  }
  assert.throws(() => appendLibibDiagnostic(undefined, {code: "unknown"}), TypeError);
});
test("releitura sanitiza eventos antigos e descarta entradas inválidas", () => {
  const report = {format: "collection-to-play-libib", schemaVersion: 1, events: [{...event, body: "private-old-body"}, {code: "unknown"}]};
  const clean = appendLibibDiagnostic(report, {...event, code: "response-invalid"});
  assert.equal(clean.events.length, 2);
  assert.equal(JSON.stringify(clean).includes("private-old-body"), false);
});

test("resumo distingue ausência de dados, estrutura reconhecida e alteração provável", async () => {
  const {libibDiagnosticSummary} = await import("../dist/libib-diagnostic-ui.js");
  const state = {latest: {extensionVersion: "0.2.5", checks: assessLibibCompatibility(ready)}};
  assert.equal(libibDiagnosticSummary(undefined, "0.2.5").tone, "neutral");
  assert.match(libibDiagnosticSummary(state, "0.2.5").message, /áreas verificadas/);
  const changed = {latest: {...state.latest, checks: assessLibibCompatibility({...ready, collection: {...ready.collection, itemsWithTitleElement: 0}})}};
  assert.equal(libibDiagnosticSummary(changed, "0.2.5").tone, "warning");
  assert.match(libibDiagnosticSummary(changed, "0.2.5").message, /Possível mudança/);
});

test("informação insuficiente e diagnóstico de outra versão não confirmam incompatibilidade", async () => {
  const {libibDiagnosticSummary} = await import("../dist/libib-diagnostic-ui.js");
  const empty = {latest: {extensionVersion: "0.2.5", checks: assessLibibCompatibility({page: "ready"})}};
  assert.equal(libibDiagnosticSummary(empty, "0.2.5").tone, "neutral");
  assert.match(libibDiagnosticSummary(empty, "0.2.5").message, /informação suficiente/);
  const old = {latest: {extensionVersion: "0.2.4", checks: [{state: "changed"}]}};
  assert.equal(libibDiagnosticSummary(old, "0.2.5").tone, "neutral");
  assert.match(libibDiagnosticSummary(old, "0.2.5").message, /outra versão/);
});
