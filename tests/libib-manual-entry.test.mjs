import test from 'node:test';
import assert from 'node:assert/strict';
import {readLibibManualEntry, fillLibibManualEntry} from '../src/libib/libib-manual-entry.ts';
import {MOVIE_MANUAL_FIELDS} from '../src/shared/manual-entry-fields.ts';

function setup(media="movie") {
 const controls=new Map();
 const collection={value:'123'};
 const type={value:media};
 const document={defaultView:{location:{href:'https://www.libib.com/library',origin:'https://www.libib.com'}}};
 const form={id:'manual-entry-form',method:'post',action:'https://www.libib.com/library/manual-entry/submit',isConnected:true,
  ownerDocument:document,getClientRects:()=>[1],querySelector(selector){
    if(selector.includes('library-select'))return collection;
    if(selector.includes('manual-entry-type'))return type;
    const name=selector.match(/name="([^"]+)"/)?.[1];
    return controls.get(name);
  },
  querySelectorAll(selector){const name=selector.match(/name="([^"]+)"/)?.[1];return controls.has(name)?[controls.get(name)]:[];}};
 for(const name of ['title','creators','description','image',...MOVIE_MANUAL_FIELDS.map(field=>field.key)]){
  controls.set(name,{value:name==='description'?'Descrição original':'',type:name==='image'?'file':'text',tagName:name==='description'||name==='notes'?'TEXTAREA':'INPUT',disabled:false,readOnly:false,isConnected:true,classList:{contains:()=>false},form,maxLength:-1});
 }
 if(media==='music'){controls.delete('ensemble');controls.delete('aspect_ratio');}
 return {form,controls,collection,type};
}
test('reconhece apenas inclusão movie com controles de filme carregados',()=>{
 const v=setup();
 assert.equal(readLibibManualEntry(v.form).collection,'123');
 v.type.value='music';assert.equal(readLibibManualEntry(v.form),undefined);
 v.type.value='movie';v.controls.delete('ensemble');assert.equal(readLibibManualEntry(v.form),undefined);
});
test('preenche apenas campos selecionados sem submeter formulário ou mudar coleção',async()=>{
 const v=setup();v.controls.get('notes').value='Minhas notas';v.controls.get('ean_isbn13').value='7898285415687';
 await fillLibibManualEntry(readLibibManualEntry(v.form),{title:'Secret World Live',directors:['François Girard'],ensemble:'Peter Gabriel',publish_year:'1994',publish_month:'9',publish_day:'1',length_of:'132'},undefined,()=>true);
 assert.equal(v.controls.get('title').value,'Secret World Live');
 assert.equal(v.controls.get('creators').value,'François Girard');
 assert.equal(v.controls.get('notes').value,'Minhas notas');
 assert.equal(v.controls.get('ean_isbn13').value,'7898285415687');
 assert.equal(v.collection.value,'123');
});
test('trocar coleção, mídia ou controles invalida contexto antes de preencher',async()=>{
 for(const mutate of [v=>v.collection.value='456',v=>v.type.value='videogame',v=>v.controls.set('title',{...v.controls.get('title')})]){
  const v=setup(),context=readLibibManualEntry(v.form);mutate(v);
  await assert.rejects(fillLibibManualEntry(context,{title:'Novo'},undefined,()=>true));
  assert.equal(v.controls.get('title').value,'');
 }
});
test('valida limites, campos e data antes de alterar valores',async()=>{
 for(const patch of [{title:'Novo',publisher:'a'.repeat(256)},{title:'Novo',publish_month:'13'},{title:'Novo',publish_year:'2025',publish_month:'2',publish_day:'30'},{title:'Novo',maisc:'indevido'},{title:'Novo',length_of:'abc'}]){
  const v=setup();
  await assert.rejects(fillLibibManualEntry(readLibibManualEntry(v.form),patch,undefined,()=>true));
  assert.equal(v.controls.get('title').value,'');
 }
});
test('descrição exige confirmação e valor original correspondente',async()=>{
 const v=setup(),context=readLibibManualEntry(v.form);
 await assert.rejects(fillLibibManualEntry(context,{description:'Nova'},undefined,()=>true));
 await assert.rejects(fillLibibManualEntry(context,{description:'Nova'},{confirmed:true,expected:'Outra'},()=>true));
 await fillLibibManualEntry(context,{description:'Nova'},{confirmed:true,expected:'Descrição original'},()=>true);
 assert.equal(v.controls.get('description').value,'Nova');
});

test('inclusão de música preenche artistas e extras preservando a coleção e os campos não selecionados',async()=>{
 const v=setup('music'),context=readLibibManualEntry(v.form);
 assert.equal(context.media,'music');
 v.controls.get('notes').value='Exemplar brasileiro';
 await fillLibibManualEntry(context,{title:'Siderado',artists:['Skank'],publisher:'Columbia',publish_year:'1998',ean_isbn13:'5099749207127',length_of:'47'},undefined,()=>true);
 assert.equal(v.controls.get('creators').value,'Skank');
 assert.equal(v.controls.get('publisher').value,'Columbia');
 assert.equal(v.controls.get('ean_isbn13').value,'5099749207127');
 assert.equal(v.controls.get('notes').value,'Exemplar brasileiro');
 assert.equal(v.collection.value,'123');
});
test('campos exclusivos de vídeo e diretores são recusados na inclusão de música',async()=>{
 for(const patch of [{title:'Novo',directors:['Diretor']},{title:'Novo',ensemble:'Ator'},{title:'Novo',aspect_ratio:'1.33:1'}]){
  const v=setup('music');
  await assert.rejects(fillLibibManualEntry(readLibibManualEntry(v.form),patch,undefined,()=>true));
  assert.equal(v.controls.get('title').value,'');
 }
});
test('trocar apenas o rádio antes dos campos carregarem não reconhece a mídia errada',()=>{
 const v=setup();
 v.type.value='music';
 assert.equal(readLibibManualEntry(v.form),undefined);
 const music=setup('music');
 music.type.value='movie';
 assert.equal(readLibibManualEntry(music.form),undefined);
});
test('validação compartilhada preserva dados não escolhidos e recusa data inválida antes de preencher',async()=>{
 const v=setup('music');
 v.controls.get('publish_year').value='2024';v.controls.get('publish_month').value='02';v.controls.get('publish_day').value='29';
 const context=readLibibManualEntry(v.form);
 await assert.rejects(fillLibibManualEntry(context,{publisher:'Outra',publish_year:'2025'},undefined,()=>true),/Data de lançamento inválida/);
 assert.equal(v.controls.get('publisher').value,'');
 await fillLibibManualEntry(context,{publisher:'Discogs',publish_year:'2025',publish_day:'28'},undefined,()=>true);
 assert.equal(v.controls.get('publisher').value,'Discogs');assert.equal(v.controls.get('publish_month').value,'02');
 v.controls.get('publish_year').value='';
 await fillLibibManualEntry(context,{publisher:'Outro serviço'},undefined,()=>true);
 assert.equal(v.controls.get('publisher').value,'Outro serviço');
 assert.equal(v.controls.get('publish_year').value,'');assert.equal(v.controls.get('publish_month').value,'02');
});
