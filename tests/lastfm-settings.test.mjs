import test from 'node:test';
import assert from 'node:assert/strict';
import {LastfmSettings} from '../src/shared/lastfm-settings.ts';
function setup(){let saved;const storage={load:async()=>saved,save:async value=>{saved=value;},clear:async()=>{saved=undefined;}};return {settings:new LastfmSettings(storage),reload:()=>new LastfmSettings(storage),value:()=>saved};}
test('chave é local, normalizada e removível; status não revela seu valor',async()=>{
 const value=setup();assert.equal(await value.settings.configured(),false);
 await value.settings.save(' '+ 'A'.repeat(32)+' ');assert.equal(value.value(),'a'.repeat(32));assert.equal(await value.reload().configured(),true);
 await value.settings.clear();assert.equal(await value.settings.configured(),false);assert.equal(value.value(),undefined);
});
test('entrada inválida não sobrescreve configuração existente nem aparece no erro',async()=>{
 const value=setup();await value.settings.save('a'.repeat(32));
 for(const key of [null,'','private-invalid-key','x'.repeat(32)]){await assert.rejects(value.settings.save(key),error=>!error.message.includes(String(key))||key==='');assert.equal(value.value(),'a'.repeat(32));}
});
test('alterações concorrentes seguem ordem e falha não bloqueia a próxima gravação',async()=>{
 const value=setup();await Promise.all([value.settings.save('a'.repeat(32)),value.settings.clear(),value.settings.save('b'.repeat(32))]);assert.equal(value.value(),'b'.repeat(32));
 let fail=true;const settings=new LastfmSettings({load:async()=>undefined,save:async()=>{if(fail)throw Error('storage');},clear:async()=>{}});
 await assert.rejects(settings.save('a'.repeat(32)));fail=false;await settings.save('b'.repeat(32));
});
