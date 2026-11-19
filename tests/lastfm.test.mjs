import test from 'node:test';
import assert from 'node:assert/strict';
import {LastfmClient,lastfmQuery,parseLastfmAlbum,parseLastfmSearch} from '../src/streamings/lastfm.ts';
const key='a'.repeat(32),query={artist:'Skank',title:'Siderado',language:'pt'};
const album=(changes={})=>({album:{name:'Siderado',artist:'Skank',url:'https://www.last.fm/music/Skank/Siderado',tracks:{track:[{name:'Resposta',duration:'243','@attr':{rank:'1'}}]},tags:{tag:[{name:'rock'},{name:'rock'}]},wiki:{content:'História &amp; contexto.<br>Outro parágrafo.'},...changes}});
function setup(response=()=>Response.json(album()),extra={}){const calls=[],events=[];return {calls,events,client:new LastfmClient({key:async()=>key,fetch:async(url,init)=>{calls.push({url,init});return response(url,init);},...extra})};}
test('consulta usa idioma explícito e edição exata, sem login, autocorreção ou fallback',async()=>{
 const v=setup();const result=await v.client.album(query,{onDiagnostic:e=>v.events.push(e)});const url=new URL(v.calls[0].url);
 assert.equal(url.searchParams.get('lang'),'pt');assert.equal(url.searchParams.get('autocorrect'),'0');assert.equal(url.searchParams.get('api_key'),key);
 assert.equal(v.calls[0].init.credentials,'omit');assert.equal(v.calls[0].init.redirect,'error');assert.equal(v.calls.length,1);
 assert.equal(result.requestedLanguage,'pt');assert.equal(result.about,'História & contexto.\nOutro parágrafo.');assert.deepEqual(result.tags,['rock']);assert.equal(result.tracks[0].durationSeconds,243);
 assert.doesNotMatch(JSON.stringify(v.events),new RegExp(key+'|api_key|audioscrobbler|História'));
});
test('idioma solicitado não é apresentado como idioma detectado e texto longo não é truncado',async()=>{
 const v=setup(()=>Response.json(album({wiki:{content:'Texto em português. '+ 'a'.repeat(12000)}})));
 const result=await v.client.album({...query,language:'en'});assert.equal(result.requestedLanguage,'en');assert.ok(result.about.length>12000);assert.equal(new URL(v.calls[0].url).searchParams.get('lang'),'en');
});
test('HTML é convertido para texto e não executado; créditos preservados',()=>{
 const result=parseLastfmAlbum(album({wiki:{content:'<script>alert(1)</script><p>Texto &#233; &quot;bom&quot;</p><a href="https://www.last.fm/">Read more on Last.fm</a>. User-contributed text is available under the Creative Commons By-SA License.'}}),query);
 assert.doesNotMatch(result.about,/<script>|alert\(1\)|<a/);assert.match(result.about,/Texto é "bom"/);assert.match(result.about,/Creative Commons/);assert.equal(result.attribution.url,result.url);
});
test('nomes e links de outro artista/álbum/edição são rejeitados',()=>{
 for(const changes of [{artist:'Queen'},{name:'Siderado (Deluxe)'},{url:'https://evil.example/music/Skank/Siderado'},{url:'https://www.last.fm/music/Queen/Siderado'}])assert.throws(()=>parseLastfmAlbum(album(changes),query));
 assert.throws(()=>parseLastfmAlbum(album(),{...query,title:'Siderado (Deluxe)'}),{code:'mismatch'});
});
test('registro vazio com HTTP 200 não é tratado como álbum confirmado; ausência de história é permitida',()=>{
 const empty=parseLastfmAlbum(album({tracks:{track:[]},wiki:undefined}),query);assert.equal(empty.status,'empty');assert.equal(empty.about,undefined);
 const data=parseLastfmAlbum(album({wiki:undefined}),query);assert.equal(data.status,'ready');assert.equal(data.about,undefined);
});
test('campos ausentes não viram dados inventados; imagens inseguras são descartadas',()=>{
 const result=parseLastfmAlbum(album({image:[{'#text':'http://evil.example/a.png'}],mbid:'not-an-id',tracks:{track:[{name:'Faixa',duration:'0'}]}}),query);
 assert.equal(result.mbid,undefined);assert.equal(result.artworkUrl,undefined);assert.equal(result.tracks[0].number,undefined);assert.equal(result.tracks[0].durationSeconds,undefined);
});
test('entradas inválidas e chave ausente não disparam rede',async()=>{
 const v=setup();for(const q of [{...query,artist:''},{...query,language:'default'},{...query,title:'x'.repeat(201)}])await assert.rejects(v.client.album(q),{code:'invalid-query'});
 assert.equal(v.calls.length,0);const noKey=setup(undefined,{key:async()=>undefined});await assert.rejects(noKey.client.album(query),{code:'configuration-required'});assert.equal(noKey.calls.length,0);
});
test('códigos HTTP e erros Last.fm são diferenciados, sem expor mensagem remota',async()=>{
 for(const [status,error,code] of [[404,6,'not-found'],[400,6,'invalid-query'],[403,10,'invalid-key'],[403,26,'invalid-key'],[200,29,'rate-limited'],[429,29,'rate-limited'],[503,11,'unavailable']]){
  const v=setup(()=>Response.json({error,message:'private '+key},{status}));await assert.rejects(v.client.album(query),e=>e.code===code&&!e.message.includes(key));
 }
});
test('JSON ou estrutura inválidos falham sem retornar HTML/respostas cruas',async()=>{
 for(const response of [()=>new Response('private '+key),()=>Response.json({}),()=>Response.json(album({tracks:{track:'bad'}})),()=>Response.json(album({wiki:{content:{bad:true}}}))]){
  await assert.rejects(setup(response).client.album(query),e=>e.code==='invalid-response'&&!e.message.includes(key));
 }
});
test('rede, timeout e cancelamento são distintos; cancelamento prévio evita rede',async()=>{
 const v=setup(()=>{throw new TypeError('network secret '+key);});await assert.rejects(v.client.album(query),e=>e.code==='network'&&!e.message.includes(key));
 const controller=new AbortController();controller.abort();const cancelled=setup();await assert.rejects(cancelled.client.album(query,{signal:controller.signal}),{code:'cancelled'});assert.equal(cancelled.calls.length,0);
 const pending=setup((_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),{timeoutMs:10});
 const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(pending.client.album(query),{code:'timeout'});}finally{clearTimeout(keepAlive);}
});
test('busca só por título não exige artista nem consulta detalhes de todos os resultados',async()=>{
 const matches=[{name:"Give 'Em the Boot III",artist:'Various Artists',url:'https://www.last.fm/music/Various+Artists/Give+%27Em+the+Boot+III'},
  {name:"Give 'Em the Boot III",artist:'Rancid',url:'https://www.last.fm/music/Rancid/Give+%27Em+the+Boot+III'}];
 const v=setup(()=>Response.json({results:{'opensearch:totalResults':'40','opensearch:itemsPerPage':'25',albummatches:{album:matches}}}));
 const result=await v.client.search({title:"Give 'Em the Boot III",language:'en'},{page:2,onDiagnostic:event=>v.events.push(event)});
 const url=new URL(v.calls[0].url);
 assert.equal(url.searchParams.get('method'),'album.search');assert.equal(url.searchParams.has('artist'),false);assert.equal(url.searchParams.get('page'),'2');
 assert.equal(v.calls.length,1);assert.equal(result.page,2);assert.equal(result.pages,2);
 assert.deepEqual(result.albums.map(album=>album.artist),['Various Artists','Rancid']);assert.equal(result.albums[0].requestedLanguage,'en');
 assert.equal(v.events.at(-1).count,2);assert.equal(v.events.at(-1).method,'album.search');
 assert.doesNotMatch(JSON.stringify(v.events),new RegExp(key+'|api_key|audioscrobbler|Various Artists|Give'));
});
test('busca valida paginação, nomes e URLs; mantém artistas distintos e elimina duplicatas',()=>{
 const valid={name:'Siderado',artist:'Skank',url:'https://www.last.fm/music/Skank/Siderado'};
 const response=items=>({results:{'opensearch:totalResults':'5','opensearch:itemsPerPage':'25',albummatches:{album:items}}});
 const result=parseLastfmSearch(response([valid,valid,{...valid,url:'https://evil.test/music/Skank/Siderado'},{...valid,artist:'Queen'}]),'pt',1);
 assert.equal(result.albums.length,1);assert.equal(result.albums[0].artist,'Skank');assert.equal(result.albums[0].tracks,undefined);
 assert.equal(parseLastfmSearch(response(valid),'pt',1).albums.length,1);
 assert.deepEqual(parseLastfmSearch({results:{'opensearch:totalResults':'0',albummatches:{album:[]}}},'pt',1).albums,[]);
 assert.throws(()=>parseLastfmSearch({results:{}},'pt',1),{code:'invalid-response'});
});
test('busca sem artista mantém validação, credencial, cancelamento e falhas controladas',async()=>{
 const v=setup();
 for(const [input,options] of [[{title:'',language:'pt'},{}],[{title:'Álbum',language:'fr'},{}],[{title:'Álbum',language:'pt'},{page:101}]])
  await assert.rejects(v.client.search(input,options),{code:'invalid-query'});
 assert.equal(v.calls.length,0);
 const denied=setup(()=>Response.json({error:10,message:key}));
 await assert.rejects(denied.client.search({title:'Álbum',language:'pt'}),{code:'invalid-key'});
 const controller=new AbortController();controller.abort();
 await assert.rejects(v.client.search({title:'Álbum',language:'pt'},{signal:controller.signal}),{code:'cancelled'});
 assert.equal(v.calls.length,0);
});
