import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DESCRIPTION_LIMIT,descriptionLimit,descriptionText,assertDescriptionReplacement,deezerDescription,itunesDescription,spotifyDescription,formatAlbumDescription} from '../src/albums/album-description.ts';
import {loadAlbumDescription} from '../src/streamings/album-description.ts';
const fixture=async name=>JSON.parse(await readFile(new URL(`./fixtures/description-${name}.json`,import.meta.url),'utf8'));
const deezer=await fixture('deezer'),itunes=await fixture('itunes');
const album=(service='deezer')=>({service,id:service==='spotify'?'A'.repeat(22):service==='apple-music'?'401652079':service==='youtube-music'?'MPREtestalbum':'1215478',title:'Siderado',artists:[{id:'13545',name:'Skank'}],url:service==='spotify'?'https://open.spotify.com/album/'+'A'.repeat(22):service==='apple-music'?'https://music.apple.com/br/album/siderado/401652079':service==='youtube-music'?'https://music.youtube.com/browse/MPREtestalbum':'https://www.deezer.com/album/1215478'});

test('descrição Deezer usa amostra pública de lançamento, gravadora, gênero e onze faixas',()=>{
 const document=formatAlbumDescription(deezerDescription(album(),deezer));
 assert.match(document.text,/Álbum: Siderado/);assert.match(document.text,/Artistas: Skank/);assert.match(document.text,/Lançamento: 1998-06-22/);
 assert.match(document.text,/Gravadora: Columbia/);assert.match(document.text,/Gêneros: Pop/);assert.equal(document.listedTracks,11);assert.deepEqual(document.notes,[]);assert.match(document.text,/Fonte: Deezer/);
});
test('descrição iTunes usa dados retornados sem inventar gravadora',()=>{
 const document=formatAlbumDescription(itunesDescription(album('apple-music'),itunes));
 assert.match(document.text,/Gêneros: Brasileira/);assert.match(document.text,/1\. Marginal Tieté/);assert.equal(document.listedTracks,11);assert.doesNotMatch(document.text,/Gravadora:/);assert.deepEqual(document.notes,[]);
});
test('dados públicos Deezer acrescentam tipo, UPC e duração em segundos convertida corretamente',()=>{
 const document=formatAlbumDescription(deezerDescription(album(),deezer));
 assert.match(document.text,/Tipo: Álbum\n/);assert.match(document.text,/UPC: 5099749207127\n/);assert.match(document.text,/Duração: 46:54\n/);
 assert.match(document.text,/Marginal Tieté — \d+:[0-5]\d/);assert.equal(document.fields.length,6);
 assert.doesNotMatch(document.text,/Conteúdo explícito:|Quantidade de discos:/);
});
test('iTunes soma todas as durações e preserva direitos sem deduzir tipo ou gravadora',()=>{
 const parsed=itunesDescription(album('apple-music'),itunes), document=formatAlbumDescription(parsed);
 assert.ok(parsed.tracks.every(track=>track.durationMs>0));assert.match(document.text,/Duração: \d+:[0-5]\d/);
 assert.match(document.text,/Direitos autorais: ℗ 1998 Sony/);assert.match(document.text,/1\. Marginal Tieté — /);
 assert.doesNotMatch(document.text,/Tipo:|Gravadora:|UPC:|EAN:/);
 const incomplete=structuredClone(itunes);incomplete.results.pop();incomplete.resultCount--;
 assert.doesNotMatch(formatAlbumDescription(itunesDescription(album('apple-music'),incomplete)).text,/^Duração:/m);
 const missing=structuredClone(itunes);delete missing.results[1].trackTimeMillis;
 assert.doesNotMatch(formatAlbumDescription(itunesDescription(album('apple-music'),missing)).text,/^Duração:/m);
});
test('Spotify usa tipo, códigos e direitos e só soma durações com lista completa',()=>{
 const source=album('spotify'),data={id:source.id,name:'Siderado',artists:[{name:'Skank'}],album_type:'compilation',external_ids:{upc:'5099749207127',ean:'4006381333931'},copyrights:[{type:'P',text:'1998 Empresa'},{type:'C',text:'© 1998 Editora'}],total_tracks:2,tracks:{items:[{name:'Primeira',track_number:1,duration_ms:250000},{name:'Segunda',track_number:2,duration_ms:230000}]}};
 const document=formatAlbumDescription(spotifyDescription(source,data));
 assert.match(document.text,/Tipo: Coletânea/);assert.match(document.text,/Duração: 8:00/);assert.match(document.text,/1\. Primeira — 4:10/);
 assert.match(document.text,/UPC: 5099749207127/);assert.match(document.text,/EAN: 4006381333931/);
 assert.match(document.text,/Direitos autorais: ℗ 1998 Empresa; © 1998 Editora/);
 data.tracks.next='more';assert.doesNotMatch(formatAlbumDescription(spotifyDescription(source,data)).text,/^Duração:/m);
});
test('campos extras inválidos são omitidos sem impedir a descrição básica',()=>{
 const data={...deezer,record_type:'unknown',duration:-1,upc:'123',tracks:{data:deezer.tracks.data.map(track=>({...track,duration:'123'}))}};
 const document=formatAlbumDescription(deezerDescription(album(),data));
 assert.doesNotMatch(document.text,/^Tipo:|^Duração:|^UPC:| — /m);assert.match(document.text,/Álbum: Siderado/);
 const base={album:album(),tracks:[{title:'Faixa',durationMs:3600000}],trackCount:1,tracksComplete:true};
 assert.match(formatAlbumDescription(base).text,/Duração: 60:00/);
 assert.match(formatAlbumDescription({...base,tracks:[{title:'Faixa',durationMs:5000}]}).text,/Faixa — 0:05/);
 assert.doesNotMatch(formatAlbumDescription({...base,trackCount:undefined}).text,/^Duração:/m);
});
test('Spotify mantém data parcial e informa quando a lista de faixas é parcial',()=>{
 const source=album('spotify');const data={id:source.id,name:'Siderado',artists:[{name:'Skank'}],release_date:'1998',label:'Columbia',genres:[],total_tracks:11,tracks:{items:[{name:'Faixa',track_number:1,disc_number:1}],next:'more'}};
 const document=formatAlbumDescription(spotifyDescription(source,data));assert.match(document.text,/Lançamento: 1998\n/);assert.match(document.text,/Lista parcial de faixas: 1 de 11/);assert.ok(document.notes.length);assert.doesNotMatch(document.text,/Gêneros:/);
});
test('YouTube usa somente os dados da busca sem fabricar faixas ou gravadora',async()=>{
 const result=await loadAlbumDescription(album('youtube-music'),{fetch:()=>assert.fail('não consulta rede'),spotifyDetails:()=>assert.fail('não autentica')});
 assert.match(result.text,/Siderado/);assert.equal(result.listedTracks,0);assert.ok(result.notes[0].includes('somente'));assert.doesNotMatch(result.text,/Gravadora:|Faixas:|Gêneros:/);
});
test('descrições públicas usam GET sem cookies, limites e identidade de álbum',async()=>{
 for(const service of ['deezer','apple-music']){
  const source=album(service),events=[];
  const result=await loadAlbumDescription(source,{spotifyDetails:()=>assert.fail(),onDiagnostic:e=>events.push(e),fetch:async(value,init)=>{
   const url=new URL(value);assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
   if(service==='apple-music'){assert.equal(url.searchParams.get('entity'),'song');assert.equal(url.searchParams.get('country'),'br');assert.equal(url.searchParams.get('id'),source.id);}
   return Response.json(service==='deezer'?deezer:itunes);
  }});
  assert.equal(result.albumId,source.id);assert.equal(events.at(-1).kind,'results');assert.equal(events.at(-1).listedTracks,11);
 }
});
test('consulta de descrição recusa origem, identidade e respostas inválidas antes de usar dados',async()=>{
 for(const bad of [{...album(),id:'../id'},{...album(),url:'https://evil.example'},{...album(),artists:[]}])await assert.rejects(loadAlbumDescription(bad,{fetch:()=>assert.fail(),spotifyDetails:()=>assert.fail()}));
 assert.throws(()=>deezerDescription(album(),{...deezer,id:1}),{code:'invalid-response'});
 const other=structuredClone(itunes);other.results[1].collectionId=1;assert.throws(()=>itunesDescription(album('apple-music'),other),{code:'invalid-response'});
 const malformed=structuredClone(deezer);malformed.tracks.data[0].title='';assert.throws(()=>deezerDescription(album(),malformed),{code:'invalid-response'});
});
test('consulta de descrição distingue HTTP, limite, JSON e cancelamento sem logar corpo bruto',async()=>{
 for(const status of [429,500]){
  const events=[];await assert.rejects(loadAlbumDescription(album(),{spotifyDetails:()=>assert.fail(),onDiagnostic:e=>events.push(e),fetch:async()=>new Response('private-description',{status})}),{code:status===429?'rate-limited':'unavailable'});
  assert.equal(events.at(-1).status,status);assert.doesNotMatch(JSON.stringify(events),/private-description/);
 }
 await assert.rejects(loadAlbumDescription(album(),{spotifyDetails:()=>assert.fail(),fetch:async()=>Response.json({error:{code:4,message:'private-error'}})}),{code:'rate-limited'});
 await assert.rejects(loadAlbumDescription(album(),{spotifyDetails:()=>assert.fail(),fetch:async()=>new Response('<html>bad</html>')}),{code:'invalid-response'});
 const controller=new AbortController();controller.abort();await assert.rejects(loadAlbumDescription(album(),{signal:controller.signal,spotifyDetails:()=>assert.fail(),fetch:()=>assert.fail()}),{code:'cancelled'});
});
test('formatação respeita limite sem apresentar lista incompleta como completa',()=>{
 const document=formatAlbumDescription({album:album(),tracks:Array.from({length:200},(_,i)=>({title:'a'.repeat(500),number:i+1})),trackCount:200,tracksComplete:true});
 assert.ok(document.text.length<=DESCRIPTION_LIMIT);assert.ok(document.listedTracks<200);assert.match(document.text,/Lista parcial/);assert.match(document.text,/Fonte: Deezer/);
});
test('substituição exige confirmação e comparação exata; rejeita texto vazio ou excessivo',()=>{
 assert.throws(()=>assertDescriptionReplacement('Antiga',undefined));assert.throws(()=>assertDescriptionReplacement('Antiga',{confirmed:false,expected:'Antiga'}));assert.throws(()=>assertDescriptionReplacement('Editada',{confirmed:true,expected:'Antiga'}),/mudou/);
 assert.doesNotThrow(()=>assertDescriptionReplacement('Antiga',{confirmed:true,expected:'Antiga'}));assert.equal(descriptionText(' Nova '),'Nova');
 assert.throws(()=>descriptionText(' '));assert.throws(()=>descriptionText('x'.repeat(DESCRIPTION_LIMIT+1)));
});

test('descrição Spotify reutiliza sessão do cliente e preserva HTTP no diagnóstico',async()=>{
 const source=album('spotify'),events=[];
 const result=await loadAlbumDescription(source,{onDiagnostic:e=>events.push(e),spotifyDetails:async(id,signal,onStatus)=>{assert.equal(id,source.id);assert.ok(signal instanceof AbortSignal);onStatus(200);return {id,name:'Siderado',artists:[{id:'13545',name:'Skank'}],release_date:'1998',tracks:{items:[]},total_tracks:0};}});
 assert.match(result.text,/Lançamento: 1998/);assert.ok(events.some(e=>e.kind==='response'&&e.status===200));
});


test('comparação de descrição tolera somente normalização nativa de quebras de linha',()=>{
 assert.doesNotThrow(()=>assertDescriptionReplacement('Linha 1\nLinha 2',{confirmed:true,expected:'Linha 1\r\nLinha 2'}));
 assert.throws(()=>assertDescriptionReplacement('Linha 1\nMudança',{confirmed:true,expected:'Linha 1\r\nLinha 2'}),/mudou/);
 assert.equal(descriptionText('Linha 1\r\nLinha 2'),'Linha 1\nLinha 2');
});

test('limite documentado e limites nativos menores sem truncamento',()=>{
 assert.equal(DESCRIPTION_LIMIT,5000);
 for(const [native,expected] of [[undefined,5000],[-1,5000],[20000,5000],[4200,4200],[0,0],[1.5,5000],[NaN,5000]])assert.equal(descriptionLimit(native),expected);
 assert.equal(descriptionText('a'.repeat(5000)).length,5000);assert.throws(()=>descriptionText('a'.repeat(5001)),/5\.000/);
 assert.equal(descriptionText('a\r\nb',3),'a\nb');assert.throws(()=>descriptionText('abcd',3),/3 caracteres/);assert.throws(()=>descriptionText('a',0));
});
