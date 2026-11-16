import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import {readFile} from 'node:fs/promises';
import {SUPPORT_RECEIVING,supportOptions,supportQr} from '../src/shared/support.ts';

const receiving={pix:'Código Pix de teste, sem pagamento',bitcoin:'Endereço Bitcoin de teste',lightning:'apoio@example.invalid',paypal:'https://paypal.me/collection-to-play-test'};

test('somente os meios com recebimento configurado ficam disponíveis',()=>{
 const options=supportOptions(receiving);
 assert.deepEqual(options.map(option=>option.id),['pix','bitcoin','lightning','paypal']);
 assert.deepEqual(options.map(option=>option.value),Object.values(receiving));
 assert.equal(options[2].label,'Lightning — sats');assert.equal(options[3].url,receiving.paypal);
 assert.deepEqual(supportOptions({pix:'',bitcoin:'',lightning:'',paypal:''}),[]);
 assert.deepEqual(supportOptions({...receiving,pix:' ',lightning:''}).map(option=>option.id),['bitcoin','paypal']);
});

test('PayPal abre somente endereço HTTPS do próprio serviço',()=>{
 for(const paypal of ['http://paypal.me/test','https://paypal.me.evil.test/test','https://evil.test','https://user:pass@paypal.me/test','javascript:alert(1)']) {
  assert.throws(()=>supportOptions({...receiving,paypal}));
 }
});

test('QR Code SVG é decodificado para o mesmo dado público que será copiado',()=>{
 for(const option of [...supportOptions(receiving),...supportOptions()]) {
  const qr=supportQr(option.value),scale=6,width=qr.size*scale,rgba=new Uint8ClampedArray(width*width*4).fill(255);
  for(const match of qr.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
   const left=Number(match[1])*scale,top=Number(match[2])*scale;
   assert.ok(left>=4*scale&&top>=4*scale&&left<(qr.size-4)*scale&&top<(qr.size-4)*scale);
   for(let y=top;y<top+scale;y++)for(let x=left;x<left+scale;x++){
    const at=(y*width+x)*4;rgba[at]=rgba[at+1]=rgba[at+2]=0;
   }
  }
  assert.equal(jsQR(rgba,width,width)?.data,option.value);
 }
 assert.throws(()=>supportQr(' '));assert.throws(()=>supportQr('a'.repeat(2049)));
});

test('Pix configurado preserva recebedor, chave e checksum, sem valor predefinido',()=>{
 const payload=SUPPORT_RECEIVING.pix,fields=new Map();let at=0;
 while(at<payload.length){const tag=payload.slice(at,at+2),length=Number(payload.slice(at+2,at+4));const value=payload.slice(at+4,at+4+length);assert.equal(value.length,length);fields.set(tag,value);at+=4+length;}
 assert.equal(at,payload.length);assert.equal(fields.has('54'),false);assert.equal(fields.get('53'),'986');assert.equal(fields.get('59'),'RICARDO CASSIANO BRAGA');
 assert.ok(fields.get('26').includes('e55c5a8e-2dd8-4ad0-a601-30a5dfc38038'));
 let crc=0xffff;for(const byte of new TextEncoder().encode(payload.slice(0,-4))){crc^=byte<<8;for(let i=0;i<8;i++)crc=crc&0x8000?(crc<<1^0x1021)&0xffff:crc<<1&0xffff;}
 assert.equal(crc.toString(16).toUpperCase().padStart(4,'0'),fields.get('63'));
 const paypal=new URL(SUPPORT_RECEIVING.paypal);assert.equal(paypal.searchParams.get('business'),'bragarik@gmail.com');assert.equal(paypal.searchParams.has('amount'),false);
});

test('QR Codes do README correspondem aos mesmos destinos das configurações',async()=>{
 for(const option of supportOptions()) {
  const svg=await readFile(new URL(`../src/assets/support-${option.id}.svg`,import.meta.url),'utf8');
  assert.ok(svg.includes(`d="${supportQr(option.value).path}"`));
 }
});
