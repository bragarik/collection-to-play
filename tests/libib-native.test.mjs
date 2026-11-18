import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNativeSaveRequest,isNativeSaveOutcome,saveLibibNativeField,registerLibibNativeBridge} from '../src/libib/libib-native.ts';
import {isLibibApplyResult,describeLibibApplyResult} from '../src/libib/libib-metadata.ts';

const request={joinId:'101',libraryId:'202',field:'title',value:'Novo título',titleOverride:'Ordenação'};
const classes=()=>{const values=new Set();return {add:x=>values.add(x),remove:x=>values.delete(x),contains:x=>values.has(x)};};
function setup({outcome='success',status=200,hold=false,raw,unrelated=false,noHandler=false,description,descriptionMaxLength=5000,media="music"}={}){
 const handlers=new Map(),bodies=[];let selected,inputs=[],privateSaved;const privateItem={title:'Anterior',creators:['Anterior'],title_override:'Ordenação',...(description!==undefined?{description}:{})};
 const imageField={kind:'field',field:'image'},titleField={kind:'field',field:'title'},creatorField={kind:'field',field:'creators'},save={kind:'save',disabled:false,classList:classes()},close={classList:classes()};
 const form={querySelector:s=>inputs.find(input=>s.includes('"'+input.name+'"')),querySelectorAll:s=>s.includes('button')?[...inputs,save]:s.includes('input[name=')?inputs.filter(input=>s.includes('"'+input.name+'"')):inputs};
 const root={isConnected:true,dataset:{joinId:'101',libraryId:'202',itemType:media},getClientRects:()=>[1],
  querySelector:s=>s==='#quick-edit-form'?form:s==='#jump-cover-save'?save:s.includes('data-key="title"')?titleField:s.includes('data-key="creators"')?creatorField:s.includes('data-key="image"')?imageField:s.includes('data-key="description"')&&description!==undefined?{kind:'field',field:'description'}:undefined,
  querySelectorAll:()=>close.classList.contains('disabled')?[close]:[]};
 const roots=[root],listeners=new Map(),replies=[];
 const document={querySelectorAll:()=>roots,defaultView:{getComputedStyle:()=>({visibility:'visible'}),DataTransfer:class {items={add:file=>this.files.push(file)};files=[];}}};
 const page={document,location:{href:'https://www.libib.com/library',origin:'https://www.libib.com'},addEventListener:(name,fn)=>listeners.set(name,fn),postMessage:value=>replies.push(value)};
 const emit=(name,xhr,settings)=>{for(const [event,fn] of [...handlers])if(event.startsWith(name+'.'))fn({},xhr,settings);};
 let capturedXHR,completion;
 const jquery=target=>({
  data:key=>({'join-id':root.dataset.joinId,'library-id':root.dataset.libraryId,'item-type':root.dataset.itemType})[key],
  on:(event,fn)=>{handlers.set(event,fn);},off:namespace=>{for(const event of handlers.keys())if(event.endsWith(namespace))handlers.delete(event);},
  trigger:()=>{
   if(target.kind==='field'){
    selected=target.field;inputs=[{name:selected,value:String(privateItem[selected]),disabled:false,...(selected==='description'?{tagName:'TEXTAREA',type:'textarea',readOnly:false,maxLength:descriptionMaxLength}:{})}];
    if(selected==='image')inputs=[{name:'image',type:'file',disabled:false,isConnected:true,form,classList:classes(),files:[]}];
    if(selected==='title')inputs.push({name:'title_override',value:privateItem.title_override,disabled:false});return;
   }
   if(target.kind!=='save'||noHandler)return;
   const data=new FormData();data.set('join_id','101');data.set('library_id','202');data.set('item_type',media);for(const input of inputs)if(input.type==='file')data.set('image-0',input.files[0]);else data.set(input.name,input.value.trim());
   const settings={url:'/quickedit/update-field/submit',type:'POST',data};bodies.push(Object.fromEntries(data));
   const xhr={status,responseText:raw??JSON.stringify({outcome}),abort(){this.status=0;emit('ajaxComplete',this,settings);}};capturedXHR=xhr;
   for(const input of inputs)input.disabled=true;save.disabled=true;save.classList.add('loading');close.classList.add('disabled');
   if(unrelated)emit('ajaxSend',{status:200,responseText:'{}'}, {...settings,url:'/another-endpoint'});
   emit('ajaxSend',xhr,settings);
   completion=()=>{if(status>=200&&status<300&&outcome==='success'&&raw===undefined){privateSaved=true;for(const input of inputs)if(input.type!=='file')privateItem[input.name]=input.value.trim();for(const input of inputs)input.disabled=false;save.disabled=false;save.classList.remove('loading');close.classList.remove('disabled');}emit('ajaxComplete',xhr,settings);};
   if(!hold)queueMicrotask(completion);
  }
 });
 return {page,jquery,root,roots,get inputs(){return inputs;},save,close,handlers,bodies,replies,listeners,snapshot:()=>({item:structuredClone(privateItem),saved:privateSaved}),complete:()=>completion(),get xhr(){return capturedXHR;}};
}
const signal=()=>new AbortController().signal;

test('usa o handler nativo uma vez e confirma após o cache privado ser atualizado',async()=>{
 const value=setup({unrelated:true});
 const result=await saveLibibNativeField(value.page,value.jquery,request,signal());
 assert.deepEqual(result,{confirmed:true,writeMayHaveOccurred:true,httpStatus:200});
 assert.deepEqual(value.bodies,[{join_id:'101',library_id:'202',item_type:'music',title:'Novo título',title_override:'Ordenação'}]);
 assert.deepEqual(value.snapshot(),{item:{title:'Novo título',creators:['Anterior'],title_override:'Ordenação'},saved:true});
 assert.equal(value.handlers.size,0);
});
test('artistas usam o mesmo handler e preservam o título e ordenação',async()=>{
 const value=setup();
 const result=await saveLibibNativeField(value.page,value.jquery,{joinId:'101',libraryId:'202',field:'creators',value:'Artista A, Artista B'},signal());
 assert.equal(result.confirmed,true);assert.equal(value.bodies[0].creators,'Artista A, Artista B');assert.equal(value.bodies[0].title,undefined);
 assert.equal(value.snapshot().item.title,'Anterior');assert.equal(value.snapshot().saved,true);
});
test('valida o contrato do campo e rejeita IDs, ordenação e valores inválidos antes de salvar',async()=>{
 for(const input of [null,{}, {...request,joinId:'../1'}, {...request,field:'notes'}, {...request,value:''}, {...request,value:'a'.repeat(513)}, {...request,titleOverride:null}]){
  assert.equal(parseNativeSaveRequest(input),undefined);const value=setup();assert.equal((await saveLibibNativeField(value.page,value.jquery,input,signal())).writeMayHaveOccurred,false);assert.equal(value.bodies.length,0);
 }
});
test('outro item, biblioteca, mídia, editor fechado, múltiplos editores ou jQuery indisponível não envia nada',async()=>{
 for(const mutate of [v=>{v.root.dataset.joinId='999';},v=>{v.root.dataset.libraryId='999';},v=>{v.root.dataset.itemType='book';},v=>{v.root.getClientRects=()=>[];},v=>{v.roots.push({...v.root});},v=>{v.jquery=undefined;},v=>{v.page.location.href='https://evil.test/library';}]){
  const value=setup();mutate(value);assert.equal((await saveLibibNativeField(value.page,value.jquery,request,signal())).code,'invalid-context');assert.equal(value.bodies.length,0);
 }
});
test('falhas HTTP, rejeição e JSON inválido não confirmam gravação nem substituem cache',async()=>{
 for(const [options,code] of [[{status:403},'http'],[{outcome:'error'},'rejected'],[{raw:'<html>login</html>'},'invalid-response'],[{raw:'{}'},'invalid-response']]){
  const value=setup(options);const result=await saveLibibNativeField(value.page,value.jquery,request,signal());assert.equal(result.code,code);assert.equal(result.confirmed,false);assert.equal(result.writeMayHaveOccurred,true);
  assert.equal(value.snapshot().item.title,'Anterior');assert.equal(value.save.disabled,false);assert.equal(value.close.classList.contains('disabled'),false);assert.equal(value.handlers.size,0);
 }
});
test('cancelamento prévio não dispara o handler e cancelamento após enviar é incerto',async()=>{
 const controller=new AbortController();controller.abort();const initial=setup();assert.equal((await saveLibibNativeField(initial.page,initial.jquery,request,controller.signal)).code,'cancelled');assert.equal(initial.bodies.length,0);
 const later=new AbortController(),value=setup({hold:true});const pending=saveLibibNativeField(value.page,value.jquery,request,later.signal);later.abort();const result=await pending;
 assert.equal(result.code,'cancelled');assert.equal(result.writeMayHaveOccurred,true);assert.equal(value.xhr.status,0);assert.equal(value.handlers.size,0);assert.equal(value.save.disabled,false);
});
test('timeout aborta apenas o pedido acompanhado e não repete gravação',async()=>{
 const value=setup({hold:true});const result=await saveLibibNativeField(value.page,value.jquery,request,signal(),5);
 assert.equal(result.code,'timeout');assert.equal(result.writeMayHaveOccurred,true);assert.equal(value.bodies.length,1);assert.equal(value.handlers.size,0);
});
test('handler nativo ausente não é tratado como gravação enviada',async()=>{
 const value=setup({noHandler:true});const result=await saveLibibNativeField(value.page,value.jquery,request,signal());assert.equal(result.code,'invalid-context');assert.equal(result.writeMayHaveOccurred,false);
});
test('ponte ignora eventos sintéticos, origem, remetente ou finalidade inválidos',()=>{
 const value=setup();registerLibibNativeBridge(value.page,()=>value.jquery);const send=value.listeners.get('message');const data={type:'collection-to-play:native-save',requestId:'12345678-1234-1234-1234-123456789abc',request};
 for(const changes of [{isTrusted:false},{origin:'https://evil.test'},{source:{}},{data:{...data,type:'unknown'}}])send({isTrusted:true,origin:value.page.location.origin,source:value.page,data,...changes});
 assert.equal(value.bodies.length,0);assert.equal(value.replies.length,0);
});
test('retorno validado separa confirmação de gravação e confirmação visual',()=>{
 assert.equal(isNativeSaveOutcome({confirmed:true,writeMayHaveOccurred:true,httpStatus:200}),true);
 assert.equal(isNativeSaveOutcome({confirmed:true,writeMayHaveOccurred:false}),false);
 assert.equal(isNativeSaveOutcome({confirmed:false,writeMayHaveOccurred:true,code:'unknown'}),false);
 assert.equal(isNativeSaveOutcome({confirmed:true,writeMayHaveOccurred:true,httpStatus:999}),false);
 const updated={title:'saved',creators:'saved',nativeUpdated:true};assert.equal(isLibibApplyResult(updated),true);assert.match(describeLibibApplyResult(updated),/listagem.*fechar a edição/);
});

const imageRequest=()=>({...request,field:'image',value:new File([Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])],'cover.png',{type:'image/png'})});
test('capa usa FileList e handler nativo com image-0 sem alterar textos ou ordenação',async()=>{
 const previous=globalThis.createImageBitmap;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
 try {
  const value=setup(),input=imageRequest();const outcome=await saveLibibNativeField(value.page,value.jquery,input,signal());
  assert.equal(outcome.confirmed,true);assert.equal(value.bodies.length,1);assert.equal(value.bodies[0]['image-0'].size,input.value.size);
  assert.equal(value.bodies[0].title,undefined);assert.deepEqual(value.snapshot().item,{title:'Anterior',creators:['Anterior'],title_override:'Ordenação'});
 } finally {globalThis.createImageBitmap=previous;}
});
test('capa inválida ou controle bloqueado não dispara salvamento',async()=>{
 const previous=globalThis.createImageBitmap;globalThis.createImageBitmap=async()=>({width:300,height:300,close(){}});
 try {
  for(const file of [null,'url',new File(['bad'],'bad.png'),new File([],'empty.png')]){
   const value=setup();assert.equal((await saveLibibNativeField(value.page,value.jquery,{...request,field:'image',value:file},signal())).confirmed,false);assert.equal(value.bodies.length,0);
  }
  const value=setup();value.page.document.defaultView.DataTransfer=undefined;
  assert.equal((await saveLibibNativeField(value.page,value.jquery,imageRequest(),signal())).writeMayHaveOccurred,false);assert.equal(value.bodies.length,0);
 } finally {globalThis.createImageBitmap=previous;}
});
test('troca de item ou cancelamento durante decode da capa impede envio',async()=>{
 const previous=globalThis.createImageBitmap;
 try {
  for(const change of ['item','abort','replace']){
   const value=setup(),controller=new AbortController();
   globalThis.createImageBitmap=async()=>{if(change==='item')value.root.dataset.joinId='999';else if(change==='replace')value.roots[0]={...value.root};else controller.abort();return {width:1,height:1,close(){}};};
   assert.equal((await saveLibibNativeField(value.page,value.jquery,imageRequest(),controller.signal)).confirmed,false);assert.equal(value.bodies.length,0);
  }
 } finally {globalThis.createImageBitmap=previous;}
});
test('falha ou resposta inválida no upload nunca confirma capa e libera controles',async()=>{
 const previous=globalThis.createImageBitmap;globalThis.createImageBitmap=async()=>({width:300,height:300,close(){}});
 try {
  for(const options of [{status:500},{raw:'<html>login</html>'},{outcome:'error'}]){
   const value=setup(options);const result=await saveLibibNativeField(value.page,value.jquery,imageRequest(),signal());
   assert.equal(result.confirmed,false);assert.equal(result.writeMayHaveOccurred,true);assert.equal(value.inputs[0].disabled,false);assert.equal(value.handlers.size,0);
  }
 } finally {globalThis.createImageBitmap=previous;}
});

test('capa não escreve se o handler abrir controle inválido ou campos adicionais',async()=>{
 const previous=globalThis.createImageBitmap;globalThis.createImageBitmap=async()=>({width:300,height:300,close(){}});
 try {
  for(const mutate of [inputs=>{inputs[0].disabled=true;},inputs=>{inputs[0].type='text';},inputs=>{inputs[0].classList.add('no-post');},inputs=>{inputs.push({...inputs[0]});},inputs=>{inputs.push({name:'notes',value:'preserve'});}]){
   const value=setup(),original=value.jquery;
   value.jquery=target=>{const selected=original(target);return {...selected,trigger:(...args)=>{selected.trigger(...args);if(target.kind==='field')mutate(value.inputs);}};};
   const result=await saveLibibNativeField(value.page,value.jquery,imageRequest(),signal());assert.equal(result.writeMayHaveOccurred,false);assert.equal(value.bodies.length,0);
  }
 } finally {globalThis.createImageBitmap=previous;}
});


test('descrição usa o handler nativo e confirma atualização do estado privado sem outros campos',async()=>{
 const value=setup({description:'Original'});
 const request={joinId:'101',libraryId:'202',field:'description',value:'Nova descrição',expectedDescription:'Original',descriptionConfirmed:true};
 const result=await saveLibibNativeField(value.page,value.jquery,request,signal());
 assert.equal(result.confirmed,true);assert.deepEqual(value.bodies,[{join_id:'101',library_id:'202',item_type:'music',description:'Nova descrição'}]);
 assert.equal(value.snapshot().item.description,'Nova descrição');assert.equal(value.snapshot().item.title,'Anterior');assert.equal(value.snapshot().saved,true);
});
test('descrição sem confirmação ou divergente do texto original não envia nenhuma gravação',async()=>{
 const base={joinId:'101',libraryId:'202',field:'description',value:'Nova',expectedDescription:'Original',descriptionConfirmed:true};
 for(const patch of [{descriptionConfirmed:false},{descriptionConfirmed:undefined},{expectedDescription:'Desatualizada'},{value:''}]){
  const value=setup({description:'Original'});const result=await saveLibibNativeField(value.page,value.jquery,{...base,...patch},signal());
  assert.equal(result.confirmed,false);assert.equal(result.writeMayHaveOccurred,false);assert.equal(value.bodies.length,0);assert.equal(value.snapshot().item.description,'Original');
 }
});

test('não envia descrição acima do limite comum, menor ou zero do campo nativo',async()=>{
 for(const [limit,text] of [[20000,'a'.repeat(5001)],[4,'abcde'],[0,'a']]){
  const value=setup({description:'Original',descriptionMaxLength:limit});
  const result=await saveLibibNativeField(value.page,value.jquery,{joinId:'101',libraryId:'202',field:'description',value:text,expectedDescription:'Original',descriptionConfirmed:true},signal());
  assert.equal(result.confirmed,false);assert.equal(value.bodies.length,0);assert.equal(value.snapshot().item.description,'Original');
 }
});

test('edição rápida de vídeo confirma o handler movie para diretores e preserva título', async () => {
 const value=setup({media:'movie'});
 const result=await saveLibibNativeField(value.page,value.jquery,{joinId:'101',libraryId:'202',media:'movie',field:'creators',value:'François Girard'},signal());
 assert.equal(result.confirmed,true);
 assert.equal(value.bodies[0].item_type,'movie');
 assert.equal(value.bodies[0].creators,'François Girard');
 assert.equal(value.snapshot().item.title,'Anterior');
});
test('mídia divergente impede gravação nativa de vídeo ou música', async () => {
 for(const media of ['movie','music']){
  const value=setup({media});
  const result=await saveLibibNativeField(value.page,value.jquery,{...request,media:media==='movie'?'music':'movie'},signal());
  assert.equal(result.confirmed,false);
  assert.equal(value.bodies.length,0);
 }
 assert.equal(parseNativeSaveRequest({...request,media:'book'}),undefined);
});
