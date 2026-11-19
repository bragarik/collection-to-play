import test from 'node:test';
import assert from 'node:assert/strict';
import {upcitemdbCandidate,validateUpcitemdbCandidate,upcitemdbDescription} from '../src/albums/upcitemdb-source.ts';
import {parseUpcitemdbResponse} from '../src/streamings/upcitemdb.ts';
import {AlbumComposition} from '../src/albums/album-composition.ts';
import {DescriptionMerge} from '../src/albums/description-merge.ts';
import {descriptionFromSearch,validateDescriptionAlbum,descriptionUsesDetails} from '../src/albums/album-description.ts';
import {isValidCandidate} from '../src/albums/resolution.ts';
import {isMetadataAlbumId,MetadataSearchSession} from '../src/streamings/metadata-search.ts';
import {STREAMINGS,METADATA_SERVICE_IDS} from '../src/shared/contracts.ts';
import {fetchAlbumArtwork,isAlbumArtworkUrl} from '../src/albums/album-artwork.ts';
const product=changes=>parseUpcitemdbResponse({code:'OK',total:1,offset:0,items:[{title:'Ramones - Raw',ean:'0014381227826',upc:'014381227826',brand:'Image Entertainment',model:'DVD',category:'Media > Movies',description:'Texto original.\n\nOutro parágrafo.',images:['https://images.example.com/raw.jpg'],...changes}]}).products[0];
test('produto sem artista vira candidato válido e não transforma marca em criador ou estúdio',()=>{
 const candidate=upcitemdbCandidate(product());
 assert.deepEqual(candidate.artists,[]);assert.equal(candidate.service,'upcitemdb');assert.equal(candidate.id,'0014381227826');
 assert.equal(candidate.artworkUrl,'https://images.example.com/raw.jpg');assert.deepEqual(candidate.artworkVariants,[{url:candidate.artworkUrl}]);
 assert.equal(isMetadataAlbumId('upcitemdb',candidate.id),true);assert.equal(isMetadataAlbumId('upcitemdb','123'),false);
 assert.equal(isValidCandidate(candidate,'upcitemdb'),true);assert.equal(isValidCandidate({...candidate,service:'spotify'},'spotify'),false);
 assert.deepEqual(validateDescriptionAlbum(candidate),candidate);
 const description=upcitemdbDescription(candidate);
 assert.equal(description.manualFields.ean_isbn13,'0014381227826');assert.equal(description.manualFields.upc_isbn10,'014381227826');
 assert.equal(description.manualFields.publisher,undefined);assert.equal(description.manualFields.directors,undefined);
 assert.deepEqual(description.fields,['title']);assert.match(description.text,/Marca: Image Entertainment/);
 assert.match(description.text,/Sobre o produto:\nTexto original\.\n\nOutro parágrafo\./);
 assert.doesNotMatch(description.text,/Artistas:|Diretores:|Gravadora:|Preço:/);
 assert.match(description.text,/Fonte: UPCitemdb\nhttps:\/\/www.upcitemdb.com\/upc\/0014381227826$/);
});
test('descrição já disponível reaproveita a pesquisa e + todos preserva artistas e capa do Libib',async()=>{
 let calls=0;const model=new AlbumComposition({title:'Original',artists:['Artista original']},{loadDescription:async()=>{calls++;throw Error('Não deve consultar novamente');}});
 const candidate=upcitemdbCandidate(product());model.addAlbum(candidate);model.selectAlbum('upcitemdb');
 assert.equal(descriptionUsesDetails('upcitemdb'),false);assert.deepEqual(descriptionFromSearch(candidate),candidate.description);
 await model.loadDescription('upcitemdb');assert.equal(calls,0);model.copyAll();
 assert.equal(model.changes().title,'Ramones - Raw');assert.equal(model.changes().artists,undefined);assert.equal(model.changes().artwork,undefined);
 assert.deepEqual(model.snapshot().fields.artists.value,['Artista original']);
 model.dispose();
});
test('dados opcionais ausentes são omitidos, texto longo fica para revisão e merge oferece marca sem virar gravadora',()=>{
 const candidate=upcitemdbCandidate(product({brand:undefined,description:undefined,model:undefined,category:undefined,upc:undefined}));
 assert.doesNotMatch(candidate.description.text,/Marca:|Modelo:|Categoria:|Sobre o produto:|UPC:/);
 const long=upcitemdbCandidate(product({description:'a'.repeat(5000)}));const model=new AlbumComposition();model.addAlbum(long);model.selectAlbum('upcitemdb');
 model.copyField('description');assert.ok(model.changes().description.length>5000);model.dispose();
 const full=upcitemdbCandidate(product()),merge=new DescriptionMerge([{album:full,description:full.description}]);
 merge.choose('upcitemdb','brand');merge.choose('upcitemdb','model');merge.choose('upcitemdb','category');merge.setIncludeSources(true);
 assert.match(merge.text(),/Marca: Image Entertainment/);assert.match(merge.text(),/Modelo: DVD/);assert.doesNotMatch(merge.text(),/Gravadora:/);
});
test('identidade e produto são revalidados sem confiar em descrição, marca ou imagens injetadas no candidato',()=>{
 const candidate=upcitemdbCandidate(product());
 for(const changes of [{id:'7898285415687'},{title:'Outro'},{artists:[{id:'x',name:'Fabricante'}]},{url:'https://evil.test/album'},
  {ean:'7898285415687'},{artworkUrl:'https://evil.test/image.jpg'},{upcitemdb:{...candidate.upcitemdb,id:'outro'}}]){
  assert.throws(()=>validateUpcitemdbCandidate({...candidate,...changes}),{code:'invalid-response'});
 }
 const rewritten={...candidate,description:{...candidate.description,text:'Texto injetado'}};
 assert.doesNotMatch(descriptionFromSearch(rewritten).text,/Texto injetado/);
});
test('contratos suportam sessão de busca com artista ausente, com seleção musical habilitada e sem reprodução',async()=>{
 const candidate=upcitemdbCandidate(product());
 const session=new MetadataSearchSession('upcitemdb',{services:async()=>({configurationUrl:'setup.html',services:[{id:'upcitemdb',name:'UPCitemdb',connected:true,requiresAuthentication:false}]}),
 search:async()=>({service:'upcitemdb',configurationUrl:'setup.html',connectionRequired:false,searchUrl:'https://www.upcitemdb.com/',resolution:{status:'choose',candidates:[candidate],rememberAlbumByDefault:false}})});
 await session.search({title:'Raw',artist:'',sourceUrl:'https://www.libib.com/library'});
 assert.deepEqual(session.snapshot().albums[0].artists,[]);
 assert.equal(METADATA_SERVICE_IDS.includes('upcitemdb'),true);assert.equal(STREAMINGS.some(service=>service.id==='upcitemdb'),false);
});
test('capas usam o pipeline comum e somente URLs validadas pertencentes ao produto',async()=>{
 const candidate=upcitemdbCandidate(product({images:['https://images.example.com/falha.jpg','https://images.example.com/capa.jpg']}));
 const calls=[];
 const result=await fetchAlbumArtwork(candidate,{fetch:async(url,init)=>{
  calls.push(url);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.referrerPolicy,'no-referrer');
  return url.includes('falha')?new Response('',{status:403}):new Response(Uint8Array.from([137,80,78,71,13,10,26,10,1]),{headers:{'content-type':'image/png'}});
 },decode:async()=>({width:640,height:640,close(){}})});
 assert.equal(result.service,'upcitemdb');assert.equal(result.sourceUrl,'https://images.example.com/capa.jpg');assert.equal(result.width,640);
 assert.equal(result.format,'png');assert.ok(result.warnings.includes('unavailable-variants'));assert.equal(calls.length,2);
 assert.equal(isAlbumArtworkUrl('upcitemdb','http://images.example.com/a.jpg'),false);
 assert.equal(isAlbumArtworkUrl('upcitemdb','https://127.0.0.1/a.jpg'),false);
 await assert.rejects(fetchAlbumArtwork({...candidate,artworkUrl:'https://other.example.com/fake.jpg'},{fetch:async()=>{throw Error('não deve buscar');}}),{code:'invalid-input'});
 const noImages=upcitemdbCandidate(product({images:[]}));assert.equal(noImages.artworkUrl,undefined);
 await assert.rejects(fetchAlbumArtwork(noImages),{code:'unavailable'});
});
