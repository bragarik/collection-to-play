import test from "node:test";
import assert from "node:assert/strict";
import {LibibEditClient, LibibEditError} from "../dist/libib-edit.js";

const target = {joinId: "101", libraryId: "202"};
const libraryUrl = "https://www.libib.com/library";
const success = () => Response.json({outcome: "success", info: "Mensagem localizada"});
const loaded = () => ({
  outcome: "success",
  input_fields: {title: '<input name="title"><input name="title_override">', creators: '<input name="creators">'},
  item: {title: "Original", title_override: "Ordenação personalizada", creators: ["Artista"], notes: "private-notes"},
  list: "<script>private-html</script>",
});
function setup(responses = []) {
  const requests = [];
  let page = libraryUrl;
  const client = new LibibEditClient({pageUrl: () => page, fetch: async (url, init) => {
    requests.push({url, init});
    const next = responses.shift();
    assert.ok(next, "Unexpected request");
    return typeof next === "function" ? next(url, init) : next;
  }});
  return {client, requests, set page(value) {page = value;}};
}
const failure = (code, operation, writeMayHaveOccurred) => error => {
  assert.ok(error instanceof LibibEditError);
  assert.equal(error.code, code);
  assert.equal(error.operation, operation);
  assert.equal(error.writeMayHaveOccurred, writeMayHaveOccurred);
  assert.equal(JSON.stringify(error).includes("private-"), false);
  return true;
};

test("carrega os três valores juntos sem devolver HTML ou metadados privados", async () => {
  const data = loaded();
  const value = setup([Response.json(data)]);
  const result = await value.client.load(target);
  assert.deepEqual(result, {target, title: "Original", titleOverride: "Ordenação personalizada", creators: ["Artista"]});
  assert.notEqual(result.target, target);
  const {url, init} = value.requests[0];
  assert.equal(url, "https://www.libib.com/quickedit/load-fields/101");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "include");
  assert.equal(init.redirect, "error");
  assert.equal(init.headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded; charset=UTF-8");
  assert.equal(init.body.toString(), "item_type=music");
  assert.equal(JSON.stringify(result).includes("private-"), false);
});

test("título relê e preserva override atual, usa FormData sem boundary fixo e confirma só esse campo", async () => {
  const value = setup([Response.json(loaded()), success()]);
  assert.deepEqual(await value.client.saveTitle(target, "Novo álbum"), {target, field: "title", confirmed: true});
  assert.equal(value.requests.length, 2);
  const {url, init} = value.requests[1];
  assert.equal(url, "https://www.libib.com/quickedit/update-field/submit");
  assert.equal(init.headers["Content-Type"], undefined);
  assert.equal(init.credentials, "include");
  assert.ok(init.body instanceof FormData);
  assert.deepEqual(Object.fromEntries(init.body), {
    join_id: "101", library_id: "202", item_type: "music", title: "Novo álbum", title_override: "Ordenação personalizada",
  });
});

test("mantém override vazio explicitamente no payload", async () => {
  const data = loaded(); data.item.title_override = "";
  const value = setup([Response.json(data), success()]);
  await value.client.saveTitle(target, "Novo");
  assert.equal(value.requests[1].init.body.get("title_override"), "");
});

test("criadores envia exatamente o texto nativo, separado do título", async () => {
  const value = setup([success()]);
  const text = 'Artista A, Gabriel "Garcia Marquez"';
  assert.deepEqual(await value.client.saveCreators(target, text), {target, field: "creators", confirmed: true});
  assert.deepEqual(Object.fromEntries(value.requests[0].init.body), {
    join_id: "101", library_id: "202", item_type: "music", creators: text,
  });
});

test("recusa IDs inválidos sem requisição, sem converter números ou aceitar paths", async () => {
  const value = setup();
  for (const id of ["", "../1", "1?x=2", "0", "01", 101, "1".repeat(21), null]) {
    for (const candidate of [{...target, joinId: id}, {...target, libraryId: id}]) {
      await assert.rejects(value.client.load(candidate), failure("invalid-input", "load", false));
      await assert.rejects(value.client.saveTitle(candidate, "Novo"), failure("invalid-input", "title", false));
      await assert.rejects(value.client.saveCreators(candidate, "Artista"), failure("invalid-input", "creators", false));
    }
  }
  await assert.rejects(value.client.load(null), failure("invalid-input", "load", false));
  assert.equal(value.requests.length, 0);
});

test("valida novos valores antes de ler ou salvar", async () => {
  const value = setup();
  for (const title of ["", "  ", "a".repeat(513), undefined, []]) {
    await assert.rejects(value.client.saveTitle(target, title), failure("invalid-input", "title", false));
  }
  for (const creators of ["", "  ", ["Artista"], null]) {
    await assert.rejects(value.client.saveCreators(target, creators), failure("invalid-input", "creators", false));
  }
  assert.equal(value.requests.length, 0);
});

test("recusa contextos fora da biblioteca antes de qualquer chamada", async () => {
  const value = setup();
  for (const page of ["https://www.libib.com/login", "http://www.libib.com/library", "https://libib.com/library", "https://evil.test/library", "https://www.libib.com/library-other"]) {
    value.page = page;
    await assert.rejects(value.client.load(target), failure("invalid-context", "load", false));
    await assert.rejects(value.client.saveCreators(target, "Artista"), failure("invalid-context", "creators", false));
  }
  assert.equal(value.requests.length, 0);
});

test("mudança de contexto após leitura impede POST de título", async () => {
  const value = setup([() => {value.page = "https://www.libib.com/login"; return Response.json(loaded());}]);
  await assert.rejects(value.client.saveTitle(target, "Novo"), failure("invalid-context", "title", false));
  assert.equal(value.requests.length, 1);
});

test("copia IDs antes de aguardar leitura para evitar alteração do destino pelo chamador", async () => {
  const mutableTarget = {...target};
  const value = setup([() => {mutableTarget.joinId = "999"; return Response.json(loaded());}, success()]);
  const result = await value.client.saveTitle(mutableTarget, "Novo");
  assert.equal(result.target.joinId, "101");
  assert.equal(value.requests[1].init.body.get("join_id"), "101");
});

test("dados incompletos não permitem gravar sem conhecer a ordenação", async () => {
  for (const mutate of [
    d => delete d.item.title_override,
    d => {d.item.title_override = null;},
    d => {d.item.title_override = "a".repeat(513);},
    d => {d.item.creators = "Artista";},
    d => {d.item.creators = null;},
    d => delete d.item.creators,
    d => {d.item.creators = [123];},
    d => delete d.input_fields,
    d => delete d.input_fields.creators,
    d => {d.item.title = "";},
  ]) {
    const data = loaded(); mutate(data);
    const value = setup([Response.json(data)]);
    await assert.rejects(value.client.saveTitle(target, "Novo"), failure("invalid-response", "load", false));
    assert.equal(value.requests.length, 1);
  }
});

test("leitura aceita criadores vazios e não depende de outros metadados", async () => {
  const data = loaded(); data.item.creators = [];
  const value = setup([Response.json(data)]);
  assert.deepEqual((await value.client.load(target)).creators, []);
});

test("artista ausente como texto vazio permite carregar álbum e salvar os novos metadados", async () => {
  const data = loaded(); data.item.title = "Siderado"; data.item.creators = "";
  const value = setup([Response.json(data), Response.json(data), success(), success()]);
  const snapshot = await value.client.load(target);
  assert.equal(snapshot.title, "Siderado");
  assert.deepEqual(snapshot.creators, []);
  assert.equal((await value.client.saveTitle(target, "Siderado")).confirmed, true);
  assert.equal((await value.client.saveCreators(target, "Skank")).confirmed, true);
  assert.equal(value.requests[2].init.body.get("title_override"), "Ordenação personalizada");
  assert.equal(value.requests[3].init.body.get("creators"), "Skank");
});

test("HTTP 200 com outcome de erro não é sucesso e não é repetido", async () => {
  const value = setup([Response.json({outcome: "error", info: "private-server-text"})]);
  await assert.rejects(value.client.saveCreators(target, "Artista"), failure("rejected", "creators", true));
  assert.equal(value.requests.length, 1);
});

test("HTML de login, JSON inválido e sucesso sem contrato não confirmam gravação", async () => {
  for (const response of [new Response("<html>private-login</html>"), new Response("{"), Response.json({}), Response.json(null), Response.json({outcome: true})]) {
    const value = setup([response]);
    await assert.rejects(value.client.saveCreators(target, "Artista"), failure("invalid-response", "creators", true));
  }
});

test("HTTP de erro conserva status e não expõe corpo", async () => {
  const value = setup([new Response("private-body", {status: 403})]);
  await assert.rejects(value.client.saveCreators(target, "Artista"), error => {
    failure("http", "creators", true)(error);
    assert.equal(error.httpStatus, 403); return true;
  });
});

test("falha de rede ou redirecionamento não é repetido e pode ter gravado", async () => {
  const value = setup([() => {throw new TypeError("private-network");}]);
  await assert.rejects(value.client.saveCreators(target, "Artista"), failure("network", "creators", true));
  assert.equal(value.requests.length, 1);
});

test("falha de leitura não faz POST de gravação", async () => {
  const value = setup([() => {throw new TypeError("private-network");}]);
  await assert.rejects(value.client.saveTitle(target, "Novo"), failure("network", "load", false));
  assert.equal(value.requests.length, 1);
});

test("confirmação do título não encobre falha posterior dos criadores", async () => {
  const value = setup([Response.json(loaded()), success(), Response.json({outcome: "error"})]);
  const title = await value.client.saveTitle(target, "Novo");
  await assert.rejects(value.client.saveCreators(target, "Artista"), failure("rejected", "creators", true));
  assert.equal(title.field, "title");
  assert.equal(title.confirmed, true);
  assert.equal(value.requests.length, 3);
});

test("cancelamento prévio impede leitura e escrita", async () => {
  const value = setup(); const controller = new AbortController(); controller.abort();
  await assert.rejects(value.client.load(target, controller.signal), failure("cancelled", "load", false));
  await assert.rejects(value.client.saveCreators(target, "Artista", controller.signal), failure("cancelled", "creators", false));
  assert.equal(value.requests.length, 0);
});

test("cancelamento entre leitura e escrita não deixa gravar", async () => {
  const controller = new AbortController();
  const data = loaded();
  const response = Response.json(data);
  const json = response.json.bind(response);
  response.json = async () => {const result = await json(); queueMicrotask(() => controller.abort()); return result;};
  const value = setup([response]);
  await assert.rejects(value.client.saveTitle(target, "Novo", controller.signal), error => {
    assert.equal(error.code, "cancelled"); assert.equal(error.writeMayHaveOccurred, false); return true;
  });
  assert.equal(value.requests.length, 1);
});

test("cancelamento após enviar é incerto, sem repetir a gravação", async () => {
  const controller = new AbortController();
  const value = setup([(_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("private-cancel", "AbortError")), {once: true});
    controller.abort();
  })]);
  await assert.rejects(value.client.saveCreators(target, "Artista", controller.signal), failure("cancelled", "creators", true));
  assert.equal(value.requests.length, 1);
});

test("timeout limita espera e registra incerteza após envio", async () => {
  const client = new LibibEditClient({pageUrl: () => libraryUrl, timeoutMs: 5,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once: true});
    }),
  });
  await assert.rejects(client.saveCreators(target, "Artista"), failure("timeout", "creators", true));
});

test("timeout também cobre leitura do corpo da resposta", async () => {
  const client = new LibibEditClient({pageUrl: () => libraryUrl, timeoutMs: 5, fetch: async (_url, init) => ({
    ok: true, status: 200, json: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once: true});
    }),
  })});
  await assert.rejects(client.saveCreators(target, "Artista"), failure("timeout", "creators", true));
});
