import test from 'node:test';
import assert from 'node:assert/strict';
import {readQuickEditExtraGroups,prepareQuickEditExtras,quickEditFieldContext,availableQuickEditGroups} from '../src/libib/libib-quick-fields.ts';
const control=(name,changes={})=>({name,tagName:'INPUT',type:'text',disabled:false,readOnly:false,maxLength:-1,matches:()=>false,classList:{contains:()=>false},...changes});
const parse=controls=>()=>({querySelectorAll:()=>controls});
const dateGroup={nativeField:'published',fields:[{key:'publish_year',value:'2024',maxLength:4},{key:'publish_month',value:'02',maxLength:2},{key:'publish_day',value:'29',maxLength:2}]};

test('usa controles e valores escalares confirmados; preserva códigos com zeros e limites nativos',()=>{
 const groups=readQuickEditExtraGroups({publisher:'<input>',join_id:'<input>'},{publisher:'Columbia',join_id:'101'},'music',parse([control('publisher',{maxLength:40})]));
 assert.deepEqual(groups,[],'controles repetidos em grupos distintos são ambíguos');
 const values=readQuickEditExtraGroups({publisher:'<input>'},{publisher:'Columbia'},'music',parse([control('publisher',{maxLength:40})]));
 assert.deepEqual(quickEditFieldContext(values),{manualFields:['publisher'],manualValues:{publisher:'Columbia'},manualLimits:{publisher:40}});
 const codes=readQuickEditExtraGroups({barcode:'<input>'},{upc_isbn10:'012345678905'},'music',parse([control('upc_isbn10')]));
 assert.equal(codes[0].fields[0].value,'012345678905');
 assert.deepEqual(readQuickEditExtraGroups({barcode:'<input>'},{upc_isbn10:12345678905},'music',parse([control('upc_isbn10')])),[]);
});

test('rejeita campos internos, estrutura incompatível, falta de valor e conteúdo executável',()=>{
 for(const node of [control('join_id'),control('publisher',{type:'hidden'}),control('publisher',{disabled:true}),control('publisher',{tagName:'SELECT'}),control('ensemble')])
  assert.deepEqual(readQuickEditExtraGroups({publisher:'<input>'},{publisher:'Selo',ensemble:'Ator'},'music',parse([node])),[]);
 for(const value of [undefined,{},['tags']])assert.deepEqual(readQuickEditExtraGroups({publisher:'<input>'},{publisher:value},'music',parse([control('publisher')])),[]);
 assert.deepEqual(readQuickEditExtraGroups({publisher:'<script>alert(1)</script>'},{publisher:'Selo'},'music',()=>assert.fail('Não deve analisar conteúdo executável')),[]);
 assert.deepEqual(readQuickEditExtraGroups({publisher:'<input>'},{publisher:'Selo'},'music',parse([control('publisher'),control('publisher')])),[]);
});

test('nomes e agrupamentos vêm da resposta e precisam existir no menu atual',()=>{
 const groups=readQuickEditExtraGroups({published:'<input>'},{publish_year:'2024',publish_month:'02',publish_day:'29'},'movie',parse(dateGroup.fields.map(field=>control(field.key))));
 assert.equal(groups[0].nativeField,'published');
 const root={querySelectorAll:selector=>selector.includes('published')?[{isConnected:true,getAttribute:()=>null}]:[]};
 assert.equal(availableQuickEditGroups(groups,root).length,1);
 assert.equal(availableQuickEditGroups(groups,{querySelectorAll:()=>[]}).length,0);
 assert.deepEqual(availableQuickEditGroups([{nativeField:'x"] bad',fields:[]}],root),[]);
});

test('agrupamento preserva partes não escolhidas e valida toda a data antes de qualquer envio',()=>{
 const groups=[dateGroup];
 assert.throws(()=>prepareQuickEditExtras(groups,{publish_year:'2025'}),/Data de lançamento inválida/);
 assert.deepEqual(prepareQuickEditExtras(groups,{publish_year:'2025',publish_day:'28'}),[{nativeField:'published',values:{publish_year:'2025',publish_day:'28'},expectedValues:{publish_year:'2024',publish_month:'02',publish_day:'29'}}]);
 assert.throws(()=>prepareQuickEditExtras(groups,{join_id:'202'}),/não está disponível/);
 assert.throws(()=>prepareQuickEditExtras(groups,{publish_month:'13'}),/data de lançamento/);
});
test('não oferece data distribuída entre envios independentes que poderiam deixar estado intermediário inválido',()=>{
 const groups=readQuickEditExtraGroups({year:'year',month:'month',notes:'notes'},
  {publish_year:'2024',publish_month:'02',notes:'Minha nota'},'music',html=>({querySelectorAll:()=>[control(html==='year'?'publish_year':html==='month'?'publish_month':'notes')]}));
 assert.deepEqual(groups.map(group=>group.nativeField),['notes']);
});
