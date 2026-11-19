import test from 'node:test';
import assert from 'node:assert/strict';
import {BARCODE_IMAGE_BYTE_LIMIT,createBarcodeDecoder,parseBarcodeReading,barcodeValueForTarget} from '../src/barcodes/barcode-decoder.ts';

const ean={code:'0014381227826',format:'ean_13'},upc={code:'014381227826',format:'upc_a'};
const photo=()=>new Blob(['controlled image'],{type:'image/png'});
function environment(readImage){
 const events=[];
 return {events,decode:createBarcodeDecoder({readImage,urls:{createObjectURL(){events.push('create');return 'blob:controlled';},revokeObjectURL(url){assert.equal(url,'blob:controlled');events.push('revoke');}}})};
}

test('aceita somente EAN/UPC com formato, comprimento e dígito verificador válidos',()=>{
 for(const reading of [ean,upc,{code:'7898285415687',format:'ean_13'}])assert.deepEqual(parseBarcodeReading({codeResult:reading}),reading);
 for(const value of [null,{},[],{codeResult:null},...[
  {...ean,code:14381227826},{...ean,code:'0014381227827'},{...ean,code:'0000000000000'},
  {...ean,code:' 0014381227826'},{...ean,code:'0014381-227826'},{...ean,format:'upc_a'},
  {...upc,format:'ean_13'},{...upc,format:'qr_code'},{...upc,code:'１２３４５６７８９０１２'},
 ].map(codeResult=>({codeResult}))])assert.equal(parseBarcodeReading(value),undefined);
});

test('preserva zeros e converte apenas representações equivalentes para o destino',()=>{
 assert.equal(barcodeValueForTarget(ean,'search'),'0014381227826');
 assert.equal(barcodeValueForTarget(upc,'search'),'014381227826');
 assert.equal(barcodeValueForTarget(ean,'ean'),'0014381227826');
 assert.equal(barcodeValueForTarget(upc,'ean'),'0014381227826');
 assert.equal(barcodeValueForTarget(ean,'upc'),'014381227826');
 assert.equal(barcodeValueForTarget(upc,'upc'),'014381227826');
 assert.equal(barcodeValueForTarget({code:'7898285415687',format:'ean_13'},'upc'),undefined);
 assert.equal(barcodeValueForTarget({...ean,code:'0014381227827'},'ean'),undefined);
 assert.equal(barcodeValueForTarget(ean,'other'),undefined);
});

test('sucesso encerra na primeira resolução; ausência/invalidez permite uma segunda tentativa',async()=>{
 const sizes=[],first=environment(async(_,size)=>{sizes.push(size);return {codeResult:ean};});
 assert.deepEqual(await first.decode(photo()),ean);assert.deepEqual(sizes,[0]);assert.deepEqual(first.events,['create','revoke']);
 for(const invalid of [undefined,{codeResult:{...ean,code:'0014381227827'}},{codeResult:{code:'abc',format:'qr_code'}}]){
  const attempted=[],second=environment(async(_,size)=>{attempted.push(size);return size===0?invalid:{codeResult:upc};});
  assert.deepEqual(await second.decode(photo()),upc);assert.deepEqual(attempted,[0,800]);assert.deepEqual(second.events,['create','revoke']);
 }
 const empty=environment(async()=>null);assert.equal(await empty.decode(photo()),undefined);assert.deepEqual(empty.events,['create','revoke']);
});

test('entrada inválida não carrega decodificador; falha libera URL e não expõe dados da biblioteca',async()=>{
 let calls=0;const invalid=environment(async()=>{calls++;});
 for(const image of [null,new Blob(),new Blob(['x'],{type:'text/html'}),new Blob(['x']),new Blob([new Uint8Array(BARCODE_IMAGE_BYTE_LIMIT+1)],{type:'image/jpeg'})]){
  await assert.rejects(invalid.decode(image),{code:'invalid-image'});
 }
 assert.equal(calls,0);assert.deepEqual(invalid.events,[]);
 const failed=environment(async()=>{throw Error('private_code private_image_url');});
 await assert.rejects(failed.decode(photo()),error=>error.code==='unavailable'&&!/private/.test(error.message));
 assert.deepEqual(failed.events,['create','revoke']);
 assert.deepEqual(await environment(async()=>({codeResult:ean})).decode(photo()),ean,'falha anterior não bloqueia a fila');
});

test('serializa consumidores e cancela chamada enfileirada sem criar recursos',async()=>{
 let finish;const gate=new Promise(resolve=>{finish=resolve;});let entered;
 const started=new Promise(resolve=>{entered=resolve;});
 const first=environment(async()=>{entered();await gate;return {codeResult:ean};});
 const second=environment(async()=>{throw Error('não deve executar');});
 const active=first.decode(photo());await started;
 const controller=new AbortController();const queued=second.decode(photo(),{signal:controller.signal});
 const rejection=assert.rejects(queued,{code:'cancelled'});controller.abort();
 assert.deepEqual(first.events,['create']);assert.deepEqual(second.events,[]);
 finish();assert.deepEqual(await active,ean);await rejection;assert.deepEqual(second.events,[]);
});

test('cancelamento durante leitura aguarda o uso da imagem e não tenta outra resolução',async()=>{
 let finish;const gate=new Promise(resolve=>{finish=resolve;});let entered;
 const started=new Promise(resolve=>{entered=resolve;});const sizes=[];
 const reader=environment(async(_,size)=>{sizes.push(size);entered();await gate;return {codeResult:ean};});
 const controller=new AbortController();const active=reader.decode(photo(),{signal:controller.signal});await started;
 const rejection=assert.rejects(active,{code:'cancelled'});controller.abort();assert.deepEqual(reader.events,['create']);
 finish();await rejection;assert.deepEqual(sizes,[0]);assert.deepEqual(reader.events,['create','revoke']);
});
