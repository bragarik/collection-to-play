import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscogsClient, parseDiscogsRelease, discogsCandidate, isDiscogsReleaseUrl} from '../src/streamings/discogs.ts';
import {discogsDescription} from '../src/albums/discogs-description.ts';
import {AlbumComposition} from '../src/albums/album-composition.ts';
import {DescriptionMerge} from '../src/albums/description-merge.ts';
import {isAlbumArtworkUrl} from '../src/albums/album-artwork.ts';

const fixture=()=>({id:9580466,title:'Raw',artists:[{name:'Ramones'}],country:'Brazil',released:'2004-00-00',
 formats:[{name:'DVD',qty:'1',descriptions:['DVD-Video','NTSC']}],
 labels:[{name:'Top Tape Musica Ltda.',catno:'EN 1045-0'}],
 identifiers:[{type:'Barcode',value:'7 898285 415687'}],genres:['Rock'],styles:['Punk'],
 extraartists:[{name:'John Doe',role:'Film Director'},{name:'Ramones',role:'Performer'}],
 tracklist:[{type_:'heading',title:'Show'},{type_:'track',title:'Faixa',duration:'3:20'}],
 images:[{uri:'https://restricted.example/image.jpg'}],lowest_price:100,user_data:{secret:'private'}});
const key='test_token_for_discogs_12345';
function client(responses){
 const calls=[],events=[];
 return {calls,events,api:new DiscogsClient({token:async()=>key,spacingMs:0,
  fetch:async(url,init)=>{calls.push({url,init});return responses.shift()(url,init);},diagnostic:event=>events.push(event)})};
}
const searchPage=(results,pages=1)=>Response.json({pagination:{pages},results});
const result=(extra={})=>({id:9580466,type:'release',title:'Ramones - Raw',format:['DVD','DVD-Video'],country:'Brazil',year:2004,
 label:['Top Tape'],catno:'EN 1045-0',barcode:['7898285415687'],thumb:'https://restricted.example/img',...extra});
test('notas originais ficam literais no campo Notas, separadas da descrição e do merge',async()=>{
 const original='Recorded live at the Rosemont Horizon, Chicago, April 9th, 1992.\n\nEdition with [l123] credit.';
 const value=client([()=>Response.json({...fixture(),notes:original})]);
 const candidate=discogsCandidate(await value.api.release('9580466'));
 const description=discogsDescription(candidate.discogs);
 assert.equal(candidate.discogs.releaseNotes,original);
 assert.equal(description.manualFields.notes,original);
 assert.ok(!description.text.includes(original));
 assert.equal(description.sections.some(section=>section.field==='about'),false);
 const composition=new AlbumComposition();composition.addAlbum(candidate);composition.selectAlbum('discogs');
 composition.copyField('description');assert.ok(!composition.changes().description.includes(original));
 assert.match(composition.changes().description,/Faixas:/);
 assert.equal(value.calls.length,1);
 composition.dispose();
});
test('notas ausentes ou inválidas são omitidas; notas longas não ocupam o limite da descrição',()=>{
 for(const notes of [undefined,null,42,{},'  ','a'.repeat(200001)]){
  const description=discogsDescription(parseDiscogsRelease({...fixture(),notes},'9580466'));
  assert.equal(description.manualFields.notes,undefined);
 }
 const original='Original note.\n'.repeat(500).trim();
 const description=discogsDescription(parseDiscogsRelease({...fixture(),notes:original},'9580466'));
 assert.equal(description.manualFields.notes,original);
 assert.ok(description.text.length<5000);assert.match(description.text,/1\. Faixa — 3:20/);
});
test('descrição Discogs usa espaçamento comum, metadados antes das faixas e crédito único',()=>{
 const description=discogsDescription(parseDiscogsRelease(fixture(),'9580466'));
 assert.match(description.text,/Álbum: Raw\nArtistas: Ramones\nLançamento: 2004\nGravadora:/);
 assert.doesNotMatch(description.text,/\n\n(?:Artistas|Lançamento|Gravadora|País|Formato|Catálogo):/);
 assert.ok(description.text.indexOf('País: Brazil')<description.text.indexOf('Faixas:'));
 assert.match(description.text,/\n\nFaixas:\n1\. Faixa — 3:20/);
 assert.match(description.text,/\n\nFonte: Discogs\nData provided by Discogs\.\nhttps:\/\/www.discogs.com\/release\/9580466$/);
 assert.equal(description.text.split('Data provided by Discogs.').length-1,1);
 assert.equal(description.manualFields.number_of_discs,'1');
 assert.equal(description.attribution.fields.includes('catalog'),true);
});
test('descrição Discogs preserva o aviso comum de lista parcial e os dados da edição física',()=>{
 const raw=fixture();raw.tracklist=Array.from({length:100},(_,i)=>({title:'Faixa '+i+' '+ 'a'.repeat(200),duration:'3:00'}));
 const description=discogsDescription(parseDiscogsRelease(raw,'9580466'));
 assert.ok(description.listedTracks<100);assert.match(description.text,/Lista parcial de faixas:/);
 assert.ok(description.notes.some(note=>note.includes('lista de faixas é parcial')));
 assert.ok(description.notes.some(note=>note.includes('edição física')));
});
test('lotes usam identificadores explícitos da edição e preservam zeros',()=>{
 const raw=fixture();
 raw.identifiers.push(
  {type:'Other',description:'Batch ID',value:'AE0030000'},
  {type:'Other',description:'Batch ID',value:'AE0030000'},
  {type:'Other',description:'Batch ID [Disc]',value:'AA1000'},
  {type:'Matrix / Runout',value:'DVSS-1060420A1 1'},
  {type:'Other',description:'Label Code',value:'LC1234'});
 const release=parseDiscogsRelease(raw,'9580466');
 assert.deepEqual(release.batchIds,['AE0030000','AA1000']);
 assert.deepEqual(discogsCandidate(release).discogs.batchIds,release.batchIds);
 assert.deepEqual(parseDiscogsRelease(fixture(),'9580466').batchIds,[]);
});
test('consulta de lote e inclusão compartilham detalhes sem repetir chamadas simultâneas ou guardar falhas',async()=>{
 const value=client([()=>new Response('',{status:500}),()=>Response.json(fixture())]);
 await assert.rejects(value.api.release('9580466'));
 const [first,second]=await Promise.all([value.api.release('9580466'),value.api.release('9580466')]);
 assert.deepEqual(first,second);
 assert.deepEqual(await value.api.release('9580466'),first);
 assert.equal(value.calls.length,2);
});
test('detalhes preservam metadados CC0, descartam imagens e dados de marketplace/usuário',()=>{
 const release=parseDiscogsRelease(fixture(),'9580466');
 assert.equal(release.released,'2004');assert.equal(release.discCount,1);assert.equal(release.country,'Brazil');
 assert.deepEqual(release.barcodes,['7898285415687']);assert.deepEqual(release.directors,['John Doe']);
 assert.equal(release.tracks.length,1);assert.equal(release.tracks[0].durationMs,200000);
 assert.doesNotMatch(JSON.stringify(release),/restricted|lowest_price|user_data|private/);
 const candidate=discogsCandidate(release);assert.equal(candidate.ean,'7898285415687');assert.equal(candidate.artworkUrl,undefined);
 assert.equal(isAlbumArtworkUrl('discogs','https://i.discogs.com/a.jpg'),false);
 assert.equal(isDiscogsReleaseUrl(candidate.url,candidate.id),true);
 assert.equal(isDiscogsReleaseUrl('https://evil.test/release/9580466',candidate.id),false);
 assert.throws(()=>parseDiscogsRelease(fixture(),'123'));
});
test('consulta por código e paginação usam API oficial e token no header, sem registrar a credencial',async()=>{
 const value=client([()=>searchPage([result()],2)]);
 const page=await value.api.search({title:'Raw',barcode:'7898285415687',media:'movie'});
 assert.equal(page.candidates.length,1);assert.equal(page.mode,'barcode');assert.equal(page.pages,2);
 const url=new URL(value.calls[0].url);assert.equal(url.origin,'https://api.discogs.com');
 assert.equal(url.searchParams.get('barcode'),'7898285415687');assert.equal(url.searchParams.has('token'),false);
 assert.equal(value.calls[0].init.headers.Authorization,'Discogs token='+key);
 assert.equal(value.calls[0].init.credentials,'omit');
 assert.doesNotMatch(JSON.stringify(value.events),new RegExp(key+'|Authorization|api.discogs|Raw'));
 assert.equal(page.candidates[0].artworkUrl,undefined);
});
test('código sem resultado tenta título; mídia vídeo filtra CDs e mantém edição em DVD',async()=>{
 const value=client([()=>searchPage([]),()=>searchPage([result(),result({id:2,format:['CD']})])]);
 const page=await value.api.search({title:'Raw',artist:'Ramones',barcode:'7898285415687',media:'movie'});
 assert.equal(page.mode,'title');assert.equal(page.candidates.length,1);
 const second=new URL(value.calls[1].url);assert.equal(second.searchParams.get('release_title'),'Raw');
 assert.equal(second.searchParams.get('artist'),'Ramones');assert.equal(second.searchParams.has('barcode'),false);
});
test('falhas de credencial, quota e formato são controladas sem expor resposta ou token',async()=>{
 for(const status of [401,403,429,500]){
  const value=client([()=>new Response(key,{status})]);
  await assert.rejects(value.api.release('9580466'),error=>!error.message.includes(key));
  assert.doesNotMatch(JSON.stringify(value.events),new RegExp(key));
 }
 const value=client([()=>Response.json({results:'invalid',pagination:{pages:1}})]);
 await assert.rejects(value.api.search({title:'Raw',media:'music'}));
 const absent=new DiscogsClient({token:async()=>undefined,fetch:async()=>{throw Error('should not fetch');}});
 await assert.rejects(absent.release('9580466'),{code:'authentication-required'});
});
test('descrição, campos de inclusão e merge incluem crédito e dados da edição sem capa',async()=>{
 const release=parseDiscogsRelease(fixture(),'9580466'),candidate=discogsCandidate(release),description=discogsDescription(release);
 assert.equal(description.manualFields.ean_isbn13,'7898285415687');assert.equal(description.manualFields.number_of_discs,'1');
 assert.equal(description.manualFields.publisher,'Top Tape Musica Ltda.');
 assert.match(description.text,/Data provided by Discogs/);assert.match(description.text,/Brazil/);assert.match(description.text,/EN 1045-0/);
 const composition=new AlbumComposition({}, {loadDescription:async()=>description});
 composition.addAlbum(candidate);composition.selectAlbum('discogs');
 await composition.loadDescription('discogs');composition.copyAll();
 assert.equal(composition.changes().title,'Raw');assert.match(composition.changes().description,/Data provided by Discogs/);
 assert.equal(composition.changes().artwork,undefined);
 const tmdb={service:'tmdb',albumId:'99',text:'Sinopse',sections:[{field:'about',label:'Sinopse',text:'Sinopse: Show'}],listedTracks:0,notes:[]};
 const merge=new DescriptionMerge([{album:candidate,description},{album:{service:'tmdb',id:'99',url:'https://www.themoviedb.org/movie/99'},description:tmdb}]);
 merge.choose('discogs','catalog');merge.choose('tmdb','about');merge.setIncludeSources(false);
 assert.match(merge.text(),/EN 1045-0/);assert.match(merge.text(),/Sinopse: Show/);assert.match(merge.text(),/Data provided by Discogs/);
 composition.dispose();
});

test('editar descrição copiada mantém crédito Discogs e links fora das fontes opcionais',async()=>{
 const candidate=discogsCandidate(parseDiscogsRelease(fixture(),'9580466'));
 const composition=new AlbumComposition();
 composition.addAlbum(candidate);composition.selectAlbum('discogs');composition.copyField('description');
 composition.editDescription('Descrição revisada');
 assert.match(composition.changes().description,/Descrição revisada/);
 assert.match(composition.changes().description,/Data provided by Discogs/);
 assert.match(composition.changes().description,/https:\/\/www.discogs.com\/release\/9580466/);
 composition.dispose();
});

test('quota respeita Retry-After sem novas requisições imediatas',async()=>{
 const value=client([()=>new Response('',{status:429,headers:{'retry-after':'60'}})]);
 await assert.rejects(value.api.release('9580466'),{code:'rate-limited'});
 await assert.rejects(value.api.release('9580466'),{code:'rate-limited'});
 assert.equal(value.calls.length,1);
 const data=fixture();data.released=undefined;data.year=2004;data.tracklist=[{title:'Show',duration:'132:00'}];
 const release=parseDiscogsRelease(data,'9580466');
 assert.equal(release.released,'2004');assert.equal(release.tracks[0].durationMs,7920000);
});

test('miniatura Discogs é exclusiva da pesquisa e não vira capa copiável',async()=>{
 const {isDiscogsSearchThumbnailUrl}=await import('../src/streamings/discogs.ts');
 const thumbnail='https://i.discogs.com/signed/thumb.jpg';
 const value=client([()=>searchPage([result({thumb:thumbnail,cover_image:'https://i.discogs.com/full.jpg'})]),()=>Response.json(fixture())]);
 const page=await value.api.search({title:'Raw',media:'movie'});
 const candidate=page.candidates[0];
 assert.equal(candidate.searchThumbnailUrl,thumbnail);
 assert.equal(candidate.artworkUrl,undefined);assert.equal(candidate.artworkVariants,undefined);
 assert.equal(isAlbumArtworkUrl('discogs',thumbnail),false);
 const details=discogsCandidate(await value.api.release(candidate.id));
 assert.equal(details.searchThumbnailUrl,undefined);
 assert.equal(details.artworkUrl,undefined);
 const model=new AlbumComposition();model.addAlbum(details);model.selectAlbum('discogs');model.copyAll();
 assert.equal(model.changes().artwork,undefined);assert.equal(model.snapshot().cards[0].artwork,undefined);
 assert.doesNotMatch(discogsDescription(details.discogs).text,/thumb.jpg|full.jpg/);model.dispose();
 for(const url of ['http://i.discogs.com/a.jpg','https://i.discogs.com.evil.test/a.jpg','https://evil.test/a.jpg',
  'https://user@i.discogs.com/a.jpg','https://i.discogs.com:8080/a.jpg','https://i.discogs.com/a.jpg?token=secret','data:image/png;base64,x','']){
  assert.equal(isDiscogsSearchThumbnailUrl(url),false,url);
 }
 assert.equal(isDiscogsSearchThumbnailUrl('https://img.discogs.com/thumb.jpg'),true);
});


test('Notas Discogs preserva espaços, quebras e marcação recebidos sem acréscimos',()=>{
 const raw='  Texto [b]original[/b] & literal.\r\n\r\nOutro parágrafo.  ';
 const release=parseDiscogsRelease({...fixture(),notes:raw},'9580466');
 assert.equal(release.releaseNotes,raw);
 assert.equal(discogsDescription(release).manualFields.notes,raw);
});
