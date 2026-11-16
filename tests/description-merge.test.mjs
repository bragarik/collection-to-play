import test from 'node:test';
import assert from 'node:assert/strict';
import {DescriptionMerge} from '../src/albums/description-merge.ts';
import {formatAlbumDescription, DESCRIPTION_LIMIT} from '../src/albums/album-description.ts';
const album=(service='deezer')=>({service,id:service==='deezer'?'1215478':'401652079',title:'Álbum',artists:[{id:'artist',name:'Artista'}],url:service==='deezer'?'https://www.deezer.com/album/1215478':'https://music.apple.com/br/album/album/401652079'});
const card=(service='deezer',values={})=>({album:album(service),description:formatAlbumDescription({album:album(service),genres:[service==='deezer'?'Pop':'Rock'],tracks:[{title:service==='deezer'?'Primeira':'Outra',number:1,durationMs:65000}],trackCount:1,tracksComplete:true,...values})});

test('formatação expõe blocos comprovados, separando lista parcial e fonte informativa',()=>{
 const source=card('deezer',{tracksComplete:false,label:'Gravadora'});
 assert.equal(source.description.sections.find(section=>section.field==='label').text,'Gravadora: Gravadora');
 const tracks=source.description.sections.find(section=>section.field==='tracks').text;
 assert.match(tracks,/Lista parcial de faixas: 1 de 1/);
 assert.ok(source.description.sections.every(section=>!section.text.includes('Fonte: Deezer')));
});
test('escolhe dados de diferentes fontes e substitui conflitos e faixas inteiras',()=>{
 const model=new DescriptionMerge([card(),card('apple-music')]);assert.equal(model.text(),'');
 model.chooseAll('deezer');model.choose('apple-music','genres');model.choose('apple-music','tracks');
 const result=model.result(false);assert.match(result.text,/Gêneros: Rock/);assert.doesNotMatch(result.text,/Gêneros: Pop|Primeira|Fontes:|Fonte:/);
 assert.match(result.text,/1\. Outra — 1:05/);assert.equal(result.text.match(/Faixas:/g).length,1);
 assert.equal(result.sources.find(source=>source.field==='genres').service,'apple-music');
 model.choose('apple-music','genres');assert.doesNotMatch(model.text(),/Gêneros:/);assert.ok(model.text().includes('Outra'));
});
test('fontes opcionais resumem atributos por serviço, sem duplicar valores ou faixas',()=>{
 const model=new DescriptionMerge([card(),card('apple-music')]);model.chooseAll('deezer');model.choose('apple-music','genres');
 assert.equal(model.result(true).text.split('\n\nFontes:\n')[1],`Deezer - Álbum, Artistas, Total de faixas, Duração, Faixas\n${album().url}\n\niTunes - Gêneros\n${album('apple-music').url}`);
 assert.equal(model.result(true).text.match(/1\. Primeira — 1:05/g).length,1);
 assert.equal(model.result(true).text.match(/Gêneros: Rock/g).length,1);
 model.edit(model.text().replace('Gêneros: Rock','Gêneros: Rock alternativo')+'\nObservação manual');
 const result=model.result(true);assert.match(result.text,/Gêneros: Rock alternativo/);assert.match(result.text,/Observação manual/);
 assert.doesNotMatch(result.text,/iTunes - Gêneros/);assert.equal(model.selection('genres'),undefined);
 model.choose('apple-music','title');assert.ok(model.text().includes('Observação manual'));
 assert.ok(model.text().includes('Gêneros: Rock alternativo'));
});
test('um único álbum usado mantém Fonte e link no formato da descrição individual',()=>{
 const model=new DescriptionMerge([card(),card('apple-music')]);model.chooseAll('deezer');
 const result=model.result(true).text;assert.equal(result,card().description.text);
 assert.match(result,/\n\nFonte: Deezer\nhttps:\/\/www.deezer.com\/album\/1215478$/);
 assert.doesNotMatch(model.result(false).text,/Fonte:/);
 model.choose('apple-music','genres');const multiple=model.result(true).text;
 assert.match(multiple,/\n\nFontes:\n/);assert.equal(multiple.split(album().url).length-1,1);assert.equal(multiple.split(album('apple-music').url).length-1,1);
 model.choose('deezer','genres',false);assert.match(model.result(true).text,/\n\nFonte: Deezer\n/);
});
test('rascunho é independente, cancelável, e fontes não incluem dados retirados',()=>{
 const cards=[card()],before=structuredClone(cards),model=new DescriptionMerge(cards);model.chooseAll('deezer');model.edit('Texto livre');
 assert.deepEqual(cards,before);assert.deepEqual(model.result(true),{text:'Texto livre',sources:[]});
 assert.equal(new DescriptionMerge(cards).text(),'');
 assert.throws(()=>model.choose('spotify','genres'),/não está disponível/);
});
test('texto vazio e limite consideram também a seção opcional de fontes',()=>{
 const model=new DescriptionMerge([card()]);assert.throws(()=>model.result(false));model.edit('a'.repeat(DESCRIPTION_LIMIT));assert.equal(model.result(false).text.length,DESCRIPTION_LIMIT);
 model.edit('a'.repeat(DESCRIPTION_LIMIT+1));assert.throws(()=>model.result(false));
 model.edit('a'.repeat(DESCRIPTION_LIMIT-20));model.choose('deezer','title');assert.ok(model.result(false));assert.throws(()=>model.result(true));
});
test('nomes de faixas com quebra de linha não são interpretados como outro dado',()=>{
 const source=card('deezer',{tracks:[{title:'Nome\nGravadora: não é metadado',number:1}],trackCount:1});
 assert.equal(source.description.sections.some(section=>section.field==='label'),false);
 const model=new DescriptionMerge([source]);model.choose('deezer','tracks');assert.match(model.text(),/Gravadora: não é metadado/);
 assert.equal(model.result(true).sources[0].field,'tracks');
});

test('texto editável inclui fontes e confirma exatamente o que foi editado, sem duplicar rodapé',()=>{
 const model=new DescriptionMerge([card(),card('apple-music')]);model.chooseAll('deezer');model.setIncludeSources(true);
 assert.equal(model.text(),card().description.text);assert.equal(model.result().text,model.text());
 model.edit(model.text().replace('Fonte: Deezer','Fonte: Deezer (conferida)')+'\nNota da fonte');
 const custom=model.text();assert.equal(model.result().text,custom);assert.equal(custom.split('Fonte:').length,2);
 model.choose('apple-music','genres');assert.match(model.text(),/Gêneros: Rock/);assert.match(model.text(),/Fonte: Deezer \(conferida\)/);assert.match(model.text(),/Nota da fonte$/);
 model.setIncludeSources(false);assert.doesNotMatch(model.text(),/Fonte:|Nota da fonte/);assert.match(model.text(),/Gêneros: Rock/);
 model.setIncludeSources(true);assert.match(model.text(),/Fontes:/);assert.equal(model.result().text,model.text());
});
test('alterar corpo atualiza fontes automáticas e substituir todo o texto preserva a edição',()=>{
 const model=new DescriptionMerge([card(),card('apple-music')]);model.chooseAll('deezer');model.choose('apple-music','genres');model.setIncludeSources(true);
 model.edit(model.text().replace('Gêneros: Rock','Gêneros: Novo'));
 assert.match(model.text(),/Gêneros: Novo/);assert.doesNotMatch(model.text(),/iTunes -|Fontes:/);assert.match(model.text(),/Fonte: Deezer/);
 model.edit('Texto inteiramente reescrito');assert.equal(model.result().text,'Texto inteiramente reescrito');
 model.setIncludeSources(false);assert.equal(model.text(),'Texto inteiramente reescrito');
});
test('limite menor inclui fontes visíveis e não corta o texto',()=>{
 const model=new DescriptionMerge([card()]);model.chooseAll('deezer');const body=model.text();model.setIncludeSources(true);
 assert.throws(()=>model.result(undefined,body.length));assert.ok(model.text().length>body.length);
 model.setIncludeSources(false);assert.equal(model.result(undefined,body.length).text,body);
});
