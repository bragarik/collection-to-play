import test from 'node:test';
import assert from 'node:assert/strict';
import {lastfmCandidate,lastfmDescription,LastfmSource} from '../src/albums/lastfm-source.ts';
import {parseLastfmAlbum,isLastfmSourceId} from '../src/streamings/lastfm.ts';
import {AlbumComposition} from '../src/albums/album-composition.ts';
import {AlbumArtworkResource,fetchAlbumArtwork,isAlbumArtworkUrl,loadAlbumArtworkResource} from '../src/albums/album-artwork.ts';
const png=Uint8Array.from([137,80,78,71,13,10,26,10,1]);
const album=(changes={})=>parseLastfmAlbum({album:{name:'Siderado',artist:'Skank',url:'https://www.last.fm/music/Skank/Siderado',tracks:{track:[{name:'Resposta',duration:'243','@attr':{rank:'1'}}]},tags:{tag:[{name:'rock'}]},image:[{'#text':'https://lastfm.freetls.fastly.net/i/u/300x300/test.png'}],wiki:{content:'História &lt;literal&gt; &amp; texto'},...changes}},{title:'Siderado',artist:'Skank',language:'pt'});
test('fonte complementar mantém edição/idioma, dados próprios e texto literal sem dupla limpeza',()=>{
 const source=new LastfmSource(album());assert.equal(source.id,'https://www.last.fm/music/Skank/Siderado#pt');assert.equal(isLastfmSourceId(source.id),true);
 assert.equal(source.snapshot().about,'História <literal> & texto');assert.equal(source.sections().find(s=>s.field==='tags').text,'Tags: rock');
 assert.match(source.description(),/Sobre o álbum:/);assert.match(source.description(),/1\. Resposta — 4:03/);assert.match(source.description(),/Termos da API Last\.fm: https:\/\/www\.last\.fm\/api\/tos/);assert.doesNotMatch(source.description(),/CC BY-SA/);
 const snapshot=source.snapshot();snapshot.tags.push('changed');assert.deepEqual(source.snapshot().tags,['rock']);
 assert.throws(()=>new LastfmSource({...album(),url:'https://evil.example/album'}));assert.throws(()=>new LastfmSource(album({tracks:{track:[]},wiki:undefined})));
});
test('copiar campos Last.fm não ocupa vagas e restauração/origem são independentes da fonte',()=>{
 const source=new LastfmSource(album()),model=new AlbumComposition({title:'Original',artists:['Anterior'],description:'Anterior'});
 model.copyLastfm(source,['title','artists']);assert.equal(model.snapshot().cards.length,0);assert.equal(model.snapshot().fields.title.value,'Siderado');assert.equal(model.snapshot().fields.title.source.kind,'complementary');
 assert.equal(model.snapshot().fields.description.included,false);model.copyLastfm(source,['description']);assert.match(model.changes().description,/Sobre o álbum:/);assert.match(model.changes().description,/Termos da API Last\.fm/);
 source.dispose();assert.equal(model.changes().title,'Siderado');model.resetField('title');assert.equal(model.snapshot().fields.title.value,'Original');assert.equal(model.snapshot().fields.title.included,false);model.dispose();
});
test('descrição longa permanece na fonte e impede cópia antes de alterar outros campos',()=>{
 const source=new LastfmSource(album({wiki:{content:'a'.repeat(6000)}})),model=new AlbumComposition({title:'Original'});
 assert.ok(source.description().length>6000);assert.throws(()=>model.copyLastfm(source,['title','description']),/5\.000/);assert.equal(model.snapshot().fields.title.value,'Original');assert.deepEqual(model.changes(),{});
});
test('capa Last.fm reutiliza validação de bytes/dimensões e preserva referências no rascunho',async()=>{
 const source=new LastfmSource(album());let revoked=0;
 const file=await fetchAlbumArtwork(source.artworkInput(),{fetch:async()=>new Response(png),decode:async()=>({width:600,height:600,close(){}})});
 assert.equal(file.service,'lastfm');assert.equal(file.width,600);
 const resource=await loadAlbumArtworkResource(source.artworkInput(),async()=>file,{urls:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{revoked++;}}});
 source.setArtwork(resource);resource.release();const model=new AlbumComposition();model.copyLastfm(source,['artwork']);source.dispose();assert.equal(revoked,0);assert.equal(model.changes().artwork.type,'image/png');model.resetField('artwork');assert.equal(revoked,1);model.dispose();
});
test('capa ausente não altera rascunho e identidades/hosts impróprios são rejeitados',async()=>{
 const source=new LastfmSource(album({image:[]})),model=new AlbumComposition();assert.equal(model.copyLastfm(source,['artwork']),false);assert.deepEqual(model.changes(),{});
 for(const url of ['https://evil.example/i/u/cover.png','https://lastfm.freetls.fastly.net.evil.example/i/u/cover.png','http://lastfm.freetls.fastly.net/i/u/cover.png','https://lastfm.freetls.fastly.net/private'])assert.equal(isAlbumArtworkUrl('lastfm',url),false);
 assert.equal(isLastfmSourceId('https://evil.example/music/Skank/Siderado#pt'),false);
 await assert.rejects(fetchAlbumArtwork({...source.artworkInput(),id:'invalid'}),{code:'invalid-input'});
 await assert.rejects(fetchAlbumArtwork(source.artworkInput()),{code:'unavailable'});
});

test('prévia reduzida pelo usuário copia descrição longa com origem de edição manual',()=>{
 const source=new LastfmSource(album({wiki:{content:'a'.repeat(6000)}})),model=new AlbumComposition({title:'Original'});
 model.copyLastfm(source,['description'],'Sobre o álbum: texto revisado\nFonte: Last.fm');
 assert.match(model.changes().description,/texto revisado/);assert.match(model.changes().description,/Termos da API Last\.fm/);assert.equal(model.snapshot().fields.description.source.kind,'manual');assert.equal(model.snapshot().fields.description.source.basedOn.kind,'complementary');
 model.editDescription('História editada pelo usuário');assert.match(model.changes().description,/História editada pelo usuário/);assert.match(model.changes().description,/https:\/\/www\.last\.fm\/api\/tos/);
 assert.equal(model.snapshot().fields.title.value,'Original');model.resetField('description');assert.equal(model.snapshot().fields.description.included,false);
});

test('Last.fm usa o mesmo fluxo de cinco cards e descrição automática, sem alterar reprodução',async()=>{
 const {METADATA_SERVICE_IDS,STREAMINGS}=await import('../src/shared/contracts.ts');
 const model=new AlbumComposition();
 for(const service of METADATA_SERVICE_IDS.filter(s=>s!=='lastfm')){
  const id=service==='spotify'?'A'.repeat(22):service==='youtube-music'?'MPREdemo':'401652079';
  const url=service==='spotify'?'https://open.spotify.com/album/'+id:service==='youtube-music'?'https://music.youtube.com/browse/'+id:service==='deezer'?'https://www.deezer.com/album/'+id:'https://music.apple.com/br/album/test/'+id;
  model.addAlbum({service,id,url,title:'Siderado',artists:[{id:'artist',name:'Skank'}]});
 }
 const candidate=lastfmCandidate(album());model.addAlbum(candidate);assert.equal(model.snapshot().cards.length,5);assert.equal(STREAMINGS.some(s=>s.id==='lastfm'),false);
 model.selectAlbum('lastfm');model.copyField('title');assert.equal(model.snapshot().fields.title.source.service,'lastfm');assert.ok(model.snapshot().cards.find(c=>c.album.service==='lastfm').description.sections.some(s=>s.field==='about'));
 assert.throws(()=>model.addAlbum(candidate));model.removeAlbum('lastfm');assert.equal(model.snapshot().cards.length,4);assert.equal(model.snapshot().fields.title.value,'Siderado');
});
test('descrição Last.fm longa copia para revisão no formulário sem corte, antes da confirmação',()=>{
 const model=new AlbumComposition();model.addAlbum(lastfmCandidate(album({wiki:{content:'a'.repeat(6000)}})));model.selectAlbum('lastfm');model.copyField('description');assert.ok(model.changes().description.length>6000);
 model.editDescription('Texto revisado');assert.match(model.changes().description,/^Texto revisado/);assert.match(model.changes().description,/Termos da API Last\.fm/);
});
test('Sobre o álbum é opcional comum, aparece antes das faixas e pode trocar de fonte no merge',async()=>{
 const {DescriptionMerge}=await import('../src/albums/description-merge.ts');const {formatAlbumDescription}=await import('../src/albums/album-description.ts');
 const candidate=lastfmCandidate(album());const other={service:'spotify',id:'A'.repeat(22),title:'Siderado',artists:[{id:'artist',name:'Skank'}],url:'https://open.spotify.com/album/'+'A'.repeat(22)};
 const document=formatAlbumDescription({album:other,about:'Outro contexto',tracks:[{title:'Outra faixa',number:1}],tracksComplete:true});
 assert.ok(document.text.indexOf('Sobre o álbum:')<document.text.indexOf('Faixas:'));
 const merge=new DescriptionMerge([{album:candidate,description:lastfmDescription(candidate)},{album:other,description:document}]);
 merge.choose('spotify','title');merge.choose('lastfm','about');merge.setIncludeSources(true);assert.match(merge.text(),/Last.fm - Sobre o álbum/);assert.match(merge.text(),/Termos da API Last\.fm: https:\/\/www\.last\.fm\/api\/tos/);assert.doesNotMatch(merge.text(),/CC BY-SA/);
 merge.edit(merge.text().replace('História <literal> & texto','História revisada'));
 assert.match(merge.text(),/História revisada/);assert.match(merge.text(),/Termos da API Last\.fm/);
 merge.setIncludeSources(false);assert.match(merge.text(),/Fonte do texto: Last.fm/);assert.match(merge.text(),/Termos da API Last\.fm: https:\/\/www\.last\.fm\/api\/tos/);
 merge.choose('spotify','about');assert.match(merge.text(),/Outro contexto/);assert.doesNotMatch(merge.text(),/Fonte do texto: Last.fm/);assert.equal(merge.result().sources.find(s=>s.field==='about').service,'spotify');
});
