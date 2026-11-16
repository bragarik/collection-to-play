import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {ItunesClient, parseItunesAlbums, isItunesAlbumUrl, isItunesArtwork} from "../src/streamings/itunes.ts";
import {searchAlbums} from "../src/albums/resolution.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/itunes-skank-siderado.json", import.meta.url), "utf8"));
const query = {title: "Siderado", artist: "Skank", source: {catalogId: "libib", itemUrl: "https://www.libib.com/library"}};
const clientWith = value => new ItunesClient(async () => Response.json(value));

test("iTunes interpreta amostra pública Siderado com identidade, data, capas e link retornado", () => {
  const [album] = parseItunesAlbums(fixture);
  assert.equal(album.service, "apple-music");
  assert.equal(album.id, "401652079");
  assert.equal(album.title, "Siderado");
  assert.deepEqual(album.artists, [{id: "157890919", name: "Skank"}]);
  assert.equal(album.releaseDate, "1998-06-22");
  assert.equal(album.url, fixture.results[0].collectionViewUrl);
  assert.equal(isItunesAlbumUrl(album.url, album.id), true);
  assert.equal(album.artworkUrl, fixture.results[0].artworkUrl100);
  assert.deepEqual(album.artworkVariants.map(image => image.width), [60, 100]);
  assert.equal(album.upc, undefined);
});

test("iTunes busca por título/artista no Brasil sem credenciais ou códigos e resolve correspondência exata", async () => {
  const events = [];
  const client = new ItunesClient(async (value, init) => {
    const url = new URL(value);
    assert.equal(url.origin, "https://itunes.apple.com");
    assert.equal(url.pathname, "/search");
    assert.deepEqual(Object.fromEntries(url.searchParams), {term: "Siderado Skank", entity: "album", media: "music", country: "br", limit: "200"});
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers, undefined);
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(fixture);
  });
  await client.search({...query, upc: "745099040628"}, undefined, event => events.push(event));
  const result = await searchAlbums(client, query);
  assert.equal(result.status, "resolved");
  assert.equal(result.album.title, "Siderado");
  assert.equal(result.reason, "exact-match");
  assert.deepEqual(events.map(event => event.kind), ["request", "response", "results"]);
});

test("iTunes usa limpeza comum no catálogo e preserva busca manual literal", async () => {
  const terms = [];
  const client = new ItunesClient(async value => {terms.push(new URL(value).searchParams.get("term")); return Response.json(fixture);});
  const source = {...query, title: "Skank - Siderado [CD]"};
  const before = structuredClone(source);
  await client.search(source);
  await client.search({...source, source: {...source.source, catalogId: "preview"}});
  assert.deepEqual(source, before);
  assert.deepEqual(terms.filter(term => term !== null), ["siderado Skank", "Skank - Siderado [CD] Skank"]);
});

test("iTunes distingue catálogo vazio de formato inválido e ignora outros tipos de conteúdo", async () => {
  assert.equal((await searchAlbums(clientWith({resultCount: 0, results: []}), query)).status, "not-found");
  for (const value of [null, [], {}, {resultCount: "0", results: []}, {resultCount: 1, results: []}, {errorMessage: "bad"}]) {
    assert.throws(() => parseItunesAlbums(value), {code: "invalid-response"});
  }
  assert.deepEqual(parseItunesAlbums({resultCount: 2, results: [{wrapperType: "track", kind: "song"}, {wrapperType: "artist"}]}), []);
});

test("iTunes valida identidade e campos obrigatórios sem transformar álbum inválido em ausência", () => {
  for (const patch of [{artistId: null}, {artistId: 0}, {collectionId: 1.2}, {collectionId: Number.MAX_SAFE_INTEGER + 1}, {collectionName: " "}, {artistName: ""}, {collectionViewUrl: null}]) {
    const value = structuredClone(fixture);
    Object.assign(value.results[0], patch);
    assert.throws(() => parseItunesAlbums(value), {code: "invalid-response"});
  }
});

test("iTunes rejeita links de outro álbum, região, conteúdo ou domínio", () => {
  const id = "401652079";
  for (const url of [
    `https://music.apple.com/br/album/siderado/1`, `https://music.apple.com/us/album/siderado/${id}`,
    `https://music.apple.com/br/artist/skank/${id}`, `http://music.apple.com/br/album/siderado/${id}`,
    `https://music.apple.com.evil.example/br/album/siderado/${id}`, `https://music.apple.com@evil.example/br/album/siderado/${id}`,
    `https://u:p@music.apple.com/br/album/siderado/${id}`, `https://music.apple.com:444/br/album/siderado/${id}`,
    `https://music.apple.com/br/album/siderado/${id}?i=123`, `https://music.apple.com/br/album/siderado/${id}?next=https://evil.example`,
    `https://music.apple.com/br/album/siderado/${id}#other`, `https://itunes.apple.com/br/album/siderado/${id}`,
  ]) {
    assert.equal(isItunesAlbumUrl(url, id), false, url);
    const value = structuredClone(fixture); value.results[0].collectionViewUrl = url;
    assert.throws(() => parseItunesAlbums(value), {code: "invalid-response"});
  }
  assert.equal(isItunesAlbumUrl(`https://music.apple.com/br/album/${id}`, id), true);
});

test("iTunes ignora capas inseguras e datas inválidas sem fabricar variantes", () => {
  for (const image of ["https://mzstatic.com.evil.example/image/a.jpg", "http://is1-ssl.mzstatic.com/image/a.jpg", "https://u:p@is1-ssl.mzstatic.com/image/a.jpg", "https://is1-ssl.mzstatic.com:444/image/a.jpg", "invalid"]) {
    assert.equal(isItunesArtwork(image), false);
    const value = structuredClone(fixture); Object.assign(value.results[0], {artworkUrl60: image, artworkUrl100: image, releaseDate: "invalid"});
    const [album] = parseItunesAlbums(value);
    assert.equal(album.artworkUrl, undefined);
    assert.equal(album.artworkVariants, undefined);
    assert.equal(album.releaseDate, undefined);
  }
});

test("iTunes mantém diferentes edições para escolha e deduplica o mesmo álbum", async () => {
  const album = fixture.results[0];
  const another = {...album, collectionId: 401652080, collectionViewUrl: "https://music.apple.com/br/album/siderado/401652080"};
  const result = await searchAlbums(clientWith({resultCount: 3, results: [album, album, another]}), query);
  assert.equal(result.status, "choose");
  assert.equal(result.candidates.length, 2);
  assert.equal(result.rememberAlbumByDefault, false);
});

test("iTunes atingindo limite mantém escolha mesmo com um álbum único e não inventa continuação", async () => {
  const value = {resultCount: 200, results: Array.from({length: 200}, () => fixture.results[0])};
  const result = await searchAlbums(clientWith(value), query);
  assert.equal(result.status, "choose");
  assert.equal(result.incomplete, true);
  assert.equal(result.nextPage, undefined);
  assert.equal(result.candidates.length, 1);
});

test("iTunes diferencia HTTP, rede e JSON inválido sem encaminhar corpo bruto ao diagnóstico", async () => {
  for (const [status, code] of [[429, "rate-limited"], [401, "unavailable"], [403, "unavailable"], [500, "unavailable"]]) {
    const events = [];
    const client = new ItunesClient(async () => new Response("private-body", {status, headers: {"Retry-After": "30"}}));
    await assert.rejects(client.search(query, undefined, event => events.push(event)), error => {
      assert.equal(error.code, code);
      if (status === 429) assert.equal(error.retryAfterSeconds, 30);
      return true;
    });
    assert.equal(events.at(-1).status, status);
    assert.equal(JSON.stringify(events).includes("private-body"), false);
  }
  await assert.rejects(new ItunesClient(async () => {throw Error("offline");}).search(query), {code: "network"});
  await assert.rejects(new ItunesClient(async () => new Response("html")).search(query), {code: "invalid-response"});
});

test("iTunes respeita cancelamento antes da rede e durante leitura sem retornar resultados antigos", async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(new ItunesClient(async () => assert.fail("não deve consultar")).search(query, before.signal), {code: "cancelled"});
  const during = new AbortController();
  await assert.rejects(new ItunesClient(async () => ({ok: true, status: 200, async json() {during.abort(); return fixture;}})).search(query, during.signal), {code: "cancelled"});
  const failed = new AbortController();
  await assert.rejects(new ItunesClient(async () => {failed.abort(); throw Error("aborted");}).search(query, failed.signal), {code: "cancelled"});
});

test("iTunes rejeita consulta vazia ou excessiva antes da rede", async () => {
  const client = new ItunesClient(async () => assert.fail("não deve consultar"));
  for (const change of [{title: " "}, {title: "a".repeat(201)}, {artist: "a".repeat(201)}]) {
    await assert.rejects(client.search({...query, ...change}), {code: "invalid-query"});
  }
});

const artistFixture = JSON.parse(await readFile(new URL("./fixtures/itunes-artist-albums.json", import.meta.url), "utf8"));
const targetQuery = {...query, title: "Dangerous", artist: "Michael Jackson"};
const empty = {resultCount: 0, results: []};
const artistEntry = (id, name = "Example Artist") => ({wrapperType: "artist", artistId: id, artistName: name});
const albumEntry = (id, artistId, title = "Target", artistName = "Example Artist") => ({...fixture.results[0], collectionId: id, artistId, artistName, collectionName: title, collectionViewUrl: `https://music.apple.com/br/album/${id}`});
const genericQuery = {...query, title: "Target", artist: "Example Artist"};

test("iTunes recupera álbum omitido com ID do artista da própria busca e deduplica", async () => {
  const calls=[],events=[];
  const client=new ItunesClient(async(value,init)=>{
    const url=new URL(value);calls.push(url);
    assert.equal(init.credentials,"omit");assert.equal(init.redirect,"error");
    if(url.pathname==="/lookup") {assert.equal(url.searchParams.get("id"),"32940");assert.equal(url.searchParams.get("country"),"br");return Response.json(artistFixture.lookup);}
    return Response.json(artistFixture.initial);
  });
  const result=await client.search(targetQuery,undefined,event=>events.push(event));
  assert.equal(result.length,2);assert.equal(result.filter(album=>album.id==="322847038").length,1);
  assert.deepEqual(calls.map(url=>url.pathname),["/search","/lookup"]);
  assert.deepEqual(events.filter(e=>e.kind==="request").map(e=>e.stage),["album-search","artist-albums"]);
  assert.equal(events.at(-1).added,1);
  const resolved=await searchAlbums(client,targetQuery);
  assert.equal(resolved.status,"choose");assert.equal(resolved.candidates[0].id,"322847038");
});

test("iTunes identifica artista pela API quando busca inicial não oferece identidade", async () => {
  const urls=[];
  const client=new ItunesClient(async value=>{
    const url=new URL(value);urls.push(url);
    if(url.pathname==="/lookup")return Response.json({resultCount:2,results:[artistEntry(42),albumEntry(400,42)]});
    if(url.searchParams.get("entity")==="musicArtist"){
      assert.equal(url.searchParams.get("term"),"Example Artist");assert.equal(url.searchParams.get("limit"),"25");
      return Response.json({resultCount:2,results:[artistEntry(7,"Other"),artistEntry(42,"Éxample Artist")]});
    }
    return Response.json(empty);
  });
  const resolution=await searchAlbums(client,genericQuery);
  assert.equal(resolution.status,"resolved");assert.equal(resolution.album.id,"400");
  assert.equal(urls.length,3);assert.equal(urls.at(-1).searchParams.get("id"),"42");
});

test("iTunes consulta todos os homônimos identificados e mantém escolha explícita", async () => {
  const consulted=[];
  const client=new ItunesClient(async value=>{
    const url=new URL(value),id=Number(url.searchParams.get("id"));
    if(url.pathname==="/lookup"){consulted.push(id);return Response.json({resultCount:2,results:[artistEntry(id),albumEntry(400+id,id)]});}
    return Response.json(url.searchParams.get("entity")==="musicArtist"?{resultCount:2,results:[artistEntry(42),artistEntry(43)]}:empty);
  });
  const result=await searchAlbums(client,genericQuery);
  assert.deepEqual(consulted,[42,43]);assert.equal(result.status,"choose");assert.equal(result.incomplete,true);assert.match(result.notice,/mesmo nome/);assert.equal(result.candidates.length,2);
});

test("iTunes limita chamadas e não escolhe os primeiros artistas entre muitos homônimos", async () => {
  for(const count of [3,4]){
    let calls=0,lookups=0;
    const client=new ItunesClient(async value=>{
      calls++;const url=new URL(value),id=Number(url.searchParams.get("id"));
      if(url.pathname==="/lookup"){lookups++;return Response.json({resultCount:2,results:[artistEntry(id),albumEntry(400+id,id)]});}
      return Response.json(url.searchParams.get("entity")==="musicArtist"?{resultCount:count,results:Array.from({length:count},(_,i)=>artistEntry(i+1))}:empty);
    });
    const result=await searchAlbums(client,genericQuery);
    assert.ok(calls<=5);assert.equal(lookups,count===3?3:0);assert.equal(result.status,"choose");assert.equal(result.incomplete,true);
  }
});

test("iTunes sem artista ou sem identidade correspondente não inventa consultas de disco", async () => {
  for(const noArtist of [false,true]){
    let calls=0;
    const client=new ItunesClient(async value=>{calls++;const url=new URL(value);return Response.json(url.searchParams.get("entity")==="musicArtist"?{resultCount:1,results:[artistEntry(1,"Different")]}:empty);});
    const result=await searchAlbums(client,{...genericQuery,...(noArtist?{artist:""}:{})});
    assert.equal(result.status,"not-found");assert.equal(calls,noArtist?1:2);
  }
});

test("iTunes preserva candidatos iniciais em falha parcial e registra causa sem corpo bruto", async () => {
  for(const status of [429,500]) {
    const events=[];
    const client=new ItunesClient(async value=>new URL(value).pathname==="/lookup"?new Response("private-body",{status}):Response.json(artistFixture.initial));
    const result=await client.search(targetQuery,undefined,event=>events.push(event));
    assert.equal(result.complete,false);assert.equal(result.candidates.length,1);assert.match(result.notice,/Não foi possível completar/);
    assert.equal(events.find(e=>e.kind==="failure").stage,"artist-albums");assert.equal(events.find(e=>e.kind==="failure").status,status);assert.doesNotMatch(JSON.stringify(events),/private-body/);
  }
  const client=new ItunesClient(async value=>new URL(value).searchParams.get("entity")==="musicArtist"?new Response(null,{status:429}):Response.json(empty));
  assert.equal((await searchAlbums(client,genericQuery)).code,"rate-limited");
});

test("iTunes recusa identidade e álbum inválidos no lookup e preserva resposta válida anterior", async () => {
  for(const patch of [artistEntry(1,"Michael Jackson"),artistEntry(32940,"Other"),{...artistFixture.lookup.results[2],collectionViewUrl:"https://evil.example"}]) {
    const data=structuredClone(artistFixture.lookup);
    data.results[patch.wrapperType==="artist"?0:2]=patch;
    const client=new ItunesClient(async value=>Response.json(new URL(value).pathname==="/lookup"?data:artistFixture.initial));
    const events=[],result=await client.search(targetQuery,undefined,e=>events.push(e));
    assert.equal(result.complete,false);assert.equal(result.candidates.length,1);
    assert.equal(events.find(e=>e.kind==="failure").code,"invalid-response");
  }
});

test("iTunes cacheia complementos validados por dez minutos e expira sem cachear falhas", async t => {
  let now=Date.now(),lookups=0;
  t.mock.method(Date,"now",()=>now);
  const client=new ItunesClient(async value=>{if(new URL(value).pathname==="/lookup"){lookups++;return Response.json(artistFixture.lookup);}return Response.json(artistFixture.initial);});
  await client.search(targetQuery);const events=[];await client.search(targetQuery,undefined,e=>events.push(e));
  assert.equal(lookups,1);assert.ok(events.some(e=>e.kind==="cache"&&e.stage==="artist-albums"));
  now+=10*60*1000+1;await client.search(targetQuery);assert.equal(lookups,2);
  let fail=true,attempts=0;
  const retry=new ItunesClient(async value=>{if(new URL(value).pathname==="/lookup"){attempts++;if(fail)return new Response(null,{status:500});return Response.json(artistFixture.lookup);}return Response.json(artistFixture.initial);});
  await retry.search(targetQuery);fail=false;await retry.search(targetQuery);assert.equal(attempts,2);
});

test("iTunes cancela complemento e não troca cancelamento por resultados antigos", async () => {
  const controller=new AbortController();
  const client=new ItunesClient(async value=>{
    if(new URL(value).pathname==="/lookup"){controller.abort();throw new DOMException("private","AbortError");}
    return Response.json(artistFixture.initial);
  });
  await assert.rejects(client.search(targetQuery,controller.signal),{code:"cancelled"});
});

test("iTunes mede limite de álbuns separado do registro de artista no lookup", async () => {
  const data={resultCount:201,results:[artistEntry(42),...Array.from({length:200},(_,i)=>albumEntry(400+i,42))]};
  const initial={resultCount:1,results:[albumEntry(1,42,"Other")]};
  const client=new ItunesClient(async value=>Response.json(new URL(value).pathname==="/lookup"?data:initial));
  const result=await searchAlbums(client,genericQuery);assert.equal(result.status,"choose");assert.equal(result.incomplete,true);assert.equal(result.candidates.length,201);assert.equal(result.nextPage,undefined);
});

test("iTunes reutiliza identidade e catálogo do artista sem misturar consultas de títulos", async () => {
  let artistCalls=0,lookupCalls=0,initialCalls=0;
  const client=new ItunesClient(async value=>{
    const url=new URL(value);
    if(url.pathname==="/lookup"){lookupCalls++;return Response.json({resultCount:2,results:[artistEntry(42),albumEntry(400,42)]});}
    if(url.searchParams.get("entity")==="musicArtist"){artistCalls++;return Response.json({resultCount:1,results:[artistEntry(42)]});}
    initialCalls++;return Response.json(url.searchParams.get("term").includes("Alias")?{resultCount:1,results:[albumEntry(1,42,"Other","Alias")]}:empty);
  });
  await client.search(genericQuery);
  await client.search({...genericQuery,title:"Different title"});
  assert.equal(initialCalls,2);assert.equal(artistCalls,1);assert.equal(lookupCalls,1);
  const changed=await client.search({...genericQuery,artist:"Alias"});
  assert.equal(lookupCalls,2);assert.equal(changed.complete,false);assert.match(changed.notice,/Não foi possível completar/);
});

test("iTunes limita armazenamento de complementos e não reutiliza identidade removida do cache", async () => {
  let lookups=0;
  const client=new ItunesClient(async value=>{
    const url=new URL(value);
    if(url.pathname==="/lookup"){
      lookups++;const id=Number(url.searchParams.get("id"));return Response.json({resultCount:2,results:[artistEntry(id),albumEntry(1000+id,id,`Target ${id}`)]});
    }
    const id=Number(url.searchParams.get("term").split(' ')[1]);return Response.json({resultCount:1,results:[albumEntry(id,id,"Other")]});
  });
  for(let id=1;id<=65;id++) await client.search({...genericQuery,title:`Target ${id}`});
  assert.equal(lookups,65);await client.search({...genericQuery,title:"Target 1"});assert.equal(lookups,66);
});
