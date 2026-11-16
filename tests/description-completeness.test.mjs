import test from 'node:test';
import assert from 'node:assert/strict';
import {rankDescriptionCompleteness,DESCRIPTION_FIELDS} from '../src/albums/description-completeness.ts';
import {formatAlbumDescription} from '../src/albums/album-description.ts';
const album={service:'deezer',id:'1215478',title:'Álbum',artists:[{id:'13545',name:'Artista'}],url:'https://www.deezer.com/album/1215478'};
const card=(fields,text='Texto')=>({album,description:{service:'deezer',albumId:'1215478',text,listedTracks:1,notes:[],fields}});

test('completude compara os seis grupos de dados, independente do tamanho do texto',()=>{
 const result=rankDescriptionCompleteness([card(DESCRIPTION_FIELDS,'Curto'),card(['title','artists'],'Muito texto '.repeat(100))]);
 assert.equal(result[0].score,6);assert.equal(result[0].best,true);assert.equal(result[0].warning,'');assert.equal(result[1].best,false);assert.match(result[1].warning,/lançamento.*gravadora.*gêneros.*lista completa/);
});
test('todos os empatados recebem selo e remover um card recalcula os líderes',()=>{
 const values=[card(DESCRIPTION_FIELDS),card(DESCRIPTION_FIELDS),card(['title','artists'])];
 const result=rankDescriptionCompleteness(values);assert.equal(result.filter(c=>c.best).length,2);assert.equal(result[0].tied,true);assert.equal(result[1].tied,true);
 const next=rankDescriptionCompleteness(values.slice(1));assert.equal(next[0].best,true);assert.equal(next[0].tied,false);
});
test('sempre há líder com cards, mesmo quando todos estão incompletos ou sem dados',()=>{
 for(const values of [[card(['title','artists']),card(['title'])],[card([])],[card([]),card([])]]){
  const result=rankDescriptionCompleteness(values);assert.ok(result.some(c=>c.best));
 }
 assert.deepEqual(rankDescriptionCompleteness([]),[]);assert.match(rankDescriptionCompleteness([card([])])[0].warning,/Sem informações/);
});
test('carregamento e dados não consultados não são tratados como informação ausente',()=>{
 const result=rankDescriptionCompleteness([{album},{album,loadingDescription:true},{album,descriptionError:'Falhou'}]);
 assert.equal(result[0].state,'unqueried');assert.equal(result[0].warning,'');assert.equal(result[1].state,'loading');assert.equal(result[1].warning,'');
 assert.equal(result[2].state,'error');assert.match(result[2].warning,/Não foi possível/);assert.ok(result.every(c=>!c.best&&!c.tied&&c.provisional));
});
test('dados da busca sem descrição gerada não recebem selo',()=>{
 const result=rankDescriptionCompleteness([{album},{album:{...album,service:'apple-music',releaseDate:'1998'}}]);assert.ok(result.every(value=>!value.best));assert.equal(result[1].score,3);
});
test('somente descrições disponíveis competem, inclusive as automáticas da busca',()=>{
 const automatic={album:{...album,service:'youtube-music'},description:{...card(['title','artists']).description,service:'youtube-music'}};
 const result=rankDescriptionCompleteness([{album:{...album,releaseDate:'1998'}},automatic,{album,descriptionError:'Falhou'}, {album,loadingDescription:true}]);
 assert.deepEqual(result.map(value=>value.best),[false,true,false,false]);assert.equal(result[1].tied,false);assert.equal(result[1].provisional,true);
 const generated=rankDescriptionCompleteness([card(DESCRIPTION_FIELDS),automatic]);assert.deepEqual(generated.map(value=>value.best),[true,false]);
});
test('lista parcial de faixas não conta como grupo completo e aviso não entra na descrição',()=>{
 const document=formatAlbumDescription({album,label:'Gravadora',genres:['Pop'],tracks:[{title:'Faixa'}],trackCount:10,tracksComplete:false});
 assert.equal(document.fields.includes('tracks'),false);const status=rankDescriptionCompleteness([{album,description:document}])[0];assert.ok(status.missing.includes('tracks'));assert.match(status.warning,/lista completa/);assert.doesNotMatch(document.text,/Descrição incompleta:/);
});

test('completa é normal, parcial é informativa e ausência total é negativa',()=>{
 const result=rankDescriptionCompleteness([card(DESCRIPTION_FIELDS),card(DESCRIPTION_FIELDS.slice(0,5)),card(['title']),card([]),{album}]);
 assert.deepEqual(result.map(value=>value.tone),['ok','partial','partial','error','pending']);
 assert.equal(result[1].score,5);assert.match(result[1].warning,/lista completa/);assert.equal(result[3].score,0);
});
