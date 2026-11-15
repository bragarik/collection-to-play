import test from 'node:test';
import assert from 'node:assert/strict';
import {readLibibFullEditor,fillLibibFullEditor} from '../src/libib/libib-full-editor.ts';
const url='https://www.libib.com/library';
function setup(){
 const title={type:'text',value:'Título antigo',disabled:false,readOnly:false};
 const creators={type:'text',value:'Artista antigo',disabled:false,readOnly:false};
 const join={value:'101'};
 const untouched={title_override:'Ordenação editada',description:'Descrição em edição',price:'12.50',tags:'tags novas',group:'grupo novo',notes:'notas novas',image:{name:'capa-escolhida.jpg'}};
 const cards=[{dataset:{joinId:'101'},classList:{contains:value=>value==='music'}}];
 const media=[{textContent:'Music'}];
 const document={defaultView:{getComputedStyle:()=>({visibility:'visible'})},querySelectorAll:()=>cards};
 let action='/library/edit-item/submit';
 const form={id:'edit-item-form',isConnected:true,getClientRects:()=>[1],method:'post',parentElement:{id:'edit-item-details'},ownerDocument:document,
  getAttribute:()=>action,querySelector:selector=>selector.includes('join_id')?join:selector.includes('"title"')?title:selector.includes('"creators"')?creators:undefined,
  closest:()=>({querySelectorAll:()=>media})};
 return {form,document,title,creators,join,cards,media,untouched,set action(value){action=value;}};
}
const metadata={title:'Título do streaming',artists:['Artista A','Artista B']};

test('identifica a edição completa musical pelo formulário, endpoint e item',()=>{
 const value=setup();const context=readLibibFullEditor(value.form,url);
 assert.equal(context.joinId,'101');assert.equal(context.title,value.title);assert.equal(context.creators,value.creators);
});
test('preenche somente título e artista, preservando outros campos e arquivo escolhido',()=>{
 const value=setup(),before=structuredClone(value.untouched);
 const context=readLibibFullEditor(value.form,url);fillLibibFullEditor(context,url,metadata);
 assert.equal(value.title.value,'Título do streaming');assert.equal(value.creators.value,'Artista A, Artista B');
 assert.deepEqual(value.untouched,before);assert.equal(value.join.value,'101');
});
test('recusa contexto diferente, formulário fechado, outro endpoint ou campos bloqueados',()=>{
 for(const mutate of [v=>{v.form.id='other';},v=>{v.form.parentElement.id='other';},v=>{v.form.method='get';},v=>{v.form.isConnected=false;},v=>{v.form.getClientRects=()=>[];},v=>{v.action='https://evil.test/library/edit-item/submit';},v=>{v.action='/other';},v=>{v.title.disabled=true;},v=>{v.creators.readOnly=true;},v=>{v.join.value='../1';}]){
  const value=setup();mutate(value);assert.equal(readLibibFullEditor(value.form,url),undefined);
 }
 assert.equal(readLibibFullEditor(setup().form,'https://evil.test/library'),undefined);
});
test('não oferece a ação para livro, mesmo se houver etiqueta musical antiga nos detalhes',()=>{
 const value=setup();value.cards[0].classList.contains=()=>false;
 assert.equal(readLibibFullEditor(value.form,url),undefined);
});
test('sem item visível na listagem, usa a classificação musical dos detalhes',()=>{
 const value=setup();value.cards.length=0;
 assert.equal(readLibibFullEditor(value.form,url).joinId,'101');
 value.media[0].textContent='Book';assert.equal(readLibibFullEditor(value.form,url),undefined);
});
test('troca do item durante a busca impede preencher o formulário novo',()=>{
 const value=setup();const context=readLibibFullEditor(value.form,url);value.join.value='303';
 assert.throws(()=>fillLibibFullEditor(context,url,metadata),/edição mudou/);
 assert.equal(value.title.value,'Título antigo');assert.equal(value.creators.value,'Artista antigo');
});
test('troca dos inputs ou fechamento antes da resposta impede preenchimento atrasado',()=>{
 for(const mutate of [v=>{v.form.isConnected=false;},v=>{const read=v.form.querySelector;v.form.querySelector=s=>s.includes('"title"')?{...v.title}:read(s);}]){
  const value=setup(),context=readLibibFullEditor(value.form,url);mutate(value);
  assert.throws(()=>fillLibibFullEditor(context,url,metadata),/edição mudou/);assert.equal(value.title.value,'Título antigo');
 }
});
test('metadados inválidos são recusados antes de alterar os dois campos',()=>{
 for(const metadata of [{title:'',artists:['Artista']},{title:'Válido',artists:[]},{title:'Válido',artists:['Nome, Sobrenome']}]){
  const value=setup(),context=readLibibFullEditor(value.form,url);
  assert.throws(()=>fillLibibFullEditor(context,url,metadata));assert.equal(value.title.value,'Título antigo');assert.equal(value.creators.value,'Artista antigo');
 }
});

function selectiveSetup(){
 const value=setup();
 const previous=new File([Uint8Array.from([1,2,3])],'existing.jpg',{type:'image/jpeg'});
 const image={type:'file',disabled:false,isConnected:true,form:value.form,classList:{contains:()=>false},files:[previous]};
 const query=value.form.querySelector;let images=[image];
 value.form.querySelector=selector=>selector.includes('"image"')?images[0]:query(selector);
 value.form.querySelectorAll=selector=>selector.includes('"image"')?images:[];
 value.document.defaultView.DataTransfer=class{constructor(){this.files=[];this.items={add:file=>{this.files.push(file);}};}};
 return {...value,image,get images(){return images;},set images(items){images=items;}};
}
const pngFile=()=>new File([Uint8Array.from([137,80,78,71,13,10,26,10,1])],'streaming.png',{type:'image/png'});
const decode=async()=>({width:320,height:300,close(){}});
const patchContext=value=>readLibibFullEditor(value.form,url);

test('preenchimento seletivo muda só o título e não consulta nem altera FileList',async()=>{
 const {fillLibibFullEditorPatch}=await import('../src/libib/libib-full-editor.ts');const v=selectiveSetup(),files=v.image.files;
 v.form.querySelectorAll=()=>{throw Error('Imagem não escolhida');};
 await fillLibibFullEditorPatch(patchContext(v),url,{title:' Novo título '});
 assert.equal(v.title.value,'Novo título');assert.equal(v.creators.value,'Artista antigo');assert.equal(v.image.files,files);
});
test('somente artistas não exige título preenchido nem altera a ordenação e a capa',async()=>{
 const {fillLibibFullEditorPatch}=await import('../src/libib/libib-full-editor.ts');const v=selectiveSetup(),files=v.image.files,before=structuredClone(v.untouched);v.title.value='';
 await fillLibibFullEditorPatch(patchContext(v),url,{artists:['Artista A','Artista B']});
 assert.equal(v.title.value,'');assert.equal(v.creators.value,'Artista A, Artista B');assert.deepEqual(v.untouched,before);assert.equal(v.image.files,files);
});
test('somente capa preenche FileList sem validar ou mudar os textos não escolhidos',async()=>{
 const {fillLibibFullEditorPatch}=await import('../src/libib/libib-full-editor.ts');const v=selectiveSetup(),file=pngFile();v.title.value='';v.creators.value='Nome, Sobrenome';const before=structuredClone(v.untouched);
 await fillLibibFullEditorPatch(patchContext(v),url,{artwork:file},{decode});
 assert.equal(v.image.files.length,1);assert.equal(v.image.files[0],file);assert.equal(v.title.value,'');assert.equal(v.creators.value,'Nome, Sobrenome');assert.deepEqual(v.untouched,before);
});
test('validação completa antecede qualquer mudança quando a capa ou artistas são inválidos',async()=>{
 const {fillLibibFullEditorPatch}=await import('../src/libib/libib-full-editor.ts');
 for(const patch of [{title:'Novo',artwork:new File(['<html>invalid</html>'],'bad.png')},{title:'Novo',artists:['Nome, Sobrenome'],artwork:pngFile()},
  {title:'',artwork:pngFile()},{title:'Novo',artwork:new File([],'empty.png')},{title:'Novo',artwork:new File([new Uint8Array(20000001)],'large.png')}]){
  const v=selectiveSetup(),files=v.image.files;await assert.rejects(fillLibibFullEditorPatch(patchContext(v),url,patch,{decode}));
  assert.equal(v.title.value,'Título antigo');assert.equal(v.creators.value,'Artista antigo');assert.equal(v.image.files,files);
 }
});
test('campo de imagem ausente, duplicado, bloqueado ou ignorado pelo postForm recusa todo o patch',async()=>{
 const {fillLibibFullEditorPatch}=await import('../src/libib/libib-full-editor.ts');
 for(const mutate of [v=>{v.images=[];},v=>{v.images=[v.image,v.image];},v=>{v.image.disabled=true;},v=>{v.image.type='text';},v=>{v.image.classList.contains=()=>true;},v=>{v.image.form={};}]){
  const v=selectiveSetup(),files=v.image.files;mutate(v);await assert.rejects(fillLibibFullEditorPatch(patchContext(v),url,{title:'Novo',artwork:pngFile()},{decode}));
  assert.equal(v.title.value,'Título antigo');assert.equal(v.image.files,files);
 }
});
test('mudança de item, input de imagem ou cancelamento durante decodificação impede preenchimento tardio',async()=>{
 const {fillLibibFullEditorPatch}=await import('../src/libib/libib-full-editor.ts');
 for(const change of ['item','input','cancel','ignored']){
  const v=selectiveSetup(),files=v.image.files,controller=new AbortController();let closed=false;
  const context=patchContext(v);
  await assert.rejects(fillLibibFullEditorPatch(context,url,{title:'Novo',artwork:pngFile()},{signal:controller.signal,decode:async()=>{
   if(change==='item')v.join.value='303';if(change==='input')v.images=[{...v.image}];if(change==='cancel')controller.abort();if(change==='ignored')v.image.classList.contains=()=>true;
   return {width:320,height:300,close(){closed=true;}};
  }}));
  assert.equal(closed,true);assert.equal(v.title.value,'Título antigo');assert.equal(v.image.files,files);
 }
});
test('falha ao atribuir FileList e navegador sem DataTransfer preservam todos os campos',async()=>{
 const {fillLibibFullEditorPatch}=await import('../src/libib/libib-full-editor.ts');
 for(const blocked of [true,false]){
  const v=selectiveSetup(),files=v.image.files;if(blocked)Object.defineProperty(v.image,'files',{get:()=>files,set(){throw Error('blocked');}});else delete v.document.defaultView.DataTransfer;
  await assert.rejects(fillLibibFullEditorPatch(patchContext(v),url,{title:'Novo',artists:['Novo artista'],artwork:pngFile()},{decode}));
  assert.equal(v.title.value,'Título antigo');assert.equal(v.creators.value,'Artista antigo');assert.equal(v.image.files,files);
 }
});
test('patch vazio, campos desconhecidos e contexto encerrado são recusados sem alterações',async()=>{
 const {fillLibibFullEditorPatch}=await import('../src/libib/libib-full-editor.ts');
 for(const patch of [null,[],{}, {description:'Outro'}, {title:undefined},{artists:[]}]){
  const v=selectiveSetup();await assert.rejects(fillLibibFullEditorPatch(patchContext(v),url,patch,{decode}));assert.equal(v.title.value,'Título antigo');
 }
 const v=selectiveSetup();await assert.rejects(fillLibibFullEditorPatch(patchContext(v),url,{title:'Novo'},{isCurrent:()=>false}),/edição mudou/);
});
test('arquivo corrompido ou dimensões inválidas não altera texto escolhido junto da capa',async()=>{
 const {fillLibibFullEditorPatch}=await import('../src/libib/libib-full-editor.ts');
 for(const check of [async()=>{throw Error('decode');},async()=>({width:0,height:1,close(){}})]){
  const v=selectiveSetup(),files=v.image.files;await assert.rejects(fillLibibFullEditorPatch(patchContext(v),url,{title:'Novo',artwork:pngFile()},{decode:check}));
  assert.equal(v.title.value,'Título antigo');assert.equal(v.image.files,files);
 }
});
