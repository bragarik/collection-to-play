# Contribuindo com Collection to Play

Instale as dependências com npm ci, execute npm test e gere o pacote com
npm run build antes de propor mudanças.
O projeto usa Node.js 22.12+, TypeScript estrito, Vite e CRXJS. Dependências de build
ficam em devDependencies; Preact é empacotado localmente. Tailwind/daisyUI geram
CSS estático, sem dependências remotas em execução.

## Estrutura

```text
src/
  entrypoints/          Worker, content script isolado e ponte MAIN.
  pages/
    setup/              Configurações e escolhas salvas.
    player/             Busca, seleção e reprodução.
    metadata/           Composição de dados para edição.
  components/           Componentes Preact compartilhados e shells do catálogo.
  libib/                Adaptador, edição nativa, observação e diagnóstico.
  streamings/           Spotify, YouTube Music e sessão de busca por serviço.
  albums/               Resolução, identificadores, capas e composição.
  shared/               Contratos e preferências.
  assets/               Ícones originais, sem modificação dos arquivos.
  *.html                Entradas com endereços estáveis para popup e iframes.
  manifest.json         Definição da extensão com entradas TypeScript.
  ui.css, library.css   Estilos de endereço estável para páginas e Shadow DOM.
vite.config.mjs         Build Vite/CRXJS, Preact e Tailwind.
tests/*.test.mjs        Testes Node que importam os fontes TypeScript.
```

`npm run build` verifica os tipos e gera `dist/` a partir das entradas reais.
CRXJS resolve worker, scripts, módulos compartilhados e recursos acessíveis;
módulos auxiliares não precisam ser publicados como entradas separadas.
Os nomes das três páginas HTML e a identidade/ID da extensão são preservados.
A versão do pacote vem de package.json. O manifesto de saída é gerado, não editado.
A instalação local carrega exclusivamente dist no modo de desenvolvedor do Chrome.

`npm test` verifica os tipos e executa os cenários existentes com Node + tsx,
diretamente de src e sem precisar de dist. `npm run typecheck` verifica somente tipos.
`npm run dev` usa o modo build --watch do Vite: recompila ao editar arquivos,
sem servidor ou injeção de HMR; recarregue a extensão e a aba Libib para usar a saída.
Isso mantém os mesmos recursos locais e a ponte MAIN usada no pacote de produção.

## Novos catálogos

Implemente CatalogAdapter e mantenha extração de metadados separada do streaming.
Verifique a estrutura real antes de definir seletores. Identifique itens de música,
preserve zeros dos códigos e use um ID próprio de item somente se comprovado.
Registre o escopo exato de URLs e mantenha montagem/limpeza sem ações duplicadas.

Prefira dados já presentes no catálogo. Não inclua cookies, estado autenticado,
notas pessoais ou dumps completos da conta em fontes, exemplos ou testes.

## Novos streamings

Implemente StreamingAdapter e normalize respostas em AlbumCandidate. Valide IDs,
URLs e origens específicas do provedor; não transforme falhas em ausência de álbum.
Respeite autenticação oficial, paginação, cancelamento e limites do serviço.

A lista STREAMINGS indica o que está disponível na interface. Só habilite um novo
serviço depois de ligar seu adaptador ao fluxo e verificar busca e abertura.
Preserve o isolamento das escolhas por serviço e catálogo. Se uma alteração exigir
nova versão de armazenamento, trate os dados antigos antes de gravar por cima deles.

## Aplicativo Spotify de um fork

A versão principal já usa o Client ID fixo do Collection to Play. As instruções
abaixo são opcionais para desenvolvedores que desejam usar outro aplicativo em
um fork; não são etapas de instalação para o usuário final.

O Client ID é público. Use Authorization Code com PKCE, sem incluir Client Secret,
senha ou tokens nos fontes. O aplicativo utilizado continua sujeito às regras
de acesso e quotas do Spotify.

1. Crie um aplicativo no [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Substitua `SPOTIFY.clientId` em `src/shared/contracts.ts` pelo Client ID público dele.
3. Compile com `npm run build` e carregue/recarregue a extensão.
4. No ícone da extensão, expanda **Dados técnicos do Spotify**.
5. Cadastre no aplicativo Spotify exatamente o Redirect URI exibido.
6. Autorize a conta de teste no aplicativo e conecte pela extensão.

A chave pública do manifesto mantém a identidade da instalação local:

```text
ID da extensão: ajjfighekaafaklemaophkbfckidiphl
Redirect URI: https://ajjfighekaafaklemaophkbfckidiphl.chromiumapp.org/spotify
```

Se alterar a identidade do manifesto, use o ID e o endereço efetivamente exibidos
na sua instalação e atualize o cadastro do aplicativo correspondente.

Referências oficiais: [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
e [modos de quota](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

## Validação

npm test cobre o código com respostas controladas; isso não comprova autorização,
disponibilidade de catálogo ou abertura de aplicativo em uma conta/sistema reais.
Mudanças em DOM ou interface devem também ser conferidas no Chrome com a extensão
carregada. Ao relatar uma validação, diferencie API simulada de uso com conta real.

Para uma contribuição, descreva o problema, o comportamento final e a validação
executada. Mantenha testes voltados a comportamento, como escolha lembrada,
artista ausente, identidade de registros, falhas e limites do provedor.

## Publicação e conteúdo versionado

Versione fontes, recursos necessários, testes, configuração de build, lockfile,
licença e documentação pública em Markdown. Não versione node_modules, dist, logs,
credenciais ou documentos locais de tarefas, dúvidas e respostas da demanda.
Não inclua identificadores internos de tarefas em fontes, logs ou commits.

Não altere a chave pública de src/manifest.json inadvertidamente: ela determina
a identidade local e o callback registrado no aplicativo Spotify. O Client ID é
público; Client Secret e tokens nunca devem ser adicionados ao repositório.

## Licença

As contribuições ao projeto seguem a GNU General Public License, versão 3,
conforme LICENSE. Preserve os avisos de autoria aplicáveis às contribuições.

## Busca YouTube Music

A implementação TypeScript consulta o endpoint não oficial `/youtubei/v1/search`,
com filtro de álbuns e cliente WEB_REMIX, sem autenticação, cookies ou backend.
A [ytmusicapi](https://github.com/sigma67/ytmusicapi) e sua documentação serviram
como referência do protocolo; essa biblioteca Python não é dependência do pacote.
O parser exige tipo de página de álbum e identificadores de artista, valida os
links e preserva a continuação de resultados para impedir abertura automática de
uma lista parcial. UPC/EAN não são fornecidos por essa busca.

`tests/fixtures/youtube-music-search.json` contém três resultados públicos de uma
sondagem Discovery/Daft Punk, reduzidos aos campos necessários, sem contexto de
sessão nem rastreamento. Os testes simulam as respostas; não dependem da rede.
Alterações no endpoint interno podem exigir ajustes no parser ou no cliente.

A busca YouTube Music instala uma regra de sessão por `declarativeNetRequestWithHostAccess`,
restrita ao ID da própria extensão, método POST e endpoint `/youtubei/v1/search`.
Ela remove somente `Origin`: o cabeçalho `chrome-extension://…` provocou HTTP 403
HTML nas sondagens, enquanto a mesma consulta sem esse cabeçalho retornou HTTP 200
JSON. A preparação da regra termina antes da busca; nenhuma sessão/cookie é
adicionada e o tráfego normal de abas e do Spotify não corresponde à regra.

## Base de diagnóstico Libib

`src/libib/libib-diagnostics.ts` contém funções puras que avaliam observações de estrutura
por operação (coleção, detalhes e edição), sem acessar DOM, rede ou Chrome storage.
Os estados são estrutura reconhecida, mudança provável, informação insuficiente e
contexto não aplicável. Uma página vazia ou carregando não comprova quebra; versão
de CSS isolada não determina compatibilidade. Reconhecer campos de edição também
não confirma sucesso da gravação.

Os registros aceitam somente códigos, operação, data, versão da extensão, motivo
controlado, status HTTP, formato da resposta, editor, etapa e código de erro permitido.
Campos arbitrários e corpos brutos
são excluídos. O histórico mantém até cem eventos e rejeita formatos/versões
desconhecidos antes de substituir dados. Há testes para essas regras em
`tests/libib-diagnostics.test.mjs`.

A coleta de estrutura está conectada em `src/entrypoints/library.ts`. Usa os seletores
comprovados da listagem e dos detalhes. A coleta estrutural automática não observa
os editores; os resultados de leitura, preenchimento e gravação são registrados
separadamente pelo fluxo de edição descrito abaixo. Espera os sinais estabilizarem
por 500 ms e envia somente mudanças de avaliação. Verificações periódicas retomam
o envio após falha de entrega ou armazenamento.

O worker aceita observações somente do content script principal no caminho Libib
suportado, com URL do remetente correspondente. Recalcula os resultados, atribui a
hora e a versão da extensão e ignora alegações de gravação ou campos arbitrários.
O estado `libib.diagnostics` fica em armazenamento local restrito aos contextos
confiáveis; gravações são serializadas e avaliações iguais são deduplicadas mesmo
após reinício do worker. O snapshot representa a última avaliação registrada, não
um sinal de atividade contínuo nem uma garantia sobre todas as abas abertas.

`src/libib/libib-diagnostic-ui.ts` mostra a última avaliação e exporta JSON pela configuração.
O canal `libib:diagnostics` é restrito às páginas da extensão; a leitura espera as
gravações em fila, valida o esquema/snapshot e retorna uma projeção dos campos
permitidos. A interface acompanha atualizações do storage sem renderizar seu
conteúdo bruto. Esquema desconhecido ou snapshot incoerente não é exportado nem
sobrescrito; registro de outra versão pede nova observação antes de afirmar o
estado atual. O arquivo exportado inclui a versão de observação e a de exportação.

`src/libib/libib-edit-diagnostics.ts` conecta os resultados da edição à coleta e à
exportação. O canal `library:edit-diagnostic` aceita somente o content script no
frame principal do Libib com origem correspondente, sem permitir leitura do histórico.
O worker filtra o payload e atribui data/versão. Resultados não alteram a avaliação
estrutural; entram na mesma fila de armazenamento e no limite de cem eventos.

A leitura registra `read-confirmed`, `request-failed` ou `response-invalid`.
Cada campo enviado pelo handler nativo registra `save-confirmed` ou
`save-unconfirmed`, com status HTTP quando disponível e código de erro permitido.
Cancelamento anterior ao envio ou contexto inválido registra `edit-blocked`.
A edição completa registra `fields-filled`, sem afirmar que houve gravação;
o clique posterior no Save nativo não é acompanhado. Nenhum valor, ID de item,
corpo, URL, token ou mensagem arbitrária é enviado ao armazenamento.

Falhas são mostradas na configuração pela última tentativa por editor/etapa na
versão atual. Um sucesso posterior da mesma etapa resolve seu aviso, preservando o
histórico. Bloqueios não ocultam falhas anteriores. Os registros não correlacionam
itens privados ou abas. Uma falha do diagnóstico não bloqueia a edição nem provoca
retry da gravação. Regressões em `tests/libib-edit-diagnostics.test.mjs` e
`tests/opening.test.mjs` verificam coleta, armazenamento, privacidade, recuperação,
falhas parciais e autorização de remetentes.

## Busca de metadados por serviço

`metadata:services` e `metadata:search` são canais restritos às páginas da extensão.
O primeiro retorna os serviços implementados, requisitos/estado de conexão e o
link local de configuração, sem tokens. O segundo recebe explicitamente Spotify
ou YouTube Music e exige uma origem Libib válida. Não exige nem altera preferência
global, não consulta lembranças e não cria seleção para abrir player. A abertura
para reprodução continua usando os contratos e a preferência existentes.

`src/streamings/metadata-search.ts` contém a sessão de busca reutilizável pela interface.
Mantém resultados e continuação por serviço, deduplica páginas e descarta respostas
e erros antigos após troca de consulta/serviço ou invalidação. Não contém os cards
selecionados nem os valores compostos: esses estados pertencem ao editor.
Falhas e reconexão mantêm os resultados e a continuação válidos para nova ação.

A continuação envolve o cursor do adaptador com serviço, título, artista,
identificadores e origem da consulta. O worker valida essa vinculação antes de
chamar o adaptador; o token não depende de um mapa em memória e continua utilizável
após reinício do worker. É um vínculo de contexto, não um segredo ou autorização.
Os limites dos adaptadores e a validação da consulta permanecem aplicáveis.

O editor em `src/pages/metadata/metadata-editor.tsx` usa essa sessão, oferece um
combo de streaming e mantém um card por serviço. Oferece link de configuração e
atualiza o estado da conexão ao receber foco, mudança de visibilidade, storage
ou pedido de verificação. A conexão não dispara busca automática nem limpa os
cards ou o formulário composto. A sessão de busca mantém resultados e paginação;
os cards e campos escolhidos são geridos pelo editor e por `AlbumComposition`.

`tests/metadata-search.test.mjs` cobre contexto da paginação, estados por serviço,
deduplicação, respostas atrasadas e reconexão. `tests/opening.test.mjs` verifica os
canais reais do worker, autenticação revogada, isolamento de preferência e
paginação nos dois serviços. Os testes de reprodução existentes permanecem na suíte.

## Arquivos de capa

Os parsers Spotify e YouTube Music preservam `artworkVariants` com URL e dimensões
quando fornecidas. `artworkUrl` continua sendo a miniatura usada pelo painel atual.
`src/albums/album-artwork.ts` obtém as variantes, decodifica cada arquivo e escolhe a maior
área real entre as imagens válidas dentro do limite. Não amplia nem recorta imagens.
No Googleusercontent tenta também a variante `=s0` dos endereços reconhecidos,
sem depender dela: se falhar, as variantes retornadas pelo serviço continuam sendo
avaliadas. Não inventa um tamanho máximo comum a todos os álbuns.

O canal `metadata:artwork` aceita somente páginas da extensão, com origem Libib
válida, serviço e ID reconhecidos e URLs HTTPS dos CDNs permitidos. O manifesto
inclui `i.scdn.co`, `lh3.googleusercontent.com`, `yt3.googleusercontent.com` e
`i.ytimg.com` para fetch no worker. As requisições são GET, sem credenciais ou
referrer, com redirecionamento bloqueado e prazo total de 20 segundos.
Fontes: [requisições de rede em extensões](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
e [variantes de imagem do Spotify](https://developer.spotify.com/documentation/web-api/reference/get-an-album).

O limite é 20 MB decimais (20.000.000 bytes), verificado por Content-Length e durante
a leitura do stream. JPEG, PNG, GIF e WebP são identificados pela assinatura e
confirmados por `createImageBitmap`; o bitmap é fechado após medir largura/altura.
O formato declarado pelo servidor não substitui a validação dos bytes. HTML,
SVG, arquivos corrompidos e dimensões inválidas são recusados. Qualquer dimensão
abaixo de 300 pixels produz `low-resolution`, sem bloquear a imagem. Uma variante
recusada produz `unavailable-variants` quando outra imagem válida puder ser usada.
Se nenhuma servir, retorna erro controlado sem alterar os dados do álbum.

O resultado inclui serviço, ID do álbum, origem da imagem, dimensões, tipo, peso,
avisos e os bytes originais em base64, compatível com o transporte JSON do Chrome.
Nenhum arquivo de imagem é gravado no storage ou no Libib por esse canal.
`loadAlbumArtworkResource` confirma identidade e integridade do transporte antes
de criar um File e uma Blob URL para a prévia. Cancelamento descarta resposta
atrasada sem criar uma URL. `retain`/`release` permitem que o formulário mantenha
uma imagem copiada depois da remoção do card; a última liberação revoga a URL.
O editor em Preact usa esses recursos nos cards e no formulário. A edição completa
prepara a capa no FileList nativo sem submit; a edição rápida prepara o arquivo e
aciona o Salvar nativo, que envia `image-0` no FormData.

`tests/album-artwork.test.mjs` cobre seleção pelas dimensões reais, formatos,
variante original do YouTube, limites com e sem Content-Length, erros, cancelamento
e ciclo das prévias. Os testes dos parsers e do worker verificam preservação de
variantes, restrição de remetente/hosts e ausência de alterações nas preferências.
O teste no Chromium confirma decodificação real e transporte de 20 MB pelo canal.

Build suporta `.ts` e `.tsx` com JSX automático de Preact (`jsxImportSource: preact`).
Preact é uma dependência empacotada localmente pelo Vite; a extensão não importa
runtime de CDN. Configurações, worker e ponte nativa mantêm suas entradas.

## Composição dos campos do álbum

`src/albums/album-composition.ts` mantém cards e formulário como estados independentes,
sem DOM, Preact, Chrome storage ou gravação no catálogo. A interface assina
mudanças por `subscribe` e lê snapshots que não expõem referências mutáveis do
estado interno. `src/pages/metadata/metadata-editor.tsx` apresenta esse modelo nas duas entradas
de edição, com serviços, cards, detalhes e formulário responsivo.

`addAlbum` valida serviço, identificador e link e aceita um card por serviço.
Adicionar outro exige remover o anterior. `selectAlbum` só escolhe a fonte para
consulta; `copyField` substitui um campo e `copyAll` copia apenas informações
presentes, sem apagar as ausentes. A lista de artistas é substituída inteira.
Adicionar, selecionar, carregar ou remover cards nunca altera automaticamente o
formulário. Remover e trocar a fonte preserva os valores e suas origens já copiados.

Cada campo registra valor, origem e inclusão na aplicação. Os valores iniciais
representam o catálogo e começam excluídos. Copiar um campo o inclui mesmo se o
valor for igual ao inicial. Edição manual preserva o texto exato do rascunho e
identifica a fonte anterior; validação das regras de gravação cabe à integração.
`setIncluded` permite excluir um campo da aplicação mantendo o rascunho. `changes`
retorna somente os campos incluídos, permitindo obter apenas o File da capa.

`loadArtwork` usa um carregador fornecido pelo consumidor e recebe a propriedade
de uma referência do recurso de capa em caso de sucesso. Deduplica chamadas
simultâneas do mesmo card e confirma serviço/álbum antes de aceitar a imagem.
Carregar não copia a imagem para o formulário. Falhas mantêm os outros campos e
registram erro controlado no card, sem repetir automaticamente. Remoção aborta o
carregamento e descarta respostas antigas, inclusive após readicionar o mesmo álbum.

Cards e campo composto mantêm referências independentes ao recurso da imagem.
Uma capa copiada permanece válida após remover seu card; troca de imagem libera
somente a referência do formulário. Valores iniciais e edição manual de uma capa
existente retêm sua própria referência, sem tomar a propriedade do consumidor.
`dispose` aborta carregamentos, libera as referências e encerra as assinaturas;
a última referência revoga a prévia. Um File já extraído permanece imutável.

`tests/album-composition.test.mjs` cobre composição entre serviços, fontes,
substituição de artistas, dados ausentes, edição manual, aplicação seletiva,
cópia de capa, referências, falhas, respostas atrasadas e uso junto à sessão de
busca/reconexão. Erros de capa são reconhecidos entre entradas compiladas por
`isArtworkError`, sem confiar em mensagens arbitrárias recebidas do carregador.

## Cliente de edição Libib

`src/libib/libib-edit.ts` implementa o contrato nativo capturado na sessão autenticada.
Uma leitura carrega título, ordenação personalizada e criadores. Ela normaliza
`item.creators: ""` para uma lista vazia, conforme retorno nativo para
álbuns sem artista; listas de nomes continuam aceitas. Outros formatos inesperados
continuam sendo recusados.
Cada gravação envia somente seu campo pelo formulário multipart, com cookies da sessão e sem
boundary fixo. O título relê a ordenação antes de enviar para preservar seu valor.
O cliente aceita criadores como texto do input nativo; não converte arrays de
artistas automaticamente.

A confirmação exige HTTP bem-sucedido e JSON com `outcome: "success"`. Cada campo
tem confirmação própria. Erros informam operação, código, eventual status HTTP e
se a gravação pode ter ocorrido; timeout, cancelamento ou resposta inválida após
o envio não comprovam que o dado ficou intacto. Não há repetição automática ou
rollback. Corpos de resposta, HTML, notas e credenciais não integram os erros.

`tests/libib-edit.test.mjs` verifica os contratos e falhas com fetch simulado,
sem alterar uma coleção real.

`src/libib/libib-editor.ts`, integrado pelo content script, reconhece somente editores
`.jump-edit` musicais com IDs válidos e os campos nativos de título e criadores.
Acrescenta uma opção à `.jump-list`, sem acionar os handlers nativos de Save/Cancel.
Ao abrir, carrega os dados do item e monta `metadata-editor.html` em um dialog
com Shadow DOM. Fechar, trocar item/biblioteca ou remover o editor cancela a leitura
e descarta o painel anterior. O streaming da consulta é local à interface e mudar
a preferência de reprodução não invalida a composição aberta.

O editor em `src/pages/metadata/metadata-editor.tsx` usa Preact, `MetadataSearchSession` e
`AlbumComposition`. Permite um card por serviço, dados da fonte com +/+ todos,
origem e inclusão no formulário. A entrada `src/metadata-editor.html` referencia
os fontes TSX/CSS em `src/pages/metadata`; Vite/CRXJS gera os recursos locais e
expõe a página e seus módulos somente ao Libib suportado. Busca e
carregamento de capas são independentes; respostas antigas são descartadas pelas
bases. Fechar libera imagens e aborta operações pendentes. Conexão é relida por
foco, visibilidade, storage e ação explícita sem limpar o trabalho.

Nas duas entradas, o patch inclui somente os campos marcados, permitindo título,
artistas ou capa isoladamente. File é clonado pelo postMessage do iframe e pela
ponte MAIN, sem passar por JSON ou URL de imagem no Libib. A edição rápida envia
cada campo pelo handler nativo; a completa somente prepara o formulário.
A seleção para reprodução em `src/pages/player/album-panel.*` permanece independente.
A ponte exige evento nativo de mensagem, origem da extensão, o Window do iframe,
sessão vigente e identificador de requisição correspondente. Eventos sintéticos,
mensagens da página e respostas de outra sessão são descartados. O cliente confere
o contexto atual antes de cada requisição, inclusive após reler a ordenação e entre
os campos. Fechar/Escape e cliques repetidos ficam bloqueados durante o envio.

`src/libib/libib-metadata.ts` valida todos os campos escolhidos antes de escrever, remove nomes
duplicados e usa texto separado por vírgulas conforme a ajuda nativa capturada.
Como a captura não confirma escapes, nomes com vírgulas, aspas ou quebras de linha
são recusados antes da primeira gravação e orientam edição manual; não se presume
que o endpoint aceite JSON de artistas ou CSV com aspas.

A sequência considera título, criadores e imagem, pulando campos não escolhidos.
Uma falha interrompe os próximos campos sem retry ou rollback. O resultado contém
somente campos escolhidos e distingue salvo, não enviado/não salvo e gravação sem
confirmação. O sucesso completo exige confirmação de todos os escolhidos. A interface
desmarca apenas os confirmados para que uma nova ação explícita envie os restantes.
`validateArtworkFile` confere assinatura, decodificação, dimensões positivas e 20 MB
antes de iniciar qualquer gravação; a ponte MAIN valida novamente o arquivo e relê
o editor após o await, impedindo upload após troca/fechamento do item.
`tests/libib-metadata.test.mjs` verifica campos independentes, validação integral,
falhas parciais e interrupção. `tests/libib-native.test.mjs` cobre FileList, image-0,
controles inválidos e mudança de contexto durante a decodificação.
O [script completo de edição do Libib](https://www.libib.com/js/library/quick-edit.js?v=65),
também fornecido pelo desenvolvedor, mantém `item` e `saved` privados dentro de
`$(document).ready(...)`. Eles não podem ser alterados por acesso a globais.
A interface usa os handlers reais: seleciona o campo nativo, preenche somente os
inputs esperados e aciona seu Salvar. O título relê antes a ordenação no servidor.
Cada campo faz uma única gravação; não há um fetch de escrita em paralelo.
O próprio callback nativo atualiza seu cache privado e sinaliza o item como alterado.
Para imagem, ele envia `image-0` e marca `saved`, deixando a atualização da capa
para o refresh ao fechar o menu; não tenta atribuir uma URL ao cache privado.
O próprio `closeJumpMenu()` consulta `/quickedit/refresh-item` com `join_id`,
`view_type` e `loc=quick-edit-js` e substitui o conteúdo do item correspondente.
A extensão não repete a gravação nem executa manualmente essa requisição de refresh.

O manifesto registra a ponte `libib-native-entry.ts` no [contexto MAIN do Chrome](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts),
somente na biblioteca Libib. `vite.config.mjs` usa standaloneFiles do CRXJS para empacotar essa entrada como IIFE,
sem exportações ou helpers globais que possam colidir com o site. A integração usa
o jQuery existente e valida origem, IDs de atributos e cache jQuery, editor musical
visível único, campo e inputs permitidos. Não recebe sessão Spotify ou Chrome storage.
Mensagens sintéticas/de outra origem são descartadas. Observadores temporários de
`ajaxSend`/`ajaxComplete` acompanham somente o POST correspondente a item, biblioteca,
campo, valor e ordenação esperados (ou metadados do arquivo e chaves do FormData
para image-0), sem substituir `$.ajax` ou handlers do site.
A confirmação vem depois do callback nativo e exige HTTP bem-sucedido e
`outcome=success`. Timeout/cancelamento aborta somente o XHR acompanhado e não
repete a escrita; erro restaura os controles do formulário quando o contexto ainda
é o mesmo. Handler ausente é informado antes de afirmar que houve envio.
`tests/libib-native.test.mjs` cobre o protocolo, os handlers, isolamento por item,
falhas HTTP/JSON, cancelamento, timeout e remoção dos observadores.

Os resultados de gravação do fluxo da extensão integram o diagnóstico Libib.

Na edição completa, `src/libib/libib-full-editor.ts` reconhece `#edit-item-form` em
`#edit-item-details`, POST para `/library/edit-item/submit`, join_id e controles
musicais. O botão `type=button no-post` fica imediatamente antes de Salvar. O modo full
recebe um patch de título, artistas e/ou File, valida todas as escolhas antes de
atribuir qualquer valor e deixa Save/submit sob controle do usuário. Nenhum evento
input/change é disparado. Ao terminar, fecha o painel e devolve o foco à ação.

A imagem exige um único `input[type=file][name=image]`, conectado ao mesmo form,
habilitado e não ignorado por no-post. Valida File, assinatura, decodificação e
limite de 20 MB; depois de operações assíncronas relê item, inputs, estado e sinal.
Prepara DataTransfer/FileList antes de atribuir os textos; falha não deixa patch
parcial. Campos não escolhidos não são serializados, normalizados ou alterados pela
extensão. Ordenação e FileList existentes são preservados quando não escolhidos.
A validação de artistas reutiliza a serialização capturada sem exigir título
escolhido; nomes ambíguos continuam direcionados à edição nativa.

O [postform.js público](https://www.libib.com/js/postform.js?v=65) lê cada
`input.files` ao clicar no Save e acrescenta `image-0` ao FormData. A extensão
prepara o arquivo, sem chamar o handler. O diagnóstico assíncrono registra apenas
fields-filled depois da atribuição; não acompanha o salvamento nativo posterior.
`tests/libib-full-editor.test.mjs` cobre campos seletivos, falhas antes de atribuir,
contexto alterado durante a decodificação e preservação do FileList. O teste no
Chromium usa o postForm/jQuery reais, com endpoint de gravação simulado, e confere
o hash dos bytes enviados somente após o clique explícito em Salvar.

## CSS compartilhado com Tailwind/daisyUI

Vite usa o plugin oficial `@tailwindcss/vite` para gerar ui.css local minificado.
Tailwind CSS e plugin estão fixados em4.3.5; daisyUI em5.8.0. `npm ci` instala as
versões do lockfile. Não usa Tailwind browser/CDN. A entrada ui.css tem nome de saída
estável porque também é carregada pelos controles em Shadow DOM. Os estilos de
cada página ficam junto de seus fontes em pages/; os HTML de entrada ficam na raiz.

A entrada importa theme/utilities sem Preflight para não introduzir um reset geral.
A busca de classes fica limitada a `src/`; nomes completos em TSX/HTML são detectados.
A pequena lista `@source inline` garante componentes e utilitários básicos mesmo
complementando as classes detectadas nas telas. O plugin inclui botões, inputs, selects, textarea,
checkbox, cards, avisos, badges, loading e fieldset, com tema light como base.
O tema claro usa tokens compartilhados da marca em `src/ui.css`: primary,
primary-content e raios de campo/card. Os demais tokens seguem a base light.

O CSS fica disponível no pacote; cada página precisa optar por carregar `ui.css`.
O editor `metadata-editor.html` carrega ui.css antes do CSS de layout específico.
Campos, botões, checkbox, cards, badges, alertas e indicadores de atividade usam
classes daisyUI diretamente no TSX, mantendo os controles HTML nativos. O CSS do
editor cuida do layout, capas, foco e adaptação de duas colunas para uma.
Configurações e seleção para reprodução também usam Preact/daisyUI, com CSS
específico apenas para layout. Os controles no catálogo usam componentes Preact
em Shadow DOM e carregam os estilos localmente, com data-theme para os tokens.
Não importar essa folha como CSS global do documento do Libib; carregue-a somente
na origem da extensão ou dentro dos Shadow DOM existentes. A origem da extensão pode
carregá-la localmente, sem nova permissão ou recurso remoto. As licenças MIT de
Tailwind/daisyUI constam de `NOTICE.txt`, copiado para dist.

O script próprio de build foi removido. A configuração usa os plugins padrão
para Preact, extensão e CSS; um hook generateBundle emite apenas LICENSE/NOTICE.
As saídas geradas são descartáveis e seguem o ciclo de escrita do Vite. Tipos são
verificados antes de iniciar a geração; não edite arquivos em dist.

## Apresentação e integração com o catálogo

`setup.tsx` mantém preferências, busca de diagnóstico, filtros/páginas de escolhas,
conexão e exportação em estado Preact. O diálogo continua nativo (showModal/close)
e os detalhes preservam teclado e expansão. `libib-diagnostic-panel.tsx` observa o
storage e descarta leituras antigas; resumo e mensagens continuam nas funções
puras de `libib-diagnostic-ui.ts`. Assinaturas são removidas ao desmontar.

`album-panel.tsx` renderiza busca, candidatos e escolha de artista. Cada candidato
conserva seu selectionId; paginação não duplica cards. Abertura automática,
Web Player/aplicativo e persistência de lembranças continuam no worker. A entrada
antiga com mode=metadata encaminha ao editor de composição, preservando parâmetros.
`AlbumArtwork` compartilha validação de CDN, imagem e fallback visual com esse editor.

`catalog-ui.tsx` monta apresentação em Preact; `libib.ts` continua extraindo o item
atual e `library.ts` orquestra observação, mensagens e abertura do painel.
`libib-editor.ts` mantém identidade, sessão, cancelamento e ponte nativa; seu shell
é renderizado por Preact e atualizado por props, preservando os refs do dialog e
iframe. Os únicos elementos criados para integração são pontos de montagem no DOM
nativo. Botões de edição fora do Shadow DOM mantêm o estilo do Libib, incluindo a
aparência do Cancelar na edição completa, sem injetar CSS global.

Os wrappers são desmontados quando o item muda, desaparece ou deixa de ser válido.
Recriar controles após uma mudança de preferência remove os componentes anteriores.
Foco, Escape, indisponibilidade temporária e proteção contra ações repetidas são
preservados. Os testes no Chromium usam APIs, abertura de abas e endpoints de
escrita simulados; não substituem o aceite real pelo desenvolvedor.

## Verificação da migração da build

O pacote de referência anterior foi preservado na pasta da sessão. A comparação
usa source maps nas duas saídas; tamanho e tempos são medidas locais, sem garantia
de desempenho em outras máquinas. A validação no Chrome confere preferências,
conexão/diagnóstico, reprodução e editores com serviços/endpoints simulados.
Medidas e estilos de dez elementos do editor foram iguais ao pacote anterior.

Durante a migração foram solicitados dois ajustes de produto: a ação de streaming
na edição completa fica imediatamente antes de Salvar; a edição rápida fecha o
popup de streaming somente após confirmar todos os campos escolhidos. Falha
parcial ou falta de confirmação conserva o popup aberto com o resultado por campo.
A edição completa continua preenchendo o formulário e aguardando o Salvar nativo.
