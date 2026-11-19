import test from 'node:test';
import assert from 'node:assert/strict';
import {BarcodeReaderSession,cameraScanArea} from '../src/barcodes/barcode-reader.ts';
import {BarcodeDecodeError} from '../src/barcodes/barcode-decoder.ts';
const reading={code:'0014381227826',format:'ean_13'},photo=new Blob(['image'],{type:'image/png'});
function stream(){
 const track=new EventTarget();let stops=0;track.readyState='live';track.stop=()=>{stops++;track.readyState='ended';};
 return {stream:{getTracks:()=>[track],getVideoTracks:()=>[track]},track,get stops(){return stops;}};
}
function deferred(){let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};}

test('recorte central preserva pixels de vídeo e permanece dentro do quadro em qualquer orientação',()=>{
 assert.deepEqual(cameraScanArea(1280,720),{x:192,y:234,width:896,height:252});
 for(const [width,height] of [[1920,1080],[720,1280],[641,479],[1,1]]){
  const area=cameraScanArea(width,height);assert.ok(area.width>0&&area.height>0);assert.ok(area.x>=0&&area.y>=0);assert.ok(area.x+area.width<=width&&area.y+area.height<=height);
  assert.ok(Math.abs(area.x-(width-area.width)/2)<=.5);assert.ok(Math.abs(area.y-(height-area.height)/2)<=.5);
 }
 for(const [width,height] of [[0,720],[1280,0],[-1,720],[1280,NaN],[1.5,720]])assert.equal(cameraScanArea(width,height),undefined);
});

test('câmera pede apenas vídeo; duas leituras iguais levam à revisão e param a captura',async()=>{
 const camera=stream(),states=[],inputs=[];
 const session=new BarcodeReaderSession(s=>states.push(s),{getCamera:async constraints=>{inputs.push(constraints);return camera.stream;},decode:async()=>reading});
 await session.startCamera();assert.equal(inputs[0].audio,false);assert.equal(inputs[0].video.facingMode.ideal,'environment');assert.equal(session.snapshot().mode,'camera');
 await session.readFrame(photo);assert.equal(session.snapshot().mode,'camera');assert.equal(session.snapshot().reading,undefined);assert.equal(camera.stops,0);
 await session.readFrame(photo);assert.equal(session.snapshot().mode,'review');assert.deepEqual(session.snapshot().reading,reading);assert.equal(camera.stops,1);
 session.close();session.dispose();assert.equal(camera.stops,1);assert.equal(states.at(-1).mode,'idle');
});

test('falta/negação/bloqueio/ocupação da câmera oferece foto sem vazar erro de dispositivo',async()=>{
 for(const [name,expected] of [['NotAllowedError',/bloqueado/],['SecurityError',/bloqueado/],['NotFoundError',/Nenhuma câmera/],['NotReadableError',/ocupada/],['Error',/neste navegador/]]){
  const session=new BarcodeReaderSession(()=>{},{getCamera:async()=>{throw Object.assign(Error('private-device-info'),{name});}});
  await session.startCamera();assert.equal(session.snapshot().mode,'photo');assert.equal(session.snapshot().cameraUnavailable,true);assert.match(session.snapshot().message,expected);assert.doesNotMatch(session.snapshot().message,/private/);session.dispose();
 }
});

test('bloqueio do sistema operacional é distinguido da permissão do navegador e permite tentar novamente',async()=>{
 const camera=stream();let blocked=true;const states=[];
 const session=new BarcodeReaderSession(s=>states.push(s),{getCamera:async()=>{
  if(blocked)throw new DOMException('Permission denied by system','NotAllowedError');return camera.stream;
 }});
 await session.startCamera();assert.equal(session.snapshot().mode,'photo');assert.equal(session.snapshot().cameraUnavailable,true);
 assert.match(session.snapshot().message,/sistema operacional/);assert.match(session.snapshot().message,/configurações de privacidade/);
 assert.doesNotMatch(session.snapshot().message,/não autorizado/);
 blocked=false;await session.startCamera();assert.equal(session.snapshot().mode,'camera');assert.equal(session.snapshot().cameraUnavailable,false);
 session.dispose();assert.equal(camera.stops,1);
});

test('câmera autorizada tardiamente é encerrada após cancelar, escolher foto ou desmontar',async()=>{
 for(const action of ['close','usePhoto','dispose']){
  const camera=stream(),pending=deferred(),states=[];const session=new BarcodeReaderSession(s=>states.push(s),{getCamera:()=>pending.promise});
  const started=session.startCamera();session[action]();const count=states.length;pending.resolve(camera.stream);await started;
  assert.equal(camera.stops,1);assert.equal(states.length,count);assert.equal(session.snapshot().stream,undefined);
 }
});

test('foto para a câmera; leitura atrasada não altera uma sessão substituída',async()=>{
 const camera=stream(),pending=deferred();let signal;
 const session=new BarcodeReaderSession(()=>{},{getCamera:async()=>camera.stream,decode:async(_,options)=>{signal=options.signal;return pending.promise;}});
 await session.startCamera();const readingPhoto=session.readPhoto(photo);assert.equal(camera.stops,1);assert.equal(session.snapshot().mode,'reading');
 session.usePhoto();assert.equal(signal.aborted,true);pending.resolve(reading);await readingPhoto;
 assert.equal(session.snapshot().mode,'photo');assert.equal(session.snapshot().reading,undefined);session.dispose();
});

test('foto vazia/inválida/falha mantém alternativa de nova imagem e sucesso exige revisão',async()=>{
 for(const result of [undefined,{...reading,code:'0014381227827'}]){
  const session=new BarcodeReaderSession(()=>{},{decode:async()=>result});await session.readPhoto(photo);assert.equal(session.snapshot().mode,'photo');assert.match(session.snapshot().message,/Nenhum EAN/);session.dispose();
 }
 const broken=new BarcodeReaderSession(()=>{},{decode:async()=>{throw new BarcodeDecodeError('invalid-image');}});await broken.readPhoto(photo);assert.equal(broken.snapshot().mode,'photo');assert.match(broken.snapshot().message,/imagem/);broken.dispose();
 const success=new BarcodeReaderSession(()=>{},{decode:async()=>reading});await success.readPhoto(photo);assert.equal(success.snapshot().mode,'review');assert.deepEqual(success.snapshot().reading,reading);success.dispose();
});

test('quadros não se sobrepõem; falha/vazio/outro código reiniciam a confirmação',async()=>{
 const camera=stream(),pending=deferred();let calls=0;const values=[pending.promise,undefined,reading,{code:'7898285415687',format:'ean_13'},reading,reading];
 const session=new BarcodeReaderSession(()=>{},{getCamera:async()=>camera.stream,decode:async()=>{calls++;return values.shift();}});
 await session.startCamera();const first=session.readFrame(photo);await session.readFrame(photo);assert.equal(calls,1);pending.resolve(reading);await first;
 for(let i=0;i<4;i++){await session.readFrame(photo);assert.equal(session.snapshot().mode,'camera');}
 await session.readFrame(photo);assert.equal(session.snapshot().mode,'review');assert.equal(camera.stops,1);session.dispose();
});

test('interrupção do dispositivo e falha do decodificador param captura e oferecem foto',async()=>{
 const camera=stream();const session=new BarcodeReaderSession(()=>{},{getCamera:async()=>camera.stream});await session.startCamera();camera.track.dispatchEvent(new Event('ended'));assert.equal(session.snapshot().mode,'photo');assert.equal(camera.stops,1);session.dispose();assert.equal(camera.stops,1);
 const second=stream();const failed=new BarcodeReaderSession(()=>{},{getCamera:async()=>second.stream,decode:async()=>{throw Error('private');}});await failed.startCamera();await failed.readFrame(photo);assert.equal(failed.snapshot().mode,'photo');assert.equal(second.stops,1);assert.doesNotMatch(failed.snapshot().message,/private/);failed.dispose();
});
