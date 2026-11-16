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
  streamings/           Spotify, YouTube Music, iTunes, Deezer e sessão de busca por serviço.
  albums/               Resolução, identificadores, capas e composição.
  shared/               Contratos e preferências.
  assets/               Ícone da extensão e símbolos das integrações; autoria em NOTICE.txt.
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

Cada instalação usa um Client ID Spotify configurado pelo usuário, sem ID padrão
no pacote e sem editar fontes para configurar um fork.

1. Crie um aplicativo no [Spotify Developer Dashboard](https://developer.spotify.com/dashboard),
   mantenha Development Mode e confira Premium do proprietário/usuários autorizados.
2. Compile/carregue a extensão e abra **Aplicativo Spotify** nas configurações.
3. Cadastre exatamente o Redirect URI exibido em Settings do dashboard.
4. Cole o Client ID, clique em **Salvar Client ID** e conecte sua conta.

O Client ID é público; não incluir Client Secret, senha ou tokens nos fontes.
Authorization Code com PKCE continua sem servidor. O campo de retorno é somente
leitura. O modo de quota é gerenciado no dashboard.

`SpotifyApplication` em `src/streamings/spotify-application.ts` valida o ID público
(32 caracteres hexadecimais), serializa alterações e separa instâncias por geração.
`src/entrypoints/background.ts` guarda `spotify.clientId` em armazenamento local
restrito aos contextos confiáveis. Trocas encerram a sessão anterior e impedem que
uma autorização/renovação antiga restaure tokens; salvar o mesmo ID não desconecta.
Uma instalação sem configuração ignora sessões legadas e pede o Client ID antes
de conectar. Nenhuma migração automática para o antigo cadastro compartilhado.
Preferências e escolhas da coleção são preservadas. Contrato `spotify:configure`
é aceito nas páginas da extensão, não por scripts da biblioteca.

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
link local de configuração, sem tokens. O segundo recebe explicitamente Spotify,
YouTube Music, iTunes ou Deezer e exige uma origem Libib válida. Não exige nem altera preferência
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

O editor em `src/pages/metadata/metadata-editor.tsx` usa essa sessão, oferece botões
de streaming com ícone/nome e mantém um card por serviço, até quatro. Os botões
usam `aria-pressed` para a seleção exclusiva da busca; a marca “Adicionado” deriva
dos cards presentes em `AlbumComposition`, independentemente do serviço selecionado.
Ao remover um card, a marca desaparece e o foco retorna ao botão desse serviço. Os termos de busca
permanecem ao trocar de serviço; não são rascunhos independentes por streaming.
Cada botão de restaurar usa o valor original da abertura daquele campo e invalida
respostas antigas. Resultados em cache só reaparecem quando correspondem à consulta
atual; a continuação também precisa corresponder aos termos.
O editor também oferece link de configuração e atualiza o estado da conexão ao receber foco, mudança de visibilidade, storage
ou pedido de verificação. A conexão não dispara busca automática nem limpa os
cards ou o formulário composto. A sessão de busca mantém resultados e paginação;
os cards e campos escolhidos são geridos pelo editor e por `AlbumComposition`.

`tests/metadata-search.test.mjs` cobre contexto da paginação, estados por serviço,
deduplicação, respostas atrasadas e reconexão. `tests/opening.test.mjs` verifica os
canais reais do worker, autenticação revogada, isolamento de preferência e
paginação nos serviços que a oferecem, além da busca iTunes sem continuação. Os testes de reprodução existentes permanecem na suíte.

## Arquivos de capa

Os parsers Spotify, YouTube Music, iTunes e Deezer preservam `artworkVariants` com URL e dimensões
quando fornecidas. `artworkUrl` continua sendo a miniatura usada pelo painel atual.
`src/albums/album-artwork.ts` obtém as variantes, decodifica cada arquivo e escolhe a maior
área real entre as imagens válidas dentro do limite. Não amplia nem recorta imagens.
No Googleusercontent tenta também a variante `=s0` dos endereços reconhecidos,
sem depender dela: se falhar, as variantes retornadas pelo serviço continuam sendo
avaliadas. Não inventa um tamanho máximo comum a todos os álbuns.

O canal `metadata:artwork` aceita somente páginas da extensão, com origem Libib
válida, serviço e ID reconhecidos e URLs HTTPS dos CDNs permitidos. O manifesto
inclui `i.scdn.co`, `lh3.googleusercontent.com`, `yt3.googleusercontent.com` e
`i.ytimg.com`, subdomínios de `mzstatic.com` e `cdn-images.dzcdn.net` para fetch no worker. As requisições são GET, sem credenciais ou
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
artistas, capa ou descrição isoladamente. A descrição exige confirmação e conferência
do texto original. File é clonado pelo postMessage do iframe e pela
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

## Integração iTunes

`streamings/itunes.ts` consulta a Search API da Apple, por título/artista e país BR,
sem cookies ou autenticação. O identificador interno `apple-music` é preservado
por compatibilidade; as interfaces mostram iTunes. Não usa UPC/EAN nesta versão.
Apenas links HTTPS de álbum em music.apple.com/br, com o mesmo ID retornado,
são aceitos para abertura. Miniaturas retornadas usam subdomínios mzstatic.com.

A Search API não documenta continuação: o teto de 200 resultados é tratado como
busca possivelmente incompleta, exigindo escolha ou refinamento. Não fabricar
offset nem presumir que um candidato deduplicado represente busca completa.
O manifesto autoriza itunes.apple.com para consultas pelo worker e subdomínios
*.mzstatic.com para obter os arquivos públicos de capa usados na composição.

O fluxo compartilha mensagens de reprodução existentes, seleção e armazenamento
por serviço, mantendo os nomes das mensagens para compatibilidade. Destino app
é exclusivo do Spotify; iTunes, YouTube Music e Deezer abrem no navegador.
A composição de metadados aceita Spotify, YouTube Music, iTunes e Deezer.
`METADATA_SERVICE_IDS` centraliza as fontes e a contagem do editor. Busca explícita
e obtenção de capa não mudam preferências de reprodução ou lembranças. Os IDs
numéricos e links Apple Music BR são validados antes de adicionar o card.
As capas iTunes usam apenas variantes retornadas, medindo os bytes decodificados
e preservando limites, avisos e controle de referências dos outros serviços.

Quando a busca inicial não contém título normalizado e nome de artista
correspondentes, o cliente complementa a consulta. Reutiliza IDs de artistas com
nome correspondente já encontrados ou busca `entity=musicArtist` (até 25 resultados),
compara nomes normalizados e consulta `/lookup` para todos os IDs correspondentes
até três. Mais homônimos não são reduzidos arbitrariamente aos três primeiros;
a busca permanece parcial e pede refinamento. Sem artista, não há complemento.

O lookup exige o registro do artista consultado, com ID e nome correspondentes,
e valida os álbuns pelo parser existente. Aceita até 200 coleções mais o registro
do artista; atingir o teto de coleções continua sendo uma lista parcial. Os álbuns
são deduplicados por ID e a resolução compartilhada preserva escolha e lembranças.
Nenhuma lista ambígua ou parcial autoriza abertura automática. O catálogo pode omitir
resultados mesmo abaixo dos limites; o complemento não garante completude.

O orçamento é de cinco chamadas por busca, todas dentro do mesmo prazo de 20 segundos.
Somente complementos validados entram no cache em memória (64 entradas, dez minutos).
A consulta inicial continua sendo executada, erros não são cacheados e o cache desaparece
ao reiniciar o worker. HTTP429 continua sujeito ao tratamento de limite, sem retry
imediato ou garantia de quota por minuto. Falha de complemento interrompe novas chamadas,
preserva candidatos válidos e retorna `AlbumSearchPage.notice`; a resolução e os textos
de status das três páginas propagam esse aviso. Sem candidatos válidos, o erro é mantido.

Eventos iTunes informam `stage` (`album-search`, `artist-search`, `artist-albums`),
cache e resultado do complemento, além das falhas técnicas existentes. A amostra
`tests/fixtures/itunes-artist-albums.json` preserva somente campos necessários de
uma sondagem pública com álbum omitido na busca textual e encontrado por artista.

`tests/itunes.test.mjs` cobre o cliente; `tests/opening.test.mjs` cobre o worker,
lembranças, destinos, diagnóstico e separação dos erros. A amostra pública
`tests/fixtures/itunes-skank-siderado.json` foi consultada sem credenciais.

## Diagnóstico comum das consultas

`streamings/request-diagnostics.ts` centraliza o relógio monotônico, o prazo de
20 segundos, os sinais de cancelamento e os eventos de falha de Spotify, YouTube
Music, iTunes e Deezer. Cada evento informa etapa, duração, HTTP quando disponível e
detalhes do erro limitados a nomes, mensagens padrão e códigos técnicos conhecidos.
Não exporta erros inteiros, stacks, mensagens arbitrárias, tokens ou cadeias
recursivas de causas. O contrato comum de resolução mantém `network` para timeout;
o evento técnico usa `timeout` e a mensagem informa o prazo excedido.

Erros lendo o corpo por falha de transporte preservam o status recebido e
continuam sendo falhas de rede; SyntaxError na decodificação é resposta inválida.
`tests/streaming-diagnostics.test.mjs` cobre os mesmos cenários nos quatro clientes;
`tests/opening.test.mjs` verifica persistência e exportação dos eventos por serviço.

## Ícone da extensão e diagnóstico de capas

`src/assets/collection-to-play-icon.svg` é a fonte vetorial própria da extensão.
As versões PNG16/32/48/128 são declaradas no manifesto para a extensão e sua
ação na barra do Chrome; CRXJS inclui esses recursos no pacote. Origem e licença
constam de NOTICE.txt.

`fetchAlbumArtwork` emite eventos limitados a metadados de cada variante: início,
HTTP, leitura/validação/decodificação, dimensões e seleção ou falha. URLs são
registradas sem query/fragmento; imagens e dados de autenticação não entram no log.
O worker armazena até cinco operações por serviço em `<serviço>.artworkDiagnostic`,
com até 100 eventos cada. Escritas são serializadas para preservar downloads
simultâneos; falhar ao persistir o diagnóstico não invalida uma imagem utilizável.
A exportação agrega esses registros em `artworkByService`, independentemente da
preferência de reprodução e mesmo quando não há uma busca recente para exportar.


## Integração Deezer

`src/streamings/deezer.ts` consulta `https://api.deezer.com/search/album` por título e
artista, sem cookies, login ou UPC/EAN. Valida IDs numéricos, links de álbum e capas
retornadas. A continuação é vinculada à consulta e ao índice; o worker não segue
URLs arbitrárias recebidas da API. Uma lista parcial mantém a escolha manual.

O serviço participa de reprodução, metadados e diagnóstico. Erros JSON com HTTP 200
são tratados como falha, separados de catálogo vazio. `src/manifest.json` autoriza
`api.deezer.com` e `cdn-images.dzcdn.net`; a obtenção de capas reutiliza os limites
e o decodificador comuns. A amostra e os testes estão em
`tests/fixtures/deezer-skank-siderado.json`, `tests/deezer.test.mjs` e nos testes de
capas, composição e abertura. A quota numérica não foi verificada.

## Indicadores e ações do editor

A comparação de capas fica na interface e usa largura × altura dos arquivos
realmente decodificados. O selo identifica a maior resolução entre os cards atuais,
explicita empates e permanece provisório enquanto outra capa carrega. Remover um
card recalcula a comparação. A resolução não representa uma avaliação visual da
compressão ou nitidez e não altera a seleção ou o formulário.

Título, artistas ou capa ausentes produzem o destaque de erro e um indicador com
`title` e nome acessível explicando a falta. Uma capa pendente não é considerada
ausente. Falhas de capa preservam os outros campos disponíveis.

`ActionIcon` em `src/components/ui-components.tsx` centraliza os SVGs decorativos
de ações comuns. Os textos dos botões permanecem como nomes acessíveis; os ícones
usam `aria-hidden`, cor herdada e dimensões locais. Indicadores de atividade
substituem o ícone de busca/aplicação enquanto a operação estiver em andamento.


## Descrição do disco

`src/albums/album-description.ts` define o documento de descrição, valida a identidade
fonte/álbum e formata texto usando apenas dados retornados. Deezer usa `/album/{id}`;
iTunes usa `/lookup?id=...&entity=song&country=br&limit=200`; Spotify reutiliza a sessão
e `authorizedGet` em `descriptionDetails`. YouTube Music fica limitado aos dados já
comprovados da busca, com orientação explícita sobre os campos ausentes. Não se presume
resenha editorial ou biografia. As fontes são verificadas antes de consultar IDs fixados
em endpoints conhecidos; URLs de paginação retornadas não são seguidas automaticamente.

Os parsers também preservam tipo conhecido (`album_type`/`record_type`), UPC/EAN
validados pelo mesmo normalizador de códigos do projeto, direitos autorais e durações.
Deezer usa segundos (`duration`), convertidos para milissegundos; iTunes usa
`trackTimeMillis`, Spotify usa `duration_ms`. A duração total fornecida pelo serviço
tem prioridade; uma soma exige lista completa, contagem conhecida igual ao total de
faixas e duração positiva válida em todas elas. Dados inválidos ou ausentes são omitidos.
Direitos vêm de `copyrights` no Spotify e `copyright` da coleção iTunes; não se deduz
gravadora desses textos. O tipo genérico `collectionType: Album` do iTunes não é
usado para distinguir álbum, single ou coletânea. Os campos complementares não
alteram `AlbumDescription.fields` ou os seis grupos do indicador. Não há inclusão de
conteúdo explícito ou quantidade de discos, nem novas consultas para esses campos.

`src/streamings/album-description.ts` reúne as consultas sob demanda e o prazo de
20 segundos. A lista fica explicitamente parcial quando a página de detalhes ou o
limite de 200 faixas não permite comprovar completude. A formatação limita o texto
a 5.000 caracteres e conserva o link da fonte. Não se inventam gravadora, gêneros,
datas ou numeração de faixas ausentes. `tests/fixtures/description-deezer.json` e
`description-itunes.json` contêm amostras públicas reduzidas, sem sessão.

O worker oferece `metadata:description` somente às páginas da extensão, com serviço,
ID/endereço e origem Libib validados. Não recebe a descrição privada atual do catálogo.
Registra até cinco tentativas por serviço em `descriptionDiagnostic`, serializando
as gravações; o log exportado agrega `descriptionByService`. Os eventos contêm somente
ID, etapa, tempo, status/código permitido e quantidade de faixas, sem texto gerado,
texto original, cabeçalhos de autenticação ou corpos brutos.

`AlbumComposition` mantém carregamento, erro e documento de descrição por card.
Gerar não copia nem aplica. Copiar inclui o campo e mantém sua origem; edição manual
preserva a fonte anterior. A remoção do card não apaga texto copiado. Respostas antigas
são ignoradas após remover/trocar o card; o controle da confirmação é atualizado junto
à mudança do rascunho, sem um efeito posterior que possa desfazer um clique válido.

A descrição atual chega ao iframe por mensagem entre pai e filho com origem, janela
e sessão verificadas, sem entrar na URL. O contexto informa se existe controle nativo
compatível. O campo começa excluído; o usuário precisa confirmar explicitamente a
substituição. O conteúdo esperado é comparado novamente antes do preenchimento/gravação.
Somente as quebras de linha equivalentes CRLF/LF são normalizadas para compatibilidade
com textarea/FormData; outras diferenças bloqueiam a substituição. A verificação não
é uma transação entre abas ou clientes remotos.

Na edição completa, `readDescriptionControl` aceita somente um input textual ou textarea
nativo, conectado, visível, editável, pertencente ao formulário e não marcado `no-post`.
O patch valida todos os campos e limites antes de preencher. A comparação é repetida
após qualquer espera de decodificação da capa. Apenas o Salvar do Libib grava os dados.

Na rápida, a disponibilidade depende de descrição textual e template do campo no retorno
nativo de `load-fields`. A gravação confirma novamente o texto atual e usa exclusivamente
o item `data-key="description"` e seu handler real de Salvar. `NativeSaveRequest` exige
confirmação e conteúdo esperado; o controle aberto precisa ser textual, editável e isolado.
Não se adicionam campos inferidos ao formulário. O resultado nativo atualiza o cache privado
do Libib antes da confirmação ao iframe. Falha ou resposta sem confirmação interrompe
os próximos campos, sem retry automático. O diagnóstico inclui a etapa `description`
sem guardar valores privados.

Validação: `tests/album-description.test.mjs`, composição, worker, leitura, preenchimento
e ponte nativa cobrem origem, dados ausentes/parciais, limites, cancelamento, confirmação,
texto desatualizado, isolamento por campo, controle incompatível e privacidade. Chromium
com os scripts públicos capturados do Libib e endpoints simulados conferiu as duas edições;
Deezer e iTunes também foram consultados ao vivo, sem escrita na coleção real.


Quando a busca já contém todos os dados usados pela descrição daquela fonte,
`descriptionFromSearch` monta a prévia localmente em `AlbumComposition.addAlbum`.
Hoje isso se aplica ao YouTube Music: não há mensagem ao worker nem fetch adicional,
e o botão Gerar descrição não aparece. A mesma função atende o canal explícito,
sem duplicar a regra de formatação. Nos demais serviços, os detalhes continuam sendo
consultados sob demanda. Texto copiado e confirmação permanecem independentes da
prévia. Avisos em `notes` são informativos do painel e não integram `text`.


## Completude da descrição nos cards

`AlbumDescription.fields` informa quais dos seis grupos foram comprovados pelo
formatador, sem inferir completude pelo tamanho do texto. O grupo de faixas só é
marcado quando a lista obtida é completa e cabe no texto gerado. Essa projeção não
altera `text` nem os avisos informativos separados em `notes`.

`src/albums/description-completeness.ts` calcula pontos, dados ausentes, líderes e
estados por card. Antes da consulta, usa somente os dados já conhecidos na busca;
não dispara requisições. Só descrições disponíveis (`ready`), geradas sob demanda
ou automaticamente, concorrem ao selo. Empates preservam todos os líderes e toda
lista com descrições disponíveis tem ao menos um, mesmo com pontuação zero. Estados não consultado, carregando ou com
falha tornam o selo provisório. Dados esperados ausentes são avisados após consulta,
e erros de consulta têm explicação própria. O editor agrega descrição, capa e outros
campos em um indicador: descrição com 6/6 normal, 1–5/6 informativa (amarelo, `i`)
e 0/6 negativa (vermelho, `!`). Ausência de capa, título ou artistas tem prioridade
para o alerta vermelho. Dados pendentes não geram alerta de ausência. Isso não
altera o rascunho ou a confirmação.

`tests/description-completeness.test.mjs` cobre ranking por dados, empates, remoção,
listas vazias/sem informação, estados pendentes, falhas e faixas parciais.
A prévia temporária com quatro cenários e nove cards foi usada para validar os
indicadores e removida após aprovação do desenvolvedor, junto com o HTML independente
e seu gerador. O mock não faz parte dos fontes nem do pacote atual.

## Restauração dos campos compostos

`AlbumComposition.resetField` restaura somente o campo escolhido ao valor inicial,
com origem `catalog` e `included: false`. O contexto original da descrição fica
disponível para restauração mesmo se recebido após começar um rascunho. A capa
inicial conserva uma referência independente até `dispose`; restaurar libera
apenas a referência da escolha composta, sem retirar a capa de um card.
O formulário oferece o mesmo ícone de restauração da busca nos quatro campos;
a confirmação de descrição é revogada pelo assinante existente do modelo.

## Apoio voluntário

`src/shared/support.ts` concentra exclusivamente os dados públicos em
`SUPPORT_RECEIVING`. Pix Copia e Cola, Bitcoin e LNURL foram fornecidos pelo
responsável; o link PayPal foi montado com o e-mail informado e o recebedor foi
confirmado pelo responsável na página externa. Meios sem valor são omitidos e,
sem nenhum meio configurado, o botão não aparece. Não incluir credenciais ou dados privados nesse arquivo.

`ProjectSupport`, em `src/components/project-support.tsx`, integra o rodapé das
configurações e apresenta um modal com escolha do meio, QR Code local, texto
selecionável, cópia com confirmação e alternativa manual quando o clipboard falha.
PayPal aceita links HTTPS públicos do próprio serviço; a página externa só abre
pela ação do usuário. Não há geração de faturas, valor fixo, verificação de saldo,
processamento de pagamentos ou consultas a serviços para gerar o QR Code.

`qrcode` gera a matriz, renderizada em SVG com margem de quatro módulos e contraste
preto/branco. `tests/support.test.mjs` usa `jsqr` apenas em desenvolvimento para
decodificar o SVG rasterizado e conferir correspondência exata com o valor copiado.
Os testes usam dados fictícios e os destinos reais configurados para conferir a
correspondência entre o QR, o texto copiado e os SVGs do README. Avisos
de licença das dependências empacotadas estão em `NOTICE.txt`.

Validação inicial: CRC do Pix e ausência do campo de valor obrigatório; checksum
Bech32, rede principal e programa witness do Bitcoin; checksum/decodificação do
LNURL e consulta somente de leitura que retornou `payRequest`. O callback de
geração de invoice não foi chamado. O PayPal recusou a consulta automatizada com
HTTP 403, e o responsável confirmou a página correta para seu e-mail, projeto e BRL.
Chromium conferiu cópia, fallback manual, QR/texto, link externo, foco ao fechar e
layout no popup e em tela inteira. Nenhuma transferência foi feita.

Os SVGs `src/assets/support-*.svg` são usados pelo README e correspondem aos mesmos
dados de `SUPPORT_RECEIVING`. Ao trocar um destino, atualizar seu SVG e o texto do
README e repetir a validação; `tests/support.test.mjs` verifica essa correspondência.

## Combinação de descrições

`AlbumComposition.prepareDescriptions` reaproveita `loadDescription` e sua deduplicação,
cache por card, tratamento de falha e descarte de respostas antigas. O editor bloqueia
mudanças durante a preparação e abre o modal somente quando há descrição disponível.
O modal recebe uma fotografia dos dados atuais, sem recursos de imagem; nenhuma
consulta nova é feita para descrições prontas e nenhum rascunho é alterado ao preparar.

`AlbumDescription.sections` é montado diretamente pelo formatador com os dados
comprovados, sem tentar interpretar nomes de faixas ou texto do serviço como metadados.
A lista parcial conserva seu aviso no bloco de faixas; `notes` continua informativo.
O texto individual por serviço permanece igual ao formato anterior.

`src/albums/description-merge.ts` guarda uma composição independente por bloco. Uma
escolha explícita substitui o dado da mesma categoria; as faixas são um bloco inteiro.
Antes de edição manual, os dados são ordenados como a descrição individual. Depois
da edição, alterações manuais são preservadas e somente blocos copiados ainda
intactos conservam atribuição de origem. A atribuição é opcional e conta no limite
de 5.000 caracteres. Um único álbum efetivamente usado recebe o rodapé normal
`Fonte: serviço` seguido do link; múltiplos álbuns recebem `Fontes`, com uma linha
`Serviço - atributo, atributo` por álbum e o link na linha seguinte, sem repetir
valores ou listas de faixas. A opção vem marcada ao abrir o modal e pode ser desmarcada. A quantidade considera as escolhas,
não os cards disponíveis. Não há truncamento
silencioso para confirmar uma combinação acima do limite.

`src/components/description-merge-dialog.tsx` apresenta fontes, falhas, seleção e
texto editável em um `dialog` nativo. `Descrição combinada` contém o texto completo,
inclusive o rodapé opcional de fontes, que também pode ser editado. Confirmar usa
esse texto sem acrescentar um rodapé oculto ou uma segunda prévia. Alterações
manuais no rodapé são preservadas ao trocar dados; desmarcar fontes retira esse
rodapé. Uma substituição que atravessa corpo e rodapé passa a ser texto manual. O ciclo de abrir/fechar usa efeito de layout e
remove o listener de fechamento antes de desmontar, permitindo reabertura imediata.
Confirmar chama `AlbumComposition.useMergedDescription`, que valida a identidade
atual das fontes, atualiza somente descrição e informa origem `merged`. Edições
posteriores preservam essa origem como base; restaurar retorna à descrição do Libib.

O editor revoga explicitamente a confirmação de substituição ao usar a combinação,
inclusive se o texto for igual ao anterior. O modal é renderizado fora do formulário
principal; cancelar/Esc preserva texto e confirmação anteriores. A gravação continua
nos fluxos nativos já existentes, com conferência do original.

`tests/description-merge.test.mjs` cobre seleção, conflitos, listas inteiras, fontes
opcionais, edição manual e limite. `tests/album-composition.test.mjs` cobre preparação,
deduplicação, cancelamento e aplicação somente da descrição. Chromium com Libib e
serviços simulados conferiu os dois editores, reabertura, falha parcial, fontes,
confirmação, retorno ao formulário e layouts 320/680/1144px, sem gravação na coleção real.


O teto comum de descrição é 5.000 caracteres, conforme a documentação de
[importação CSV do Libib](https://support.libib.com/libib/website/add-items.html#csv-import).
A documentação não comprova separadamente o limite interno dos editores; adotamos
o valor documentado como teto comum, sem teste de escrita real para medir o servidor.
`descriptionLimit` aplica também um `maxlength` nativo menor, inclusive zero.
`LibibEditClient` lê o atributo sem executar o HTML recebido; o editor completo usa
a propriedade do controle. O contexto transmite esse limite ao formulário e ao
modal de combinação. O contador inclui fontes; excessos impedem aplicação, sem
truncar o rascunho ou a descrição original. A validação comum também protege geração,
patch e ponte nativa. Antes de escrever, os fluxos verificam novamente o campo nativo.
