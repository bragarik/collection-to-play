import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DeezerClient,parseDeezerAlbums,isDeezerAlbumUrl,isDeezerArtwork} from '../src/streamings/deezer.ts';
import {searchAlbums} from '../src/albums/resolution.ts';
const fixture=JSON.parse(await readFile(new URL('./fixtures/deezer-skank-siderado.json',import.meta.url),'utf8'));
const query={title:'Siderado',artist:'Skank',source:{catalogId:'libib',itemUrl:'https://www.libib.com/library'}};
const term='Siderado Skank';
test('Deezer interpreta amostra pública e usa somente links e capas retornados',()=>{
 const [album]=parseDeezerAlbums(fixture,term);
 assert.equal(album.id,'1215478');assert.deepEqual(album.artists,[{id:'13545',name:'Skank'}]);
 assert.equal(album.url,fixture.data[0].link);assert.equal(album.artworkUrl,fixture.data[0].cover_medium);
 assert.deepEqual(album.artworkVariants.map(v=>v.width),[56,250,500,1000]);
});
test('Deezer busca sem credenciais e ignora código, preservando título manual',async()=>{
 const client=new DeezerClient(async(value,init)=>{
 const url=new URL(value);assert.equal(url.origin,'https://api.deezer.com');assert.equal(url.pathname,'/search/album');
 assert.equal(url.searchParams.get('q'),term);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.headers,undefined);
 return Response.json(fixture);
 });
 assert.equal((await searchAlbums(client,{...query,upc:'invalid'})).status,'resolved');
});
test('Deezer pagina com cursor vinculado à consulta e não abre resultado truncado',async()=>{
 const next='https://api.deezer.com/search/album?q=Siderado%20Skank&index=1&limit=25';
 const first={...fixture,total:2,next};
 const result=parseDeezerAlbums(first,term);assert.equal(result.complete,false);assert.ok(result.nextPage);
 let calls=0;
 const client=new DeezerClient(async value=>{calls++;assert.equal(new URL(value).searchParams.get('index'),'1');return Response.json(fixture);});
 await assert.rejects(client.search({...query,title:'Outro'},undefined,result.nextPage),{code:'invalid-query'});assert.equal(calls,0);
 await assert.rejects(client.search(query,undefined,'https://evil.example'),{code:'invalid-query'});
 const resolved=await searchAlbums(new DeezerClient(async()=>Response.json(first)),query);
 assert.equal(resolved.status,'choose');assert.equal(resolved.incomplete,true);
 const last={...fixture,total:2};await new DeezerClient(async()=>Response.json(last)).search(query,undefined,result.nextPage);
 for(const bad of [next.replace('api.deezer.com','evil.example'),next.replace('index=1','index=0'),next.replace('Skank','Other'),next+'&token=secret',next.replace('index=1','index=2')]) assert.throws(()=>parseDeezerAlbums({...first,next:bad},term),{code:'invalid-response'});
 assert.equal(parseDeezerAlbums({...fixture,total:2},term).complete,false);
});
test('Deezer valida identidade e destinos sem converter resposta inválida em ausência',()=>{
 for(const patch of [{id:0},{title:''},{artist:{id:1,name:''}},{link:'https://evil.example/album/1215478'},{type:'track'}]){
 const data=structuredClone(fixture);Object.assign(data.data[0],patch);assert.throws(()=>parseDeezerAlbums(data,term),{code:'invalid-response'});
 }
 for(const bad of [null,{}, {data:[],total:'0'}, {data:fixture.data,total:0}]) assert.throws(()=>parseDeezerAlbums(bad,term),{code:'invalid-response'});
 assert.deepEqual(parseDeezerAlbums({data:[],total:0},term),[]);
 for(const url of ['http://www.deezer.com/album/1215478','https://www.deezer.com/album/1','https://u:p@www.deezer.com/album/1215478','https://www.deezer.com/album/1215478?next=evil']) assert.equal(isDeezerAlbumUrl(url,'1215478'),false);
 assert.equal(isDeezerArtwork('https://cdn-images.dzcdn.net.evil.example/images/cover/a'),false);
});
test('Deezer separa erro API com HTTP200, limite e ausência sem expor mensagens brutas',async()=>{
 for(const [code,expected] of [[4,'rate-limited'],[800,'unavailable']]){
 const events=[];await assert.rejects(new DeezerClient(async()=>Response.json({error:{code,message:'private secret'}})).search(query,undefined,undefined,e=>events.push(e)),{code:expected});
 assert.equal(events.find(e=>e.kind==='api-error').code,code);assert.equal(events.at(-1).status,200);assert.doesNotMatch(JSON.stringify(events),/private secret/);
 }
 await assert.rejects(new DeezerClient(async()=>new Response(null,{status:429,headers:{'Retry-After':'30'}})).search(query),{code:'rate-limited',retryAfterSeconds:30});
});
