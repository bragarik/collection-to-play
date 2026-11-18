import test from 'node:test';
import assert from 'node:assert/strict';
import {SpotifyApplication} from '../src/streamings/spotify-application.ts';
const first='a'.repeat(32), second='b'.repeat(32), redirect='https://example.chromiumapp.org/spotify';
function setup(initialId,initialSession){
 let id=initialId,session=initialSession,launch;
 const calls=[];
 const environment={redirectUrl:redirect,launchAuth:async url=>launch?launch(new URL(url)):`${redirect}?state=${new URL(url).searchParams.get('state')}&code=example`,
  store:{load:async()=>structuredClone(session),save:async value=>{session=structuredClone(value);},clear:async()=>{session=undefined;}},
  fetch:async(url,init)=>{calls.push({url,clientId:init.body?.get('client_id')});return Response.json({access_token:'example-access',refresh_token:'example-refresh',expires_in:3600,token_type:'Bearer'});}};
 const configuration={load:async()=>id,save:async value=>{id=value;}};
 return {application:new SpotifyApplication(environment,configuration),reload:()=>new SpotifyApplication(environment,configuration),calls,id:()=>id,session:()=>session,setLaunch:fn=>{launch=fn;}};
}
test('instalação sem configuração não usa cadastro fixo nem sessão legada',async()=>{
 const value=setup(undefined,{accessToken:'old',refreshToken:'old',expiresAt:Date.now()+100000});
 assert.equal(await value.application.configuredClientId(),'');
 assert.deepEqual(await (await value.application.get()).status(),{connected:false});
 await assert.rejects((await value.application.get()).connect(),/Salve o Client ID/);assert.equal(value.calls.length,0);
});
test('salva configuração local e usa o mesmo ID na autenticação e após reinício',async()=>{
 const value=setup();await value.application.setClientId(' '+first.toUpperCase()+' ');
 assert.equal(value.id(),first);await (await value.application.get()).connect();assert.equal(value.calls[0].clientId,first);
 const reloaded=value.reload();assert.equal(await reloaded.configuredClientId(),first);assert.deepEqual(await (await reloaded.get()).status(),{connected:true});
});
test('trocar aplicativo desconecta; salvar o mesmo preserva sessão; inválido não altera nada',async()=>{
 const value=setup(first);await (await value.application.get()).connect();const session=structuredClone(value.session());
 await value.application.setClientId(first);assert.deepEqual(value.session(),session);
 for(const invalid of ['',null,'x'.repeat(32),first+'a'])await assert.rejects(value.application.setClientId(invalid),/Client ID/);
 assert.equal(value.id(),first);assert.deepEqual(value.session(),session);
 const old=await value.application.get();await value.application.setClientId(second);assert.equal(value.session(),undefined);assert.equal(value.id(),second);
 assert.deepEqual(await old.status(),{connected:false});await (await value.application.get()).connect();assert.equal(value.calls.at(-1).clientId,second);
 await old.disconnect().catch(()=>{});assert.ok(value.session());
});
test('autorização antiga não recria sessão após trocar o aplicativo',async()=>{
 const value=setup(first);let release,started;
 const entered=new Promise(resolve=>{started=resolve;});
 value.setLaunch(url=>new Promise(resolve=>{release=()=>resolve(`${redirect}?state=${url.searchParams.get('state')}&code=old`);started();}));
 const connecting=(await value.application.get()).connect();const failed=assert.rejects(connecting,{code:'cancelled'});await entered;
 await value.application.setClientId(second);release();await failed;
 assert.equal(value.session(),undefined);assert.equal(value.calls.length,0);assert.equal(await value.application.configuredClientId(),second);
});
test('alterações concorrentes são serializadas e última configuração prevalece',async()=>{
 const value=setup(first);await Promise.all([value.application.setClientId(second),value.application.setClientId(first)]);
 assert.equal(value.id(),first);assert.equal(await value.application.configuredClientId(),first);
});

test('remover Client ID encerra sessão e mantém configuração vazia após reinício',async()=>{
 const value=setup(first);await (await value.application.get()).connect();const old=await value.application.get();
 await value.application.clearClientId();assert.equal(await value.application.configuredClientId(),'');assert.equal(value.session(),undefined);
 assert.equal(await value.reload().configuredClientId(),'');await assert.rejects((await value.application.get()).connect(),/Salve o Client ID/);
 await old.disconnect().catch(()=>{});await value.application.setClientId(second);await (await value.application.get()).connect();assert.equal(value.calls.at(-1).clientId,second);
});
