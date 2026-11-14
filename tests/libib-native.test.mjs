import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNativeSaveRequest,isNativeSaveOutcome,saveLibibNativeField,registerLibibNativeBridge} from '../dist/libib-native.js';
import {isLibibApplyResult,describeLibibApplyResult} from '../dist/libib-metadata.js';

const request={joinId:'101',libraryId:'202',field:'title',value:'Novo título',titleOverride:'Ordenação'};
const classes=()=>{const values=new Set();return {add:x=>values.add(x),remove:x=>values.delete(x),contains:x=>values.has(x)};};
function setup({outcome='success',status=200,hold=false,raw,unrelated=false,noHandler=false}={}){
 const handlers=new Map(),bodies=[];let selected,inputs=[],privateSaved;const privateItem={title:'Anterior',creators:['Anterior'],title_override:'Ordenação'};
 const titleField={kind:'field',field:'title'},creatorField={kind:'field',field:'creators'},save={kind:'save',disabled:false,classList:classes()},close={classList:classes()};
 const form={querySelector:s=>inputs.find(input=>s.includes('"'+input.name+'"')),querySelectorAll:s=>s.includes('button')?[...inputs,save]:inputs};
 const root={isConnected:true,dataset:{joinId:'101',libraryId:'202',itemType:'music'},getClientRects:()=>[1],
  querySelector:s=>s==='#quick-edit-form'?form:s==='#jump-cover-save'?save:s.includes('data-key="title"')?titleField:s.includes('data-key="creators"')?creatorField:undefined,
  querySelectorAll:()=>close.classList.contains('disabled')?[close]:[]};
 const roots=[root],listeners=new Map(),replies=[];
 const document={querySelectorAll:()=>roots,defaultView:{getComputedStyle:()=>({visibility:'visible'})}};
 const page={document,location:{href:'https://www.libib.com/library',origin:'https://www.libib.com'},addEventListener:(name,fn)=>listeners.set(name,fn),postMessage:value=>replies.push(value)};
 const emit=(name,xhr,settings)=>{for(const [event,fn] of [...handlers])if(event.startsWith(name+'.'))fn({},xhr,settings);};
 let capturedXHR,completion;
 const jquery=target=>({
  data:key=>({'join-id':root.dataset.joinId,'library-id':root.dataset.libraryId,'item-type':root.dataset.itemType})[key],
  on:(event,fn)=>{handlers.set(event,fn);},off:namespace=>{for(const event of handlers.keys())if(event.endsWith(namespace))handlers.delete(event);},
  trigger:()=>{
   if(target.kind==='field'){
    selected=target.field;inputs=[{name:selected,value:String(privateItem[selected]),disabled:false}];
    if(selected==='title')inputs.push({name:'title_override',value:privateItem.title_override,disabled:false});return;
   }
   if(target.kind!=='save'||noHandler)return;
   const data=new FormData();data.set('join_id','101');data.set('library_id','202');data.set('item_type','music');for(const input of inputs)data.set(input.name,input.value.trim());
   const settings={url:'/quickedit/update-field/submit',type:'POST',data};bodies.push(Object.fromEntries(data));
   const xhr={status,responseText:raw??JSON.stringify({outcome}),abort(){this.status=0;emit('ajaxComplete',this,settings);}};capturedXHR=xhr;
   for(const input of inputs)input.disabled=true;save.disabled=true;save.classList.add('loading');close.classList.add('disabled');
   if(unrelated)emit('ajaxSend',{status:200,responseText:'{}'}, {...settings,url:'/another-endpoint'});
   emit('ajaxSend',xhr,settings);
   completion=()=>{if(status>=200&&status<300&&outcome==='success'&&raw===undefined){privateSaved=true;for(const input of inputs)privateItem[input.name]=input.value.trim();for(const input of inputs)input.disabled=false;save.disabled=false;save.classList.remove('loading');close.classList.remove('disabled');}emit('ajaxComplete',xhr,settings);};
   if(!hold)queueMicrotask(completion);
  }
 });
 return {page,jquery,root,roots,save,close,handlers,bodies,replies,listeners,snapshot:()=>({item:structuredClone(privateItem),saved:privateSaved}),complete:()=>completion(),get xhr(){return capturedXHR;}};
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
