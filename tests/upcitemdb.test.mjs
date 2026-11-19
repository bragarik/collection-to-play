import test from 'node:test';
import assert from 'node:assert/strict';
import {UpcitemdbClient,parseUpcitemdbResponse,isUpcitemdbImageUrl} from '../src/streamings/upcitemdb.ts';

const product=(changes={})=>({ean:'0014381227826',upc:'014381227826',title:'Ramones - Raw [DVD]',brand:'Image Entertainment',
 category:'Media > Music & Sound Recordings > Music CDs',description:'Edição física',images:['https://images.example.com/raw.jpg'],...changes});
const page=(items=[],changes={})=>({code:'OK',total:items.length,offset:0,items,...changes});
const query={title:'Raw',artist:'Ramones',media:'movie'};
function setup(responses,extra={}){
 let now=1_000_000;
 const calls=[],events=[],waits=[];
 const api=new UpcitemdbClient({now:()=>now,sleep:async(ms,signal)=>{waits.push(ms);now+=ms;if(signal?.aborted)throw Error('aborted');},
  fetch:async(url,init)=>{calls.push({url,init});const response=responses.shift();return typeof response==='function'?response(url,init):Response.json(response??page());},
  diagnostic:event=>events.push(event),...extra});
 return {api,calls,events,waits,advance:ms=>{now+=ms;}};
}
test('projeta somente dados fornecidos e não inventa artista, diretor, estúdio ou preço',()=>{
 const result=parseUpcitemdbResponse(page([product({offers:[{price:99}],user_data:'private',lowest_recorded_price:1})]));
 assert.equal(result.products[0].id,'0014381227826');assert.equal(result.products[0].upc,'014381227826');
 assert.equal(result.products[0].brand,'Image Entertainment');assert.equal(result.products[0].media,'movie','formato do título prevalece sobre categoria errada');
 assert.doesNotMatch(JSON.stringify(result),/private|offers|price|artists|directors|publisher/);
 assert.deepEqual(parseUpcitemdbResponse(page([product({ean:undefined})])).products.map(p=>p.ean),['0014381227826']);
 assert.equal(parseUpcitemdbResponse(page([product({ean:'7898285415687'})])).products.length,0,'rejeita UPC/EAN conflitantes');
 assert.equal(parseUpcitemdbResponse(page([product({ean:'inválido',upc:undefined})])).products.length,0);
});
test('URLs de imagem são apenas metadados HTTPS validados, sem buscar imagens ou ofertas',()=>{
 for(const value of ['http://images.example.com/a.jpg','https://user@images.example.com/a.jpg','https://127.0.0.1/a',
  'https://192.168.0.1/a','https://localhost/a','https://host.local/a','https://[::1]/a','https://images.example.com:8080/a',
  'https://images.example.com/a?token=secret','https://i.discogs.com/a.jpg','https://localhost./a','javascript:alert(1)'])assert.equal(isUpcitemdbImageUrl(value),false,value);
 assert.equal(isUpcitemdbImageUrl('https://images.example.com/a.jpg?width=450'),true);
 const item=parseUpcitemdbResponse(page([product({images:['https://images.example.com/a.jpg','https://images.example.com/a.jpg','http://images.example.com/b']})])).products[0];
 assert.deepEqual(item.images,['https://images.example.com/a.jpg']);
});
test('código é consultado primeiro e retorno exato preserva zeros sem pesquisa textual',async()=>{
 const s=setup([page([product()])]);const result=await s.api.search({...query,barcode:'0 14381-227826'});
 assert.equal(result.mode,'barcode');assert.equal(result.products[0].ean,'0014381227826');assert.equal(s.calls.length,1);
 const url=new URL(s.calls[0].url);assert.equal(url.origin,'https://api.upcitemdb.com');assert.equal(url.pathname,'/prod/trial/lookup');
 assert.equal(url.searchParams.get('upc'),'014381227826');assert.equal(s.calls[0].init.credentials,'omit');
 assert.equal(s.calls[0].init.redirect,'error');assert.equal(s.calls[0].init.headers.Authorization,undefined);
});
test('sem correspondência exata busca título/artista e respeita intervalo entre chamadas',async()=>{
 for(const lookup of [page(),page([product()])]){
  const s=setup([lookup,page([product()])]);
  const result=await s.api.search({...query,barcode:'7898285415687'});
  assert.equal(result.mode,'title');assert.equal(result.products.length,1);assert.deepEqual(s.waits,[10000]);
  assert.equal(new URL(s.calls[1].url).searchParams.get('s'),'Raw Ramones');
 }
 const onlyCode=setup([page()]);const result=await onlyCode.api.search({title:'',barcode:'7898285415687',media:'music'});
 assert.equal(result.products.length,0);assert.equal(onlyCode.calls.length,1);
});
test('filtra roupa sem confundir DVD com categoria de aparelho e mantém paginação de página filtrada',async()=>{
 const clothing=product({title:'Camisa Ramone Raw',category:'Apparel & Accessories > Clothing'});
 const dvd=product({ean:'0828766132496',upc:'828766132496',category:'Electronics > Video > DVD & Blu-ray Players'});
 const s=setup([page([clothing],{total:3,offset:1}),page([dvd],{total:3,offset:2})]);
 const first=await s.api.search(query);assert.equal(first.products.length,0);assert.ok(first.nextPage);
 const next=await s.api.search({...query,nextPage:first.nextPage});assert.equal(next.products[0].media,'movie');
 assert.equal(new URL(s.calls[1].url).searchParams.get('offset'),'1');assert.deepEqual(s.waits,[15000]);
 await assert.rejects(s.api.search({...query,title:'Outro',nextPage:first.nextPage}),{code:'invalid-query'});
 await assert.rejects(s.api.search({...query,media:'music',nextPage:first.nextPage}),{code:'invalid-query'});
 assert.equal(s.calls.length,2);
});
test('cache e chamadas simultâneas evitam novas consultas e não compartilham objetos mutáveis',async()=>{
 const s=setup([page([product()]),page([product()])]);
 const [first,second]=await Promise.all([s.api.search(query),s.api.search(query)]);
 assert.equal(s.calls.length,1);assert.deepEqual(first,second);
 first.products[0].title='Editado';assert.equal((await s.api.search(query)).products[0].title,'Ramones - Raw [DVD]');
 s.advance(300001);await s.api.search(query);assert.equal(s.calls.length,2);
 assert.ok(s.events.some(event=>event.kind==='cache'));
});
test('429, Retry-After e reset bloqueiam novas chamadas sem retentar automaticamente',async()=>{
 const s=setup([()=>new Response('private response',{status:429,headers:{'retry-after':'90'}}),page()]);
 await assert.rejects(s.api.search(query),error=>error.code==='rate-limited'&&error.retryAfterSeconds===90);
 await assert.rejects(s.api.search(query),{code:'rate-limited'});assert.equal(s.calls.length,1);
 assert.doesNotMatch(JSON.stringify(s.events),/private response|Ramones/);
 s.advance(90001);await s.api.search(query);assert.equal(s.calls.length,2);
 const quota=setup([()=>Response.json(page(),{headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'1120'}})]);
 await quota.api.search(query);await assert.rejects(quota.api.search({...query,title:'Outro'}),{code:'rate-limited'});assert.equal(quota.calls.length,1);
});
test('limites locais conservadores são 20 pesquisas e 100 consultas por dia, com reinício diário',async()=>{
 const searches=setup([]);
 for(let i=0;i<20;i++)await searches.api.search({...query,title:'Álbum '+i});
 await assert.rejects(searches.api.search({...query,title:'Excedente'}),{code:'rate-limited'});assert.equal(searches.calls.length,20);
 searches.advance(86400000);await searches.api.search(query);assert.equal(searches.calls.length,21);
 const lookups=setup([]);
 for(let i=0;i<100;i++){await lookups.api.search({title:'',barcode:'7898285415687',media:'music'});lookups.advance(300001);}
 await assert.rejects(lookups.api.search({title:'',barcode:'7898285415687',media:'music'}),{code:'rate-limited'});
 assert.equal(lookups.calls.length,100);
});
test('cancelamento interrompe fila/espera sem emitir pedido nem guardar falhas',async()=>{
 const controller=new AbortController();controller.abort();const s=setup([page()]);
 await assert.rejects(s.api.search(query,controller.signal),{code:'cancelled'});assert.equal(s.calls.length,0);
 await s.api.search(query);assert.equal(s.calls.length,1);
 const waiting=new AbortController();let calls=0;
 const api=new UpcitemdbClient({now:()=>1000000,fetch:async()=>{calls++;return Response.json(page());},sleep:async()=>{waiting.abort();}});
 await api.search(query);await assert.rejects(api.search({...query,title:'Outro'},waiting.signal),{code:'cancelled'});assert.equal(calls,1);
});
test('validação de entrada e resposta rejeita dados malformados sem vazar corpo ou URL',async()=>{
 const s=setup([]);
 for(const bad of [{...query,barcode:'123'},{...query,title:'',artist:''},{...query,nextPage:'https://evil.test/'},{...query,media:'book'}])await assert.rejects(s.api.search(bad),{code:'invalid-query'});
 assert.equal(s.calls.length,0);
 for(const offset of [-1,NaN,1.5,1000])assert.throws(()=>parseUpcitemdbResponse(page(),offset),{code:'invalid-response'});
 for(const raw of [{code:'OK',items:[]},page([],{total:-1}),page([product()],{total:0}),page([product()],{total:2,offset:2}),{items:[]}])assert.throws(()=>parseUpcitemdbResponse(raw),{code:'invalid-response'});
 const failed=setup([()=>{throw new TypeError('https://evil.test/?token=secret');},()=>new Response('<html>secret</html>',{status:200}),()=>new Response('',{status:500}),page()]);
 for(let i=0;i<3;i++)await assert.rejects(failed.api.search(query));
 await failed.api.search(query);assert.equal(failed.calls.length,4);
 assert.doesNotMatch(JSON.stringify(failed.events),/secret|evil|Ramones|images.example/);
 const missing=setup([()=>Response.json({code:'NOT_FOUND'},{status:404})]);
 assert.equal((await missing.api.search({title:'',barcode:'7898285415687',media:'movie'})).products.length,0);
});
