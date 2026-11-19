import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldCopyState,compositionCopySources,hasUnusedCardData} from '../src/albums/field-copy-status.ts';
const discogs={service:'discogs',albumId:'123'},itunes={service:'apple-music',albumId:'456'};
test('marca fonte usada, outra fonte e outro álbum do mesmo serviço sem confundir valores iguais',()=>{
 assert.equal(fieldCopyState(discogs,[],true),'available');
 assert.equal(fieldCopyState(discogs,[discogs],true),'used');
 assert.equal(fieldCopyState(itunes,[discogs],true),'other');
 assert.equal(fieldCopyState({...discogs,albumId:'999'},[discogs],true),'other');
 assert.equal(fieldCopyState(discogs,[discogs],false),'available');
});
test('origem após edição manual e mistura de fontes é preservada; dados do Libib não são atribuídos a serviços',()=>{
 assert.deepEqual(compositionCopySources({kind:'catalog'}),{sources:[],edited:false});
 const source={kind:'streaming',...discogs,albumUrl:'https://www.discogs.com/release/123'};
 assert.equal(compositionCopySources({kind:'manual',basedOn:source}).edited,true);
 assert.deepEqual(compositionCopySources({kind:'manual',basedOn:{kind:'catalog'}}).sources,[]);
 const merged=compositionCopySources({kind:'merged',sources:[discogs,itunes]});
 assert.equal(fieldCopyState(discogs,merged.sources,true),'used');
 assert.equal(fieldCopyState(itunes,merged.sources,true),'used');
 assert.equal(fieldCopyState({service:'deezer',albumId:'7'},merged.sources,true),'other');
});

test('etiqueta considera atributos pendentes globalmente, incluindo extras exclusivos',async()=>{
 const {hasUnusedCardData}=await import('../src/albums/field-copy-status.ts');
 const basic={title:true,artists:true},withTags={...basic,tags:true};
 assert.equal(hasUnusedCardData(basic,[]),true);
 assert.equal(hasUnusedCardData(basic,['title','artists']),false);
 assert.equal(hasUnusedCardData(withTags,['title','artists']),true);
 assert.equal(hasUnusedCardData(withTags,['title','artists','tags']),false);
 // A restauração/desmarcação de um compartilhado volta a sinalizar ambos.
 for(const card of [basic,withTags])assert.equal(hasUnusedCardData(card,['artists','tags']),true);
 // A fonte escolhida e valores distintos não alteram a cobertura por atributo.
 assert.equal(hasUnusedCardData(withTags,['title','artists','tags','description']),false);
 assert.equal(hasUnusedCardData({title:false,artwork:false,description:false},[]),false);
 assert.equal(hasUnusedCardData({},[]),false);
});

test('reconhece somente valores preenchidos do primeiro card, sem alterar o rascunho',async()=>{
 const {matchingCatalogFields}=await import('../src/albums/field-copy-status.ts');
 const original={title:'Disco',artists:'Primeiro, Segundo',tags:'rock, pop',ean:'0123456789012',notes:'Nota\r\nOriginal',empty:''};
 const offered={title:'Disco',artists:['Primeiro','Segundo'],tags:'rock,pop',ean:'0123456789012',notes:'Nota\nOriginal',empty:'',missing:'Novo'};
 const matches=matchingCatalogFields(discogs,offered,original,original);
 assert.deepEqual(Object.keys(matches),['title','artists','tags','ean','notes']);
 assert.equal(fieldCopyState(discogs,[matches.title],true),'used');
 assert.equal(fieldCopyState(itunes,[matches.title],true),'other');
 assert.equal(hasUnusedCardData({title:true,artists:true},Object.keys(matches)),false);
 assert.deepEqual(matchingCatalogFields(undefined,offered,original,original),{});
 assert.deepEqual(matchingCatalogFields(discogs,offered,{},{}),{});
 assert.equal(matchingCatalogFields(discogs,{title:'Outro'},original,original).title,undefined);
 assert.equal(matchingCatalogFields(discogs,offered,original,{...original,title:'Editado'}).title,undefined);
 assert.equal(matchingCatalogFields(discogs,{ean:'123456789012'},original,original).ean,undefined,'não remover zeros de códigos');
 const {AlbumComposition}=await import('../src/albums/album-composition.ts');
 const model=new AlbumComposition({title:'Disco',artists:['Primeiro','Segundo']});
 const candidate={service:'discogs',id:'123',url:'https://www.discogs.com/release/123',title:'Disco',artists:[{id:'1',name:'Primeiro'},{id:'2',name:'Segundo'}]};
 model.addAlbum(candidate);matchingCatalogFields(discogs,offered,original,original);
 assert.deepEqual(model.changes(),{});assert.equal(model.snapshot().fields.title.included,false);model.dispose();
});

test('cada atributo reconhece a primeira fonte igual ao Libib mesmo após fontes ausentes ou diferentes',async()=>{
 const {matchingCatalogSources}=await import('../src/albums/field-copy-status.ts');
 const youtube={service:'youtube-music',albumId:'MPREdemo'};
 const deezer={service:'deezer',albumId:'456'};
 const publisher='ST2 Records, Eagle Records, Montreux Sounds';
 const original={title:'Disco',publisher,tags:'rock',notes:''};
 const cards=[{source:youtube,values:{title:'Disco'}},
  {source:itunes,values:{title:'Outro',publisher:'Eagle Records'}},
  {source:discogs,values:{title:'Disco',publisher,tags:'rock',notes:''}},
  {source:deezer,values:{title:'Disco',publisher,tags:'rock'}}];
 const matches=matchingCatalogSources(cards,original,original);
 assert.deepEqual(matches,{title:youtube,publisher:discogs,tags:discogs});
 assert.equal(fieldCopyState(discogs,[matches.publisher],true),'used');
 assert.equal(fieldCopyState(itunes,[matches.publisher],true),'other');
 assert.equal(hasUnusedCardData({publisher:true},Object.keys(matches)),false);
 assert.equal(matchingCatalogSources(cards,original,{...original,publisher:'Editado'}).publisher,undefined);
 assert.equal(matchingCatalogSources(cards.filter(card=>card.source!==discogs),original,original).publisher,deezer);
 assert.equal(matchingCatalogSources([...cards].reverse(),original,original).publisher,deezer,'ordem de inclusão resolve empate');
 assert.deepEqual(matchingCatalogSources(cards,{},{}),{});
});

test('ação de pendentes segue o mesmo estado do botão individual',async()=>{
 const {copyButtonState}=await import('../src/albums/field-copy-status.ts');
 assert.equal(copyButtonState(discogs,[],false),'available');
 assert.equal(copyButtonState(discogs,[discogs],true),'used');
 assert.equal(copyButtonState(discogs,[itunes],true),'other');
 assert.equal(copyButtonState(discogs,[],false,discogs),'used');
 assert.equal(copyButtonState(discogs,[],false,itunes),'other');
 assert.equal(copyButtonState(discogs,[],true),'available','edição manual sem fonte mantém +');
 assert.equal(copyButtonState(discogs,[discogs],false),'available','desmarcado volta a ficar pendente');
 assert.equal(copyButtonState(discogs,[itunes],true,discogs),'other','cópia explícita prevalece sobre correspondência');
});
