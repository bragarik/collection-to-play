import test from 'node:test';
import assert from 'node:assert/strict';
import {readLibibItemFields, readLibibQuickEditFieldKeys, prepareLibibItemFields, validateLibibReleaseDate, libibItemFieldContext} from '../src/libib/libib-item-fields.ts';

function setup() {
 const controls = new Map();
 const form = {querySelectorAll(selector) {return controls.get(selector.match(/name="([^"]+)"/)?.[1]) ?? [];}};
 const add = (name, value = '', changes = {}) => {
  const control = {tagName:'INPUT',type:'text',isConnected:true,form,disabled:false,readOnly:false,
   classList:{contains:()=>false},value,maxLength:-1,...changes};
  controls.set(name,[control]);
  return control;
 };
 return {form,controls,add};
}

test('reconhece somente extras presentes, únicos e editáveis do formulário e filtra por mídia',()=>{
 const v=setup();
 const publisher=v.add('publisher','Columbia'),notes=v.add('notes','Minha edição',{tagName:'TEXTAREA'});
 v.add('ensemble','Ator');v.add('aspect_ratio','1.33:1');v.add('join_id','101');v.add('title_override','Meu título');
 const hiddenTab=v.add('group','Coleção',{getClientRects:()=>[]});
 const music=readLibibItemFields(v.form,'music');
 assert.deepEqual([...music.keys()],['publisher','group','notes']);
 assert.equal(music.get('publisher'),publisher);assert.equal(music.get('notes'),notes);assert.equal(music.get('group'),hiddenTab);
 const movie=readLibibItemFields(v.form,'movie');
 assert.equal(movie.has('ensemble'),true);assert.equal(movie.has('aspect_ratio'),true);
 assert.equal(movie.has('join_id'),false);assert.equal(movie.has('title_override'),false);
 for(const changes of [{disabled:true},{readOnly:true},{isConnected:false},{form:{}},{type:'hidden'},{tagName:'SELECT'},
  {classList:{contains:name=>name==='no-post'}},{matches:selector=>selector===':disabled'}]) {
  const item=setup();item.add('publisher','',changes);
  assert.equal(readLibibItemFields(item.form,'music').has('publisher'),false);
 }
 v.controls.get('publisher').push({...publisher});
 assert.equal(readLibibItemFields(v.form,'music').has('publisher'),false);
});

test('menu rápido oferece apenas chaves conhecidas e explícitas compatíveis com a mídia',()=>{
 const entries=new Map(['publisher','ensemble','publish_year','notes','join_id'].map(key=>[key,[{isConnected:true,getAttribute:()=>null}]]));
 const root={querySelectorAll(selector){return entries.get(selector.match(/data-key="([^"]+)"/)?.[1])??[];}};
 assert.deepEqual(readLibibQuickEditFieldKeys(root,'music'),['publisher','publish_year','notes']);
 assert.equal(readLibibQuickEditFieldKeys(root,'movie').includes('ensemble'),true);
 entries.set('publisher',[{isConnected:true,getAttribute:()=>null},{isConnected:true,getAttribute:()=>null}]);
 entries.set('notes',[{isConnected:false,getAttribute:()=>null}]);
 entries.set('publish_year',[{isConnected:true,getAttribute:()=> 'true'}]);
 assert.deepEqual(readLibibQuickEditFieldKeys(root,'music'),[]);
});

test('prepara substituição do mesmo atributo sem mutar campos ou apagar dados não selecionados',()=>{
 const v=setup(),publisher=v.add('publisher','Gravadora anterior'),notes=v.add('notes','Minha anotação');
 const fields=readLibibItemFields(v.form,'music');
 const prepared=prepareLibibItemFields(fields,{publisher:'Gravadora do Discogs'});
 assert.deepEqual([...prepared],[[publisher,'Gravadora do Discogs']]);
 assert.equal(publisher.value,'Gravadora anterior');assert.equal(notes.value,'Minha anotação');
 assert.equal(prepareLibibItemFields(fields,{publisher:''}).get(publisher),'');
 for(const patch of [{publisher:42},{publisher:'a'.repeat(256)},{join_id:'102'},{ensemble:'Ator'},null,[]]) {
  assert.throws(()=>prepareLibibItemFields(fields,patch));
  assert.equal(publisher.value,'Gravadora anterior');
 }
 publisher.maxLength=4;
 assert.throws(()=>prepareLibibItemFields(fields,{publisher:'Muito longo'}),/4 caracteres/);
});

test('data alterada valida a combinação com os componentes atuais preservados',()=>{
 const v=setup(),year=v.add('publish_year','2024'),month=v.add('publish_month','02'),day=v.add('publish_day','29');
 const fields=readLibibItemFields(v.form,'music');
 assert.throws(()=>prepareLibibItemFields(fields,{publish_year:'2025'}),/Data de lançamento inválida/);
 assert.equal(year.value,'2024');assert.equal(day.value,'29');
 assert.deepEqual([...prepareLibibItemFields(fields,{publish_year:'2025',publish_day:'28'})],[[year,'2025'],[day,'28']]);
 assert.throws(()=>prepareLibibItemFields(fields,{publish_month:''}),/Preencha ano e mês/);
 assert.throws(()=>prepareLibibItemFields(fields,{publish_year:'0000'}),/data de lançamento/);
 assert.equal(month.value,'02');
});

test('calendário aceita datas parciais e anos abaixo de cem sem normalização de século',()=>{
 for(const parts of [['','',''],['1998','',''],['1998','06',''],['2000','02','29'],['0096','02','29']])
  assert.doesNotThrow(()=>validateLibibReleaseDate(...parts));
 for(const parts of [['','06',''],['1998','','22'],['1900','02','29'],['0099','02','29'],['1998','04','31'],['0000','',''],['1998','13',''],['1998','06','0']])
  assert.throws(()=>validateLibibReleaseDate(...parts));
});

test('campo não relacionado pode ser preparado sem exigir correção de data antiga não selecionada',()=>{
 const v=setup(),publisher=v.add('publisher',''),year=v.add('publish_year',''),month=v.add('publish_month','12');
 const fields=readLibibItemFields(v.form,'music');
 assert.deepEqual([...prepareLibibItemFields(fields,{publisher:'Columbia'})],[[publisher,'Columbia']]);
 assert.equal(year.value,'');assert.equal(month.value,'12');
});
test('contexto para o modal inclui somente extras reconhecidos, valores e menor limite nativo',()=>{
 const v=setup();v.add('publisher','Columbia',{maxLength:40});v.add('notes','Nota do exemplar');v.add('join_id','Privado');
 const context=libibItemFieldContext(readLibibItemFields(v.form,'music'));
 assert.deepEqual(context,{manualFields:['publisher','notes'],manualValues:{publisher:'Columbia',notes:'Nota do exemplar'},manualLimits:{publisher:40,notes:52000}});
 assert.doesNotMatch(JSON.stringify(context),/Privado|join_id/);
 assert.doesNotThrow(()=>structuredClone(context));
});
