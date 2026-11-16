import test from "node:test";
import assert from "node:assert/strict";
import {YouTubeMusicClient} from "../src/streamings/youtube-music.ts";
import {DeezerClient} from "../src/streamings/deezer.ts";
import {ItunesClient} from "../src/streamings/itunes.ts";
import {SpotifyClient} from "../src/streamings/spotify.ts";
import {browserErrorDetails} from "../src/streamings/request-diagnostics.ts";

const query = {title: "Example", artist: "Artist", source: {catalogId: "preview", itemUrl: "https://www.libib.com/library"}};
const factories = {
  Deezer: fetcher => {const client = new DeezerClient(fetcher); return (signal, collect) => client.search(query, signal, undefined, collect);},
  "YouTube Music": fetcher => {const client = new YouTubeMusicClient(fetcher); return (signal, collect) => client.search(query, signal, undefined, collect);},
  iTunes: fetcher => {const client = new ItunesClient(fetcher); return (signal, collect) => client.search(query, signal, collect);},
  Spotify: fetcher => {
    const client = new SpotifyClient({clientId: "public-id", redirectUrl: "https://example.chromiumapp.org/spotify", fetch: fetcher,
      launchAuth: async () => undefined, store: {load: async () => ({accessToken: "private-access", refreshToken: "private-refresh", expiresAt: Date.now() + 3600000}), save: async () => {}, clear: async () => {}}});
    return (signal, collect) => client.search(query, signal, undefined, collect);
  },
};
for (const [service, create] of Object.entries(factories)) {
  test(`${service}: falha sem HTTP registra tempo, etapa e código seguro da causa`, async () => {
    const events = [];
    const failure = new TypeError("Failed to fetch", {cause: Object.assign(new Error("private-secret https://example.com/?token=private-token"), {code: "ENOTFOUND", stack: "private-stack"})});
    await assert.rejects(create(async () => {throw failure;})(undefined, event => events.push(event)), {code: "network"});
    const event = events.find(event => event.kind === "failure");
    assert.equal(event.code, "network"); assert.equal(event.phase, "request");
    assert.equal(event.hasHttpResponse, false); assert.equal(event.status, undefined);
    assert.equal(event.aborted, false); assert.equal(event.callerAborted, false);
    assert.equal(event.timeoutMs, 20000); assert.ok(event.durationMs >= 0); assert.ok(Number.isFinite(Date.parse(event.at)));
    assert.deepEqual(event.browserError, {name: "TypeError", message: "Failed to fetch", cause: {name: "Error", code: "ENOTFOUND"}});
    assert.doesNotMatch(JSON.stringify(events), /private-secret|private-token|private-stack|private-access|private-refresh/);
  });
  test(`${service}: timeout antes da resposta é distinguido de cancelamento`, async t => {
    const timer = new AbortController();
    t.mock.method(AbortSignal, "timeout", () => timer.signal);
    const events = [];
    await assert.rejects(create(async () => {timer.abort(new DOMException("private reason", "TimeoutError"));throw timer.signal.reason;})(undefined, event => events.push(event)), error => {
      assert.equal(error.code, "network"); assert.match(error.message, /20 segundos/); return true;
    });
    const event = events.find(event => event.kind === "failure");
    assert.equal(event.code, "timeout"); assert.equal(event.aborted, true); assert.equal(event.callerAborted, false); assert.equal(event.hasHttpResponse, false);
    assert.doesNotMatch(JSON.stringify(events), /private reason/);
  });
  test(`${service}: cancelamento registra sinal do chamador sem expor seu motivo`, async () => {
    const caller = new AbortController(), events = [];
    await assert.rejects(create(async () => {caller.abort("private reason"); throw new DOMException("private reason", "AbortError");})(caller.signal, event => events.push(event)), {code: "cancelled"});
    const event = events.find(event => event.kind === "failure");
    assert.equal(event.code, "cancelled"); assert.equal(event.callerAborted, true); assert.equal(event.aborted, true);
    assert.doesNotMatch(JSON.stringify(events), /private reason/);
  });
  test(`${service}: falha lendo corpo preserva HTTP200 e não vira erro de JSON`, async () => {
    const events = [];
    const response = new Response(null, {status: 200, headers: {"Content-Type": "application/json"}});
    response.json = async () => {throw new TypeError("Load failed");};
    await assert.rejects(create(async () => response)(undefined, event => events.push(event)), {code: "network"});
    const event = events.find(event => event.kind === "failure");
    assert.equal(event.phase, "response-body"); assert.equal(event.hasHttpResponse, true); assert.equal(event.status, 200);
    assert.ok(events.some(event => event.kind === "response" && event.status === 200));
  });
  test(`${service}: JSON inválido é separado de rede e não exporta conteúdo`, async () => {
    const events = [];
    await assert.rejects(create(async () => new Response("<html>private-body</html>"))(undefined, event => events.push(event)), {code: "invalid-response"});
    const event = events.find(event => event.kind === "failure");
    assert.equal(event.code, "invalid-response"); assert.equal(event.phase, "response-body"); assert.equal(event.status, 200);
    assert.equal(event.browserError.name, "SyntaxError");
    assert.doesNotMatch(JSON.stringify(events), /private-body/);
  });
  test(`${service}: timeout lendo corpo preserva a resposta HTTP recebida`, async t => {
    const timer = new AbortController(), events = [];
    t.mock.method(AbortSignal, "timeout", () => timer.signal);
    const response = new Response(null);
    response.json = async () => {timer.abort(new DOMException("private reason", "TimeoutError")); throw timer.signal.reason;};
    await assert.rejects(create(async () => response)(undefined, event => events.push(event)), {code: "network"});
    const event = events.find(event => event.kind === "failure");
    assert.equal(event.code, "timeout"); assert.equal(event.phase, "response-body"); assert.equal(event.status, 200); assert.equal(event.hasHttpResponse, true);
  });
}

test("detalhes técnicos limitam códigos e nomes e não seguem causas recursivas", () => {
  const cause = {name: "private-name", code: "private-code", message: "private-message"}; cause.cause = cause;
  assert.deepEqual(browserErrorDetails({name: "private-name", message: "https://example.com/?token=private", code: "private-code", cause}), {
    name: "UnknownError", cause: {name: "UnknownError"},
  });
});
