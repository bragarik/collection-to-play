import test from "node:test";
import assert from "node:assert/strict";
import {LibibEditClient} from "../src/libib/libib-edit.ts";
import {applyLibibMetadata, applyLibibPatch, isLibibPatchResult, describeLibibPatchResult, prepareAlbumMetadata, isLibibApplyResult, describeLibibApplyResult} from "../src/libib/libib-metadata.ts";

const target = {joinId: "101", libraryId: "202"};
const metadata = {title: "Álbum do streaming", artists: ["Primeiro artista", "Segundo artista"]};
const load = () => Response.json({outcome: "success", input_fields: {title: "<input>", creators: "<input>"},
  item: {title: "Anterior", title_override: "Ordenação anterior", creators: ["Anterior"]}});
const saved = () => Response.json({outcome: "success"});
function setup(responses, isCurrent = () => true) {
  const calls = [];
  const client = new LibibEditClient({pageUrl: () => "https://www.libib.com/library", isCurrent,
    fetch: async (url, init) => {
      calls.push({url, body: Object.fromEntries(init.body)});
      const next = responses.shift();
      assert.ok(next, "Unexpected request");
      return typeof next === "function" ? next() : next;
    },
  });
  return {client, calls};
}

test("aplica título e todos os artistas em ordem, preservando override e confirmando ambos", async () => {
  const value = setup([load(), saved(), saved()]);
  const result = await applyLibibMetadata(value.client, target, metadata);
  assert.deepEqual(result, {title: "saved", creators: "saved"});
  assert.deepEqual(value.calls.map(call => call.body), [
    {item_type: "music"},
    {join_id: "101", library_id: "202", item_type: "music", title: metadata.title, title_override: "Ordenação anterior"},
    {join_id: "101", library_id: "202", item_type: "music", creators: "Primeiro artista, Segundo artista"},
  ]);
  assert.match(describeLibibApplyResult(result), /Título e artistas salvos/);
});

test("conversão preserva acentos e ordem, remove duplicatas e não modifica candidato", () => {
  const input = {title: " Álbum ", artists: [" Banda A ", "João da Silva", "Banda A"]};
  const original = structuredClone(input);
  assert.deepEqual(prepareAlbumMetadata(input), {metadata: {title: "Álbum", artists: ["Banda A", "João da Silva"]}, creatorsText: "Banda A, João da Silva"});
  assert.deepEqual(input, original);
});

test("dados inválidos são recusados antes de qualquer gravação, incluindo artistas ambíguos", async () => {
  const value = setup([]);
  for (const input of [null, {}, {...metadata, title: ""}, {...metadata, title: "a".repeat(513)},
    {...metadata, artists: []}, {...metadata, artists: [123]}, {...metadata, artists: [""]},
    {...metadata, artists: ["Nome, Sobrenome"]}, {...metadata, artists: ['Nome "Sobrenome"']}, {...metadata, artists: ["Nome\nOutro"]}]) {
    await assert.rejects(applyLibibMetadata(value.client, target, input));
  }
  assert.equal(value.calls.length, 0);
});

test("falha na leitura não envia título nem artistas", async () => {
  const value = setup([Response.json({outcome: "error"})]);
  const result = await applyLibibMetadata(value.client, target, metadata);
  assert.deepEqual(result, {title: "not-saved", creators: "not-saved"});
  assert.equal(value.calls.length, 1);
});

test("falha ou resultado desconhecido do título interrompe a sequência sem rollback", async () => {
  for (const response of [Response.json({outcome: "error"}), new Response("<html>login</html>"), new Response(null, {status: 403}), () => {throw new TypeError("Network failed");}]) {
    const value = setup([load(), response]);
    const result = await applyLibibMetadata(value.client, target, metadata);
    assert.deepEqual(result, {title: "unconfirmed", creators: "not-saved"});
    assert.equal(value.calls.length, 2);
    assert.match(describeLibibApplyResult(result), /artistas não foram enviados/);
  }
});

test("título confirmado seguido de falha nos artistas é parcial, sem mensagem de sucesso completo", async () => {
  const value = setup([load(), saved(), Response.json({outcome: "error"})]);
  const result = await applyLibibMetadata(value.client, target, metadata);
  assert.deepEqual(result, {title: "saved", creators: "unconfirmed"});
  assert.match(describeLibibApplyResult(result), /Título salvo.*confirmar os artistas/);
  assert.equal(value.calls.length, 3);
});

test("contexto alterado entre leitura e envio impede gravação no item antigo", async () => {
  let current = true;
  const value = setup([() => {current = false; return load();}], () => current);
  assert.deepEqual(await applyLibibMetadata(value.client, target, metadata), {title: "not-saved", creators: "not-saved"});
  assert.equal(value.calls.length, 1);
});

test("contexto alterado após salvar título impede envio dos artistas", async () => {
  let current = true;
  const value = setup([load(), () => {current = false; return saved();}], () => current);
  const result = await applyLibibMetadata(value.client, target, metadata);
  assert.deepEqual(result, {title: "saved", creators: "not-saved"});
  assert.equal(value.calls.length, 2);
  assert.match(describeLibibApplyResult(result), /artistas não foram salvos/);
});

test("cancelamento após envio do título não presume confirmação nem envia artistas", async () => {
  const controller = new AbortController();
  const value = setup([load(), () => {controller.abort(); return saved();}]);
  const result = await applyLibibMetadata(value.client, target, metadata, controller.signal);
  assert.deepEqual(result, {title: "unconfirmed", creators: "not-saved"});
  assert.equal(value.calls.length, 2);
});

test("IDs são copiados para não mudar o destino durante a aplicação", async () => {
  const mutableTarget = {...target};
  const value = setup([load(), () => {mutableTarget.joinId = "999"; return saved();}, saved()]);
  assert.deepEqual(await applyLibibMetadata(value.client, mutableTarget, metadata), {title: "saved", creators: "saved"});
  assert.equal(value.calls[2].body.join_id, "101");
});

test("valida resultado da ponte e rejeita estados incompatíveis ou valores não textuais", () => {
  for (const value of [{title: "saved", creators: "saved"}, {title: "saved", creators: "not-saved"}, {title: "unconfirmed", creators: "not-saved"}]) assert.equal(isLibibApplyResult(value), true);
  for (const value of [null, {}, {title: ["saved"], creators: "saved"}, {title: "not-saved", creators: "saved"}, {title: "unknown", creators: "not-saved"}]) assert.equal(isLibibApplyResult(value), false);
});

const image = () => new File([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])], 'cover.png', {type: 'image/png'});
const confirmed = {confirmed: true, writeMayHaveOccurred: true};

test("patch aplica título ou artistas isoladamente sem exigir o outro campo", async () => {
  for (const [patch, expected] of [[{title: ' Novo título '}, ['title','Novo título']], [{artists: [' A ', 'B', 'A']}, ['creators','A, B']]]) {
    const calls=[];
    const result=await applyLibibPatch(patch, async (...args)=>{calls.push(args);return confirmed;});
    assert.deepEqual(calls,[expected]);assert.deepEqual(result.fields,{[expected[0]]:'saved'});assert.equal(result.nativeUpdated,true);
  }
});

test("patch de capa sozinha valida bytes e decode antes do único envio", async () => {
  const previous=globalThis.createImageBitmap;let closed=0;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){closed++;}});
  try {
    const file=image(),calls=[];
    const result=await applyLibibPatch({artwork:file},async(...args)=>{calls.push(args);return confirmed;});
    assert.deepEqual(calls,[['image',file]]);assert.deepEqual(result.fields,{image:'saved'});assert.equal(closed,1);
    assert.match(describeLibibPatchResult(result),/Capa: salvo/);
  } finally {globalThis.createImageBitmap=previous;}
});

test("patch inteiro é validado antes de escrever qualquer campo", async () => {
  let sends=0;const send=async()=>{sends++;return confirmed;};
  for(const patch of [null,{},[],{title:'ok',artists:[]},{title:'ok',artists:['a,b']},{title:'ok',artwork:new File(['invalid'],'x.png')},{title:'ok',unknown:'x'},{title:undefined},{title:'a'.repeat(513)}]) await assert.rejects(applyLibibPatch(patch,send));
  assert.equal(sends,0);
});

test("arquivo grande, corrompido ou com dimensões inválidas impede todos os envios", async () => {
  const previous=globalThis.createImageBitmap;let sends=0;
  try {
    for(const decode of [async()=>{throw Error('corrupt');},async()=>({width:0,height:1,close(){}})]) {
      globalThis.createImageBitmap=decode;
      await assert.rejects(applyLibibPatch({title:'ok',artwork:image()},async()=>{sends++;return confirmed;}));
    }
    await assert.rejects(applyLibibPatch({artwork:new File([new Uint8Array(20_000_001)],'big.png')},async()=>{sends++;return confirmed;}));
    assert.equal(sends,0);
  } finally {globalThis.createImageBitmap=previous;}
});

test("falha parcial interrompe os campos restantes sem repetir os já confirmados", async () => {
  const previous=globalThis.createImageBitmap;globalThis.createImageBitmap=async()=>({width:320,height:300,close(){}});
  try {
    const calls=[];
    const result=await applyLibibPatch({title:'Title',artists:['Artist'],artwork:image()},async(field)=>{calls.push(field);return field==='title'?confirmed:{confirmed:false,writeMayHaveOccurred:true,code:'http'};});
    assert.deepEqual(calls,['title','creators']);assert.deepEqual(result.fields,{title:'saved',creators:'unconfirmed',image:'not-saved'});
    assert.match(describeLibibPatchResult(result),/Título: salvo.*Artistas: gravação sem confirmação.*Capa: não enviado/);
  } finally {globalThis.createImageBitmap=previous;}
});

test("cancelamento antes do campo e exceção incerta são reportados sem sucesso falso", async () => {
  const blocked=await applyLibibPatch({artists:['A']},async()=>({confirmed:false,writeMayHaveOccurred:false,code:'cancelled'}));
  assert.deepEqual(blocked,{fields:{creators:'not-saved'},nativeUpdated:false});
  const uncertain=await applyLibibPatch({title:'T',artists:['A']},async()=>{throw Error('lost response');});
  assert.deepEqual(uncertain.fields,{title:'unconfirmed',creators:'not-saved'});
});

test("contrato seletivo aceita apenas campos conhecidos e estados escalares", () => {
  assert.equal(isLibibPatchResult({fields:{image:'saved'},nativeUpdated:true}),true);
  for(const value of [null,{fields:{},nativeUpdated:false},{fields:{notes:'saved'},nativeUpdated:true},{fields:{title:['saved']},nativeUpdated:true},{fields:{title:'saved'}}]) assert.equal(isLibibPatchResult(value),false);
});
