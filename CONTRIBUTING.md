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
2. Compile/carregue a extensão e abra **Credencial Spotify** nas configurações.
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
Remover Client ID limpa a configuração local e desconecta, preservando preferências
e escolhas da coleção.
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


A configuração inicial Last.fm usa `src/shared/lastfm-settings.ts` e armazenamento
local `lastfm.apiKey` restrito a contextos confiáveis. Mensagens de status retornam
somente um booleano; gravação/remoção são aceitas nas páginas da extensão. A chave
não tem valor padrão e não deve aparecer nos fontes, logs ou diagnósticos. O campo
password é limpo após salvar. A consulta aparece no fluxo unificado Serviços e no merge.


O cliente `src/streamings/lastfm.ts` atende `lastfm:album` e a busca explícita
`metadata:search` Last.fm, com título/artista e idioma pt/en. `lastfmCandidate`
converte o resultado validado para o contrato comum, preservando URL, idioma e
payload; `lastfmDescription` fornece os blocos automaticamente ao adicionar o card.
Last.fm integra `METADATA_SERVICE_IDS`, mas não a lista `STREAMINGS` de reprodução
nem o armazenamento de preferência para ouvir. As rotas de reprodução continuam
recusando Last.fm. O ID da fonte inclui o idioma; a chave da sessão de busca inclui
o idioma para não reutilizar resultado de outra consulta.

O editor usa uma única seleção **Serviços** e até seis cards. O painel separado
Last.fm foi removido. Idioma aparece apenas para Last.fm; artista é opcional
na busca pelo título, com consulta direta quando preenchido. A descrição retornada já aparece nos detalhes do card. Textos
longos não são cortados: podem ser copiados ao formulário para edição, mas a
aplicação permanece bloqueada acima do teto/nativo menor e sem confirmação.
Remover um card mantém campos copiados e suas referências de capa.

`DescriptionSectionField.about` e `AlbumDescriptionData.about` são comuns e
opcionais; o formatador e o merge posicionam Sobre o álbum antes de Faixas.
Tags e MusicBrainz são blocos próprios. Regras opcionais de atribuição por bloco
em `AlbumDescription.attribution` acrescentam a origem e o link dos Termos da API
quando o texto é usado, inclusive com fontes opcionais desmarcadas. A atribuição de
Sobre o álbum Last.fm permanece se o texto for editado manualmente; sai quando o
bloco é removido ou substituído por outra fonte.

O cliente usa cache HTTP padrão e não mantém cache próprio nem grava respostas Last.fm
no storage. Os diagnósticos guardam somente horário, etapa, duração, status HTTP,
código de falha e contagens/indicadores de presença; não guardam API key, URL com
parâmetros, mensagens remotas ou texto retornado. Os [Termos da API Last.fm](https://www.last.fm/api/tos)
limitam o uso a fins não comerciais, exigem crédito/link para o catálogo, proíbem
sublicenciamento, limitam dados armazenados a 100 MB e mandam respeitar cabeçalhos
HTTP de cache. O mantenedor declarou uso pessoal não comercial. Os termos também
mencionam aprovação escrita para páginas com acesso público que usem a API; confirmar
essa exigência com Last.fm antes de distribuir uma versão que ofereça esse acesso.

A capa Last.fm usa o pipeline compartilhado com verificação de CDN/identidade,
bytes, dimensões e referências. Suíte de 26 arquivos e Chromium simulado em
`/tmp/collection-to-play-unified-lastfm-browser.mjs` validam seleção unificada,
card, cópia, origem, merge, texto longo, falhas, respostas tardias e layout móvel.
Nenhuma chave real foi embutida. Não há commit/push desta integração ainda.


O fluxo de Vídeo usa o mesmo modal e a página metadata-editor, com o componente
específico em `src/pages/metadata/video-editor.tsx`. O TMDb atende exclusivamente
a mídia movie, com busca e detalhes incluindo créditos de direção. A configuração
da credencial fica em `src/pages/setup/setup.tsx`. A API key usa o parâmetro
api_key; o token de leitura usa Authorization Bearer. O diagnóstico local
tmdb.diagnostic preserva até vinte eventos e a exportação projeta os campos
de diagnóstico sem credencial ou URL autenticada.

`src/libib/libib-edit.ts` recebe a mídia explicitamente na edição rápida.
`src/libib/libib-native.ts` confere a mídia, o item e a biblioteca antes de
acionar e confirmar o handler nativo. O editor completo verifica o contexto
movie e usa directors no contrato de preenchimento, mapeado para creators no
formulário do Libib. Música e Vídeo reutilizam ArtworkPreview para apresentar
a capa com dimensões, formato e tamanho. As medidas vêm do arquivo decodificado.


A integração Discogs usa `src/streamings/discogs.ts` no worker, token local com
acesso restrito e mensagens somente das páginas da extensão. O parser projeta
metadados de catálogo e descarta imagens dos detalhes, dados de usuário e marketplace.
Na pesquisa, preserva somente `thumb` validado em `searchThumbnailUrl`, separado
de `artworkUrl`, variantes e metadados da edição.
`src/albums/discogs-description.ts` monta os blocos e campos de inclusão, com
atribuição obrigatória e dados da edição física. A consulta de detalhes valida
o ID selecionado. A busca vincula paginação ao modo por código ou título;
em Música, a continuação também fica vinculada à consulta original.

O serviço integra a composição de Música e a seleção de fontes de Vídeo. Não
integra a lista de preferências de reprodução. O pipeline de imagem recusa URLs
Discogs e os cards não solicitam capas dessa fonte. A inclusão manual de Música
reutiliza o serviço da edição. Vídeo mantém cards TMDb, Discogs, UPCitemdb e Last.fm e usa o modal
de merge compartilhado, com diretores como atributo separado dos artistas.

`tests/discogs.test.mjs` verifica seleção por código, fallback por título,
paginação, filtro de vídeo, extração de dados, descarte de imagens e dados
restritos, falhas, quota/Retry-After, campos manuais e merge/atribuição.
`tests/opening.test.mjs` verifica a credencial e os dados projetados pelo worker.
Suíte de 28 arquivos e build aprovados. A consulta pública real de Ramones — Raw
confirmou os metadados da edição; busca autenticada e preenchimento real com
Discogs dependem da conferência do desenvolvedor com seu token pessoal.


A exportação comum de busca em `src/entrypoints/background.ts` agrega os registros
em `searchByService`, incluindo Last.fm, TMDb, Discogs e UPCitemdb, além dos grupos de capa e
descrição existentes. A UI usa somente **Diagnóstico de busca → Exportar log da
busca**. Os eventos dos serviços novos são projetados em campos permitidos e não
incluem headers, corpos ou credenciais. Regressão em `tests/opening.test.mjs`
confirma a agregação e a exclusão desses campos.

### Reconhecimento e validação de campos do Libib

`src/libib/libib-item-fields.ts` compartilha o reconhecimento de extras e a
validação de texto/data entre os formulários. Reutiliza a lista por mídia de
`src/shared/manual-entry-fields.ts` e aceita somente controles únicos, conectados,
editáveis e pertencentes ao formulário. Campos internos, inputs ocultos e
controles `no-post` são excluídos; campos de uma aba inativa continuam válidos.
O reconhecimento não depende da origem manual ou automática do item.

`LibibFullEditor.extraFields` expõe os controles encontrados. A edição completa
de Música/Vídeo utiliza os extras no mesmo modal da
inclusão manual. O contexto envia valores e limites nativos; a cópia substitui o
atributo no rascunho e a restauração recupera o valor inicial. Antes do
preenchimento, todos os valores são validados e a identidade dos controles é
conferida novamente após operações assíncronas. Os campos não selecionados são
preservados e o salvamento continua pelo botão nativo do Libib.

`prepareLibibItemFields` prepara valores sem alterar controles e respeita o
menor limite entre o campo conhecido e o controle nativo. Ao mudar uma parte da
data, valida a combinação com as partes atuais não selecionadas. Uma data antiga
inválida não impede copiar outro campo. A inclusão manual utiliza essa mesma
validação antes de preencher qualquer valor. Regressões em
`tests/libib-item-fields.test.mjs`, `tests/libib-full-editor.test.mjs` e
`tests/libib-manual-entry.test.mjs` cobrem capacidades por mídia, substituição do
mesmo atributo, preservação de valores, limites e calendário.


A validação Chromium da edição completa, com respostas controladas, verificou
Música/Vídeo, ausência de extras, Vídeo sem descrição nativa, limites, cópia do
Discogs, substituição do mesmo campo por iTunes, restauração e preenchimento
seletivo. Nenhum formulário foi submetido e a coleção real não foi alterada.


Na edição pelo lápis, `src/libib/libib-quick-fields.ts` confere os controles de
`input_fields` em um documento inerte, sem inserir o HTML na página. Os campos
precisam ter nomes conhecidos, valores escalares em `item` e uma opção única no
menu atual. Valores ausentes ou com formato não reconhecido são excluídos;
códigos numéricos não são convertidos para evitar perda de zeros. Datas em
opções independentes não são oferecidas, pois poderiam gerar estados
intermediários inválidos; grupos reconhecidos mantêm as partes não selecionadas.

`LibibEditClient` devolve apenas grupos normalizados. O contexto e os componentes
são os mesmos da edição completa e da inclusão manual. Antes da aplicação, o
cliente relê as capacidades e compara os agrupamentos com os da abertura.
`applyLibibPatch` valida toda a seleção, envia cada grupo uma única vez e devolve
o resultado por campo. Qualquer resultado incerto interrompe a sequência.

`saveLibibNativeField` aciona a opção e o Save nativos, confere os valores atuais,
valida os limites dos controles e verifica o payload completo do grupo,
incluindo valores preservados. A confirmação aguarda a atualização do estado
privado do Libib. Uma divergência no payload de um envio observado é tratada
como gravação incerta. O diagnóstico usa o estágio `extra`, sem nomes ou valores
pessoais dos campos. Regressões em `tests/libib-quick-fields.test.mjs`,
`tests/libib-native.test.mjs`, `tests/libib-metadata.test.mjs` e
`tests/libib-edit-diagnostics.test.mjs` cobrem essas regras.

Chromium com respostas e handler controlados confirmou o fluxo do lápis em
Música/Vídeo, ausência de extras, Vídeo sem descrição, limites, substituição do
mesmo atributo entre Discogs/iTunes, restauração, atualização do estado simulado
e gravação de data agrupada preservando o mês. As rotas foram interceptadas;
nenhuma escrita foi feita na coleção real. A suíte de 30 arquivos e o build
passaram; a conferência na instalação real permanece necessária.


A revisão final acrescentou oito cenários Chromium com respostas controladas:
data incompatível bloqueada e corrigida, troca de item sem envio e falha parcial
sem repetição, tanto para Música quanto para Vídeo; layouts de 390px e 700px sem
rolagem horizontal e com aplicação utilizável. A falha parcial desmarca somente
o campo confirmado e preserva o restante selecionado. Nenhuma alteração de
código foi necessária nesses cenários. Esses resultados não substituem o aceite
na instalação real, ainda não informado pelo desenvolvedor.


A busca Last.fm sem artista utiliza `album.search`, paginação vinculada à consulta
atual e candidatos leves validados por nome/artista/URL. Ao adicionar, o editor
consulta `album.getInfo` para o candidato escolhido e o idioma do resultado.
Com artista informado, mantém a consulta direta existente. O diagnóstico distingue
os métodos e quantidades sem registrar chave ou URL autenticada. Regressões em
`tests/lastfm.test.mjs` e `tests/opening.test.mjs` cobrem consulta por título,
paginação, escolha, identidade, credencial e privacidade. O teste real de
Give 'Em the Boot III confirmou Various Artists como primeiro resultado e 21
faixas nos detalhes, sem texto Sobre o álbum nessa resposta.

`CopyFieldButton` reutiliza o padrão visual do merge nos campos das fontes de
Música/Vídeo: estado neutro, usado da fonte atual e usado de outra fonte.
`src/albums/field-copy-status.ts` compara serviço/álbum e preserva origens de
composições e edições manuais. Extras mantêm a origem em estado do formulário;
somente seus valores selecionados são enviados ao Libib. Clicar novamente continua
copiando, sem bloquear a troca. Restauração/desmarcação atualizam o indicador.
Testes em `tests/field-copy-status.test.mjs`; Chromium validou campos básicos,
extras, edição manual, restauração, troca Discogs/iTunes e Last.fm sem artista.
Suíte de 31 arquivos, tipos, build e diff-check aprovados.


`metadataProductCode` encaminha EAN/UPC somente a Spotify/Discogs e distingue os
códigos de 12 e 13 dígitos. A consulta inicial do modal aguarda serviços e contexto
nativo para não perder os códigos. O snapshot do lápis preserva identificadores
válidos do item independentemente de controles editáveis; eles seguem pelos
parâmetros do editor sem habilitar sua edição. A troca de serviço remove ambos
os identificadores da consulta quando não suportados. Regressões em
`tests/metadata-search.test.mjs` e `tests/libib-edit.test.mjs`.

Se `SpotifyClient.albumDetails` já obteve faixas e demais dados para conferir o
identificador, formata uma descrição ligada ao mesmo álbum no candidato.
`descriptionFromSearch`/`loadAlbumDescription` reutilizam esse documento sem rede,
respeitando cancelamento. Caso os dados opcionais sejam inválidos, a resolução
por código continua funcionando e a geração explícita segue disponível. Testes
em `tests/spotify.test.mjs` e `tests/album-description.test.mjs` confirmam ausência
de uma segunda consulta e descrição pronta ao adicionar.

`ManualMusicFields` mostra somente a observação da fonte na coluna de origem;
a observação do valor copiado permanece no rascunho, evitando duplicação após
copiar preço/duração. Chromium com respostas controladas conferiu código na
primeira busca Spotify, UPC, troca de serviço, descrição sem nova consulta e uma
única observação de preço em cada área. Suíte de 31 arquivos, tipos, build e
verificação de espaços aprovados; versão 0.5.0 preservada.


O adaptador Discogs usa integralmente `formatAlbumDescription`: seções extras
(país, formato, catálogo e outros identificadores) e `sourceCredit` seguem como
dados do formatador. Os metadados usam linhas consecutivas antes das faixas;
o rodapé comum recebe o crédito obrigatório e o link. Não há montagem separada
do texto no adaptador. Avisos de faixas parciais e atribuição no merge/edição
manual são preservados. Regressões em `tests/discogs.test.mjs`; suíte de 31
arquivos, tipos, build e verificação de espaços aprovados.


`formatDescriptionText` centraliza a montagem de metadados, blocos de texto,
faixas e rodapé para todos os serviços. `formatAlbumDescription`, `LastfmSource`
e o documento TMDb delegam a ela; somente a extração e os rótulos dos campos
permanecem nos adaptadores. Last.fm preserva o texto original de Sobre o álbum,
seus parágrafos e crédito; TMDb preserva a sinopse e os rótulos de vídeo. Textos
longos continuam disponíveis para revisão antes do limite de aplicação ao Libib.
Discogs preserva `notes` literalmente em `releaseNotes` e `manualFields.notes`,
separado da descrição estruturada e do merge. Last.fm mantém `wiki.content` e
`wiki.summary` originais em `rawAbout`/`rawSummary` para Notas, enquanto
`about`/`summary` continuam como texto tratado para descrição/mesclagem. TMDb
oferece `overview` diretamente em Notas. Por solicitação explícita do desenvolvedor,
Notas não acrescenta título, fonte, URL ou termos e não normaliza o texto recebido. Last.fm/TMDb mantêm seus textos na descrição. Ausência do texto
omite a opção de cópia; copiar prepara o rascunho e só os campos selecionados são
aplicados. Não há consulta adicional. Regressões em
`tests/discogs.test.mjs`,
`tests/album-description.test.mjs` e `tests/lastfm-source.test.mjs`; suíte de 31
arquivos, tipos, build e verificação de espaços aprovados. Chromium confirmou
Last.fm e TMDb, incluindo cópia fiel e confirmação de substituição.


`UnusedDataBadge` é compartilhado pelos cards de Música e Vídeo. A regra pura
`hasUnusedCardData`, em `src/albums/field-copy-status.ts`, compara os atributos
fornecidos/aplicáveis por card com os campos selecionados globalmente no rascunho;
a fonte e os valores copiados não mudam essa cobertura por atributo. Cada editor
reutiliza `extraSource` para os dados da fonte e do indicador, incluindo somente
extras presentes no contexto nativo. Descrição não carregada e capa indisponível
não contam como dados oferecidos. Nenhuma consulta ou gravação adicional.
Regressões em `tests/field-copy-status.test.mjs` cobrem compartilhados, exclusivos,
restauração e ausência de dados. Chromium com respostas controladas validou Música
e Vídeo com/sem extras: cópia de outra fonte, tags exclusivas, restauração,
+ todos, desmarcação e layout estreito, sem escrita na coleção real.


`UseInSearchButton` compartilha o atalho do rascunho para a busca nos editores e
em `ManualMusicFields`. Leva título/artistas/códigos sem alterar seleção, origem
ou valor do campo nativo; artistas são unidos por vírgula na consulta musical.
Respeita os limites da busca e só mostra atalhos de códigos em fontes compatíveis.
Resultados/continuação anteriores são invalidados sem consulta automática.
Chromium com respostas simuladas validou Música/Vídeo com/sem extras, valores
iniciais de EAN/UPC, campos editados, artista múltiplo, vazio desabilitado e ausência
de chamadas de busca adicionais ao usar os atalhos. Build/tipos aprovados.


`SearchResultsSkeleton` compartilha três cartões de carregamento entre Música e
Vídeo, com capas proporcionais à mídia, ícones de disco/filme e linhas que reproduzem título/metadados. O brilho usa `search-results-shimmer` no pseudo-elemento dos blocos, com deslocamento horizontal visível e ciclo de 1,3 segundo.
O estado é específico da busca, separado da inclusão/aplicação de dados. Nova
busca oculta resultados anteriores durante a espera; paginação os preserva.
Blocos decorativos ficam fora da leitura assistiva e o contêiner indica ocupado;
a preferência `prefers-reduced-motion` desativa a animação. Busca encerrada ou com
erro remove os cartões de espera. Build/tipos aprovados; Chromium com respostas
simuladas conferiu os dois editores, término, falha e movimento reduzido.


Refinamento visual do carregamento conferido em captura do Chromium: capas com
ícones, linhas de tamanhos variados e ação discreta em vez de grandes blocos
arredondados. A validação mediu a transformação do brilho em instantes distintos
para comprovar movimento e confirmou sua desativação com movimento reduzido.


Rolagem de modais e iframes fica contida por regras compartilhadas em `src/ui.css`:
`html:has(dialog[open])` bloqueia a página de fundo, `overscroll-behavior: contain`
isola as bordas de rolagem e `scrollbar-gutter: stable` evita deslocamento lateral.
Fechar o último diálogo restaura a rolagem sem sobrescrever estilos do Libib.
Chromium com o componente real de combinação confirmou roda do mouse no cabeçalho,
painel sem rolagem e limite de conteúdo, fundo imóvel, conteúdo rolável, restauração
ao fechar e limite do iframe sem rolar a página pai. Build/tipos e diff-check aprovados.


`matchingCatalogSources` percorre os cards em ordem de inclusão e utiliza
`matchingCatalogFields` para reconhecer valores não vazios contra o contexto
original e o valor atual do rascunho. Cada atributo mantém a primeira fonte igual,
sem bloquear a comparação das seguintes por ausência ou divergência anterior.
Não altera `included`, origem persistida ou patch. Música usa a ordem do modelo;
Vídeo usa a ordem de inclusão nas propriedades dos cards, independente da ordem
visual fixa dos serviços. `CopyFieldButton` recebe `matchedSource` como origem
visual de fallback; a cópia explícita selecionada tem prioridade. Extras usam o
mesmo componente e os campos reconhecidos contam na cobertura da etiqueta.
Editar para um valor diferente remove o reconhecimento; remover uma fonte permite
reconhecer a próxima correspondente. A comparação normaliza extremidades/quebras
de linha e separadores das listas de nomes/tags, sem ignorar caixa dos textos ou
remover zeros dos códigos. Capas não são comparadas; não há consultas adicionais
ou tratamento diferente apenas pelo modo de edição/inclusão.
Regressões em `tests/field-copy-status.test.mjs`, suíte de 31 arquivos, tipos/build
e seis cenários Chromium aprovados. O caso real “ST2 Records, Eagle Records,
Montreux Sounds” foi reproduzido com primeiro card divergente e segundo igual:
verde no correspondente, amarelo no anterior, etiqueta atualizada e sem selecionar
campos para salvar. Valores vazios, edição manual e cópia explícita preservados.


Miniaturas Discogs: a pedido do desenvolvedor, `DiscogsSearchThumbnail` reutilizado
nos resultados de Música/Vídeo exibe somente `searchThumbnailUrl` da busca.
`isDiscogsSearchThumbnailUrl` limita a HTTPS nos hosts i.discogs.com/img.discogs.com,
sem credenciais, portas, query ou fragmento. A imagem é carregada diretamente pelo
browser, com lazy loading e sem Referer, apenas para consulta; falha volta ao ícone.
Não há fetch autenticado de imagem, persistência adicional, ampliação para capa ou
transferência ao Libib. Detalhes da edição não carregam a miniatura e o pipeline de
capas continua recusando Discogs. Crédito/link permanecem junto de cada resultado.
Termos da API conferidos em 19/11/2026: uso pessoal de dados restritos na aplicação
é distinto da transferência a terceiros, que permanece excluída. Fonte:
https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use .
Regressões de URL/isolamento em `tests/discogs.test.mjs`; suíte de 31 arquivos,
tipos/build e quatro cenários Chromium aprovados, incluindo imagem válida/falha em
Música/Vídeo e ausência de cópia individual/total da capa. Versão 0.5.0 mantida.


Cliente UPCitemdb em `src/streamings/upcitemdb.ts`, conectado ao worker; habilitado
na composição de Música e Vídeo. Usa somente `/prod/trial/lookup` e `/prod/trial/search`,
sem chave/cookies/redirect. Código com dígito válido primeiro; retorno não exato ou
vazio pode seguir para título/artista. Paginação usa o offset retornado pela API,
vinculado à consulta/mídia e limitado aos primeiros mil resultados. Dados incluem
título/códigos/descrição/marca/modelo/categoria e URLs HTTPS de imagens; marca não
é artista/diretor/estúdio, ofertas/preços e dados de usuário são descartados.
O cliente não busca imagens; URLs normalizadas podem ser usadas pelo pipeline compartilhado de capas da composição de Música/Vídeo.
Categorias de DVD podem estar incorretas: formatos do título ajudam na relevância;
produtos claramente alheios, como roupa, são filtrados da pesquisa textual. Não há
escolha automática de edição nem troca do código informado pelo usuário.
Fila única com espaçamento global de 10s e 15s entre buscas textuais; cache de
respostas normalizadas em memória por 5min, até 64 consultas, incluindo vazio.
Cache reavaliado na fila evita repetir pedidos simultâneos e devolve cópias.
Quotas locais de 100 pedidos/20 pesquisas por dia UTC; documentação diverge sobre
20/40 pesquisas, então o cliente usa o menor valor. Headers da API, reset e
Retry-After interrompem consultas, sem retentativa automática. O limite real é
por IP; contadores/cache locais pertencem à instância em memória. Espera e fetch
admitem cancelamento; timeout de rede comum de 20s. Diagnóstico não inclui query,
código consultado, URLs, corpo ou dados pessoais. Nenhuma nova permissão/tela.
Fontes: https://www.upcitemdb.com/wp/docs/main/development/plan/ ,
https://www.upcitemdb.com/wp/docs/main/development/api-rate-limits/ e
https://devs.upcitemdb.com/ . Dez cenários em `tests/upcitemdb.test.mjs`, suíte de
32 arquivos, tipos/build e diff-check aprovados. Resposta real Ramones Raw foi
projetada e filtrada sem nova consulta por cada item ou gravação no Libib.


UPCitemdb no worker: `upcitemdb:search` aceita mídia/origem e `metadata:search` atende
Música com o mesmo cliente. Continuação envolve o cursor do cliente com a assinatura
do contexto Libib; origem, mídia e códigos divergentes não podem reutilizá-lo.
Permissão adicional limitada a `https://api.upcitemdb.com/*`. Não exige credencial,
não participa de STREAMINGS/preferências de reprodução e o seletor de Música inclui a fonte; Vídeo permanece na integração visual anterior.
`src/albums/upcitemdb-source.ts` revalida identidade/produto, constrói candidatos
com `artists: []` e delega a montagem textual a `formatDescriptionText`. Marca,
Modelo e Categoria são seções próprias do merge, sem mapear marca para estúdio ou
criadores. EAN/UPC são os campos nativos oferecidos. Descrição original permanece
no bloco Sobre o produto; geração automática reutiliza a pesquisa e não faz nova
consulta. Imagens HTTPS do produto são expostas como artworkUrl/variantes e validadas pelo pipeline compartilhado na composição de Música. O modelo preserva artista/capa existentes e permite
revisar texto longo antes do limite de aplicação.
`searchByService.upcitemdb` integra a exportação de diagnóstico existente. Armazena
até cinquenta eventos com projeção explícita de método/estado/quota/tempo/código,
incluindo bloqueios locais e detalhes limitados de transporte. Query, código de
barras, URL, corpo, ofertas, mensagens brutas e credenciais ficam fora desse log.
A projeção também é reaplicada ao exportar, e falhas de storage do log são isoladas.
Validação em `tests/upcitemdb-source.test.mjs` e `tests/opening.test.mjs`, usando o
handler real e respostas controladas: origem/permissões, dados ausentes, cache,
descrição sem rede, códigos conflitantes, HTTP/429, cursores, preservação de campos
e privacidade. Suíte de 33 arquivos, tipos/build e diff-check aprovados; sem escrita
na coleção real ou mudança da versão 0.5.0.


UPCitemdb em Música usa a seleção/resultados/cards existentes, agora com sete
fontes, código opcional e consulta sem título quando há EAN/UPC. `metadataProductCode`
encaminha códigos também a esta fonte e os remove ao trocar para uma sem suporte.
`UpcitemdbProductInfo` compartilha apresentação de marca/modelo/categoria/códigos e
link, sem atribuir esses dados a artista/estúdio. Ausência de artistas é esperada
nesta fonte: campo de cópia e alerta negativo por artista ausente são omitidos.
O rascunho mantém artistas/estúdio/notas existentes; a descrição é automática e
Marca/Modelo/Categoria participam do merge comum. Etiquetas e reconhecimento por
atributo continuam compartilhados. Sem imagem não inicia pedido de capa.
`upcitemdbCandidate` projeta URLs HTTPS do produto em artworkUrl/variantes;
`fetchAlbumArtwork` revalida produto e identidade e recusa URLs injetadas fora
nessa lista. Reutiliza limites/tipos/decodificação/dimensões do pipeline atual,
sem nova permissão de hosts de imagens. Origens que não autorizarem CORS podem
falhar, mantendo os outros dados. URLs locais/IPs/credenciais e de Discogs são
recusadas; Discogs mantém somente miniatura de pesquisa. Uma imagem real do
retorno Ramones Raw respondeu HTTP 200/JPEG e Access-Control-Allow-Origin: *, sem
escrita no Libib. O ícone é SVG local de código de barras, incluído no manifesto.
Regressões em `tests/upcitemdb-source.test.mjs`, `tests/upcitemdb.test.mjs`,
`tests/metadata-search.test.mjs`, `tests/lastfm-source.test.mjs` e
`tests/opening.test.mjs`. Suíte de 33 arquivos, tipos/build e Chromium em três
modos aprovados: código primeiro/código sem título, paginação, capa válida/falha/
ausente, descrição sem nova consulta, cópia/restauração de EAN, artista/estúdio/notas
preservados, merge, seleção/confirmacão de descrição, troca de fonte sem códigos,
quota/vazio, indicador de dados aproveitados e tela estreita. Roteiro
`/tmp/collection-to-play-upcitemdb-music-browser.mjs`; mensagens de aplicação
capturadas e respondidas no harness, sem submit/POST ou escrita em coleção real.


UPCitemdb em Vídeo integra `src/pages/metadata/video-editor.tsx` como terceira
fonte ao lado de TMDb/Discogs, sem depender das credenciais dessas fontes. Usa
`upcitemdb:search` com mídia movie, origem e continuação; revalida candidatos e
reutiliza a descrição inicial ao adicionar e combinar, sem outro pedido ao catálogo.
Título/códigos/capa usam revisão, cópia seletiva e estados comuns; dados ausentes
não substituem diretores, elenco, estúdio, data ou notas. Formulários sem campos
adicionais preservam o código inicial somente para busca.

`loadAlbumArtworkResource` mantém o recurso do card e o rascunho retém uma
referência ao copiar a capa. Remover o card não revoga o blob ainda usado pelo
rascunho; restaurar/fechar libera a referência. A aplicação usa o File carregado,
sem novo download. Retry recarrega somente a imagem; ausência de imagem não
dispara pedido. O preview comum aceita capas verticais com dimensões/formato/bytes.

Suíte de 33 arquivos, tipos/build e diff-check aprovados após habilitar Vídeo.
Chromium controlado em `/tmp/collection-to-play-upcitemdb-video-browser.mjs` e
relatório correspondente: edição completa, lápis, inclusão manual e formulário
limitado; código com zero inicial/sem título, paginação, ausência de credenciais,
cópia/restauração, preservação de campos, estados/etiqueta, merge com TMDb, confirmação
de descrição, quota/vazio, capa ausente/falha/retry/vertical e largura estreita.
Retenção após remover card, File aplicado sem download adicional e liberação
no reset e unmount também conferidos. O unmount usa bundle temporário do componente
real; os fluxos usam o build dist. Respostas e confirmação assíncrona da aplicação
são simuladas, sem submit/POST ou gravação na coleção real. A rodada conjunta
posterior está registrada abaixo; versão 0.5.0 mantida.


Validação conjunta UPCitemdb: `npm test` e `npm run build` aprovados sobre a
mesma árvore, seguidos dos roteiros Chromium de Música e Vídeo sobre o mesmo
`dist/`. Resultado: 33 arquivos de testes e sete cenários de interface aprovados
(três de Música, três de Vídeo e um de Vídeo com campos limitados). Sem alteração
de código de produção nesta rodada.

O teste do worker em `tests/opening.test.mjs` verifica os dois contratos reais
com transporte controlado: lookup compartilhado em cache entre Música e Vídeo,
descrição reutilizada, credencial desnecessária, origem/identidade/continuação
validadas, imagem sem consumir consulta do catálogo, falhas HTTP/429 e projeção
do diagnóstico comum. `tests/upcitemdb.test.mjs` cobre código sem correspondência,
alternativa textual, código sem título, paginação, quotas e preservação de zeros;
`tests/upcitemdb-source.test.mjs` cobre campos ausentes, preservação da composição
e capa validada. Os roteiros de UI simulam as mensagens runtime e a confirmação
de aplicação; não exercitam uma conexão de extensão instalada ao Libib real.

Relatório consolidado: `/tmp/collection-to-play-upcitemdb-final-result.json`.
Logs desta rodada: `/tmp/collection-to-play-upcitemdb-final-tests.log`,
`/tmp/collection-to-play-upcitemdb-final-build.log`,
`/tmp/collection-to-play-upcitemdb-final-music-browser.log` e
`/tmp/collection-to-play-upcitemdb-final-video-browser.log`.

Conferência real pendente do desenvolvedor: recarregar a extensão a partir de
`dist/`, abrir Música/Vídeo pela edição completa, lápis e inclusão manual, buscar
por código e por título e conferir cópia/restauração de campos, preservação de
artista/diretores/estúdio, capa e confirmação de descrição. Na edição completa
e manual, conferir o preenchimento antes de salvar/enviar no Libib; o lápis
aplica imediatamente os campos marcados. Registrar o resultado e eventuais erros
antes de encerrar o aceite. Versão 0.5.0 mantida, sem commit/tag/push.


A base de leitura local de EAN/UPC está em `src/barcodes/barcode-decoder.ts`,
com `@ericblade/quagga2` fixado em 1.13.0 e avisos Quagga2/gl-matrix em `NOTICE.txt`.
O plugin de build em `vite.config.mjs` emite `dist/barcode-decoder.js` com exports
preservados e uma dependência Quagga carregada sob demanda de um chunk local.
Não há captura de câmera ou controle de leitura habilitado nesta etapa.

`decodeBarcode` recebe um Blob de foto ou quadro capturado, aceita JPEG/PNG/WebP/BMP
até 12 MiB e 24 megapixels e retorna um código/formato validado ou ausência de
leitura. Imagem corrompida é recusada antes dos callbacks do Quagga. As tentativas
usam resolução original e, se necessário, 800 px, localização e leitores UPC-A/EAN-13,
sem worker gerado por blob ou serviço externo. Leituras são serializadas entre
consumidores; AbortSignal é cooperativo entre etapas. Uma leitura ativa conserva
sua URL até o processamento terminar, mesmo se cancelada, e a libera ao final.

`parseBarcodeReading` confere formato, comprimento e dígito verificador por
`normalizeProductCode`. `barcodeValueForTarget` mantém o texto lido para busca,
acrescenta um zero para converter UPC-A em EAN-13 e remove somente esse zero
para a representação UPC-A equivalente; EAN não iniciado por zero não cabe em UPC-A.
Nunca há conversão numérica ou remoção genérica de zeros iniciais.

O pacote fornece declarações antigas incompatíveis com TypeScript 7. A integração
importa sua distribuição de navegador e usa `src/barcodes/quagga-browser.d.ts`
para tipar somente a API consumida, sem desligar verificações globais de tipos.
A execução real do build é conferida no Chromium.

`tests/barcode-decoder.test.mjs` cobre formatos/dígitos inválidos, zeros e destinos,
segunda tentativa, filas, cancelamento, erros e liberação de URLs. Suíte de
34 arquivos, tipos/build e diff-check aprovados. Roteiro
`/tmp/collection-to-play-barcode-decoder-browser.mjs` e relatório correspondente
validaram o módulo de `dist/` sob `script-src 'self'; object-src 'self';`: seis
fotos públicas, três códigos gerados, quadro simulado, imagem vazia/corrompida,
MIME/dimensões inválidos e recuperação após erro, sem serviço remoto de leitura.
As sete regressões de interface Música/Vídeo também passaram sobre o novo build.
Câmera física e permissões da extensão instalada/iframe ainda dependem da etapa
de interface e da conferência real; não foram exercitadas por esses testes.


O leitor compartilhado está em `src/components/barcode-reader.tsx`, com estado e
ciclo de recursos em `src/barcodes/barcode-reader.ts`. `BarcodeReaderButton`
oferece leitura e, após indisponibilidade da câmera, passa a oferecer foto.
`BarcodeReaderDialog` também permite escolher foto durante a solicitação de
permissão ou tentar a câmera novamente. O resultado é revisável/editável e só
é devolvido por `onUse` após confirmar **Usar código**; conversão para EAN/UPC
respeita o destino. Enter no campo de revisão não submete o formulário pai.

A câmera solicita somente vídeo, com preferência de câmera traseira e resolução
ideal 1280×720. A captura recorta os 70% centrais da largura e 35% da altura,
preservando os pixels originais; a mira acompanha essa área mesmo com barras
pretas na prévia de vídeo em orientação vertical. Há somente uma
decodificação ativa por sessão e duas leituras consecutivas iguais são necessárias
antes da revisão. A captura termina ao reconhecer o código, usar foto, cancelar,
pressionar Escape, ocultar a página, desmontar ou navegar o iframe. Autorização
tardia tem suas tracks encerradas sem atualizar uma sessão fechada. Foto usa o
mesmo decodificador local; ausência de código, imagem inválida ou EAN sem
equivalência UPC-A não preenchem o campo.

`src/components/catalog-ui.tsx` delega `allow="camera"` somente ao iframe do
editor. Não foram adicionadas permissões de manifesto, áudio ou alterações de
CSP. A política da página pai ainda pode bloquear a câmera; nesse caso o leitor
oferece foto. Referência: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia .
`vite.config.mjs` emite `barcode-reader.js` e `src/ui.css` contém o estilo compartilhado.
Os pontos de entrada em Música e Vídeo estão habilitados conforme as etapas
de integração descritas abaixo.

`tests/barcode-reader.test.mjs` cobre sessão, confirmação, erros, concorrência,
autorização tardia, cancelamento e interrupção. Suíte de 35 arquivos, tipos/build
e diff-check aprovados. `/tmp/collection-to-play-barcode-reader-browser.mjs`
e relatório correspondente aprovaram 14 cenários: câmera ausente/ocupada/negada,
API ausente, leitura real de foto/quadro simulado, revisão/correção, conversão
por destino, imagem inválida/vazia, Enter sem submit, largura estreita, Escape,
página oculta, unmount, navegação do iframe e autorização tardia. Uma extensão
de teste instalada com o mesmo identificador e CSP padrão confirmou getUserMedia
com câmera virtual no iframe delegado e a alternativa por foto quando a página
pai aplicou `Permissions-Policy: camera=()`. Fixture usa bundle temporário do
componente real e importa também o módulo produzido em dist para conferir exports.
As sete regressões existentes de Música/Vídeo também passaram. Sem acesso à
coleção real ou câmera física; a conferência com o Libib real continua pendente.


Leitura em Música integrada em `src/pages/metadata/metadata-editor.tsx` e
`src/components/manual-music-fields.tsx`. A busca mostra o leitor somente quando
`metadataUsesProductCode` é verdadeiro. O rascunho oferece EAN/UPC somente entre
os controles nativos disponíveis e desabilita a leitura se o maxLength real não
comportar o código completo. Confirmação do leitor passa pelo mesmo onChange
dos campos, seleciona apenas o destino e limpa atribuição/notas de fonte: código
lido localmente não é atribuído ao card. A restauração existente é reutilizada.

`BarcodeReaderButton.fieldLabel` diferencia busca/EAN/UPC por nome acessível.
Disponibilidade constatada da câmera é compartilhada em memória entre os botões
da página, sem guardar permissões. Após negação, todos oferecem foto; tentar a
câmera com sucesso restaura o modo leitor. Estilo do grupo de busca em
`src/pages/metadata/metadata-editor.css`; fluxo compartilhado sem duplicar captura.

`MetadataSearchSession.clearResults` remove o cache/cursor da fonte selecionada
e invalida respostas pendentes, sem consulta e preservando caches de outras
fontes. Edição/scan do código de busca usa essa operação, inclusive quando o
valor confirmado é igual ao anterior. Leitura no rascunho não muda a consulta
ou seus resultados. Regressão em `tests/metadata-search.test.mjs`.

Suíte de 35 arquivos, tipos/build e diff-check aprovados.
`/tmp/collection-to-play-barcode-music-browser.mjs` e relatório correspondente
validaram o build real em uma extensão de teste instalada, com resources
acessíveis conforme o manifesto gerado e transporte de catálogo controlado.
Cinco cenários: edição completa, lápis, inclusão manual, formulário sem campos
EAN/UPC e limites nativos menores. Câmera simulada/foto, negação compartilhada,
revisão, Enter/cancelamento sem ação, zeros/destinos, restauração, campo
selecionado, origem manual, códigos sem título, paginação/resposta tardia, troca
de fonte, busy e largura estreita aprovados. Capturadas somente mensagens de
aplicação; confirmação rápida simulada por campo e nenhuma gravação real.
Os 14 cenários do leitor compartilhado e sete regressões de composição
Música/Vídeo também passaram. Logs `/tmp/collection-to-play-barcode-music-tests.log`,
`/tmp/collection-to-play-barcode-music-build.log` e
`/tmp/collection-to-play-barcode-music-browser.log`. Câmera física e aceite real
permanecem pendentes; versão 0.5.0 mantida.


Leitura em Vídeo integrada em `src/pages/metadata/video-editor.tsx`: mesmo
`BarcodeReaderButton` da Música, na busca Discogs/UPCitemdb e nos campos EAN/UPC
do rascunho quando disponíveis. TMDb não mostra código na busca; os controles
nativos do rascunho continuam podendo receber leitura. Limites reais do campo
e busy são respeitados; campo ausente não recebe botão.

Confirmação na busca só preenche código, limpa resultados e ambas as paginações
e orienta consultar explicitamente. Revisão de busca invalida retornos antigos
de UPCitemdb/Discogs/TMDb, incluindo erros, continuação e respostas após unmount.
A interface de Vídeo mantém seus controles desabilitados durante uma busca; o
roteiro força uma invalidação por evento para verificar a proteção de retorno.
Confirmação no rascunho seleciona somente o campo lido e limpa atribuição de fonte
do atributo. Mantém diretores, elenco, estúdio, data, notas, cards e consulta;
restauração existente preservada. Não duplica decodificador/captura ou permissões.

Suíte de 35 arquivos, tipos/build e diff-check aprovados.
`/tmp/collection-to-play-barcode-video-browser.mjs` e relatório correspondente
validaram cinco cenários sobre o build real em extensão de teste instalada:
edição completa, lápis, inclusão manual, campos EAN/UPC ausentes e limites menores.
Câmera simulada/foto, negação compartilhada, revisão/correção, Enter/cancelamento,
zeros/destinos, restauração, seleção/origem, preservação dos demais dados, código
sem título, paginação/resposta tardia, busy, troca TMDb/Discogs e largura estreita
aprovados. Aplicação capturada em mensagem, com confirmação por campo simulada
na edição rápida; sem gravação na coleção real ou uso de câmera física.
Quatro regressões existentes de composição de Vídeo e cinco de leitura de Música
também passaram. Logs `/tmp/collection-to-play-barcode-video-tests.log`,
`/tmp/collection-to-play-barcode-video-build.log`,
`/tmp/collection-to-play-barcode-video-browser.log`,
`/tmp/collection-to-play-barcode-video-source-regression.log` e
`/tmp/collection-to-play-barcode-video-music-regression.log`. Validação final
e conferência física/real ainda pendentes; versão 0.5.0 mantida.


Falha real reportada após conceder câmera no Chrome/Windows: consulta no documento
principal retornou política liberada, permissão `granted` e `NotAllowedError` com
`Permission denied by system`. `src/barcodes/barcode-reader.ts` agora distingue
essa assinatura a recusa pelo sistema operacional da recusa genérica do navegador
e orienta liberar a câmera na privacidade do sistema. Não mostra erros arbitrários
ou informações do dispositivo. Teste de regressão em `tests/barcode-reader.test.mjs`
confere a mensagem e nova tentativa com sucesso após desbloqueio simulado.

Suíte de 35 arquivos e build aprovados: `/tmp/collection-to-play-camera-system-tests.log`
e `/tmp/collection-to-play-camera-system-build.log`. Roteiro
`/tmp/collection-to-play-camera-system-browser.mjs` e relatório correspondente
confirmaram alternativa por foto, mensagem específica e recuperação do leitor
com confirmação explícita após desbloqueio simulado. O desenvolvedor identificou
o ESET como origem do bloqueio; após liberá-lo, a câmera abriu. Nenhuma alteração de permissão,
manifesto ou versão foi feita para contornar o bloqueio.


Refinamento da captura: `cameraScanArea` e o componente do leitor recortam somente
a área central indicada pela mira, sem reduzir as barras antes da decodificação.
A foto permanece sem recorte. Testes de limites/centralização, suíte de 35 arquivos
e build aprovados (`/tmp/collection-to-play-camera-crop-tests.log` e
`/tmp/collection-to-play-camera-crop-build.log`). Chromium confirmou leitura de
códigos sintéticos de 180 a 400 px em vídeo 1280×720, duas capturas antes da revisão
e alinhamento da mira em paisagem/retrato: relatório
`/tmp/collection-to-play-camera-crop-browser-result.json`. A confirmação de leitura
com a câmera física continua pendente.

Os sete serviços de Música usam linhas de quatro e três botões; em contêineres
até 300 px, três, dois e dois, com ícone acima do nome para preservar a leitura.
Estilos limitados a `.music-services` em `src/pages/metadata/metadata-editor.css`
e marcação em `src/pages/metadata/metadata-editor.tsx`. Validado nos cinco fluxos
do harness integrado de Música e em larguras de 320, 390, 980 e 1280 px.


Cópia de pendentes: `copyButtonState` em `src/albums/field-copy-status.ts` é
compartilhado pelo botão individual e pelas ações **+ Pendentes** dos editores
Música/Vídeo. Somente campos disponíveis no formulário e no estado `available`
são copiados; preservam-se origens usadas, correspondências com o Libib e estados
de substituição. Inclui campos básicos, capa/descrição carregadas e extras
realmente disponíveis. A ação é desabilitada sem pendentes ou durante ocupação.

No modal compartilhado, `DescriptionMerge.pendingSections`/`choosePending` e
**Usar dados pendentes** acrescentam somente blocos não escolhidos, preservando
as escolhas de qualquer fonte e a edição manual conforme o modelo existente.
As ações de copiar todos continuam permitindo substituição explícita.
Regressões em `tests/field-copy-status.test.mjs` e
`tests/description-merge.test.mjs`; suíte de 35 arquivos e build aprovados em
`/tmp/collection-to-play-pending-fields-tests.log` e
`/tmp/collection-to-play-pending-fields-build.log`. Chromium: quatro cenários
Música/Vídeo com/sem campos extras, estado e ordem dos botões, preservação de
campos reconhecidos/de outra fonte, mesclagem, ausência de pendentes e largura
estreita aprovados em `/tmp/collection-to-play-pending-fields-browser-result.json`.
Respostas simuladas, sem gravação real na coleção. Versão 0.5.0 mantida.


Notas literais: testes de igualdade em `tests/discogs.test.mjs` e
`tests/lastfm-source.test.mjs` cobrem espaços, quebras, entidades/marcação,
texto longo e resumo como alternativa. Nenhum HTML é executado para apresentar
Notas; os componentes continuam renderizando valores como texto. Suíte de 35
arquivos, build e dois cenários Chromium de TMDb com/sem campo Notas aprovados:
`/tmp/collection-to-play-literal-notes-tests.log`,
`/tmp/collection-to-play-literal-notes-build.log` e
`/tmp/collection-to-play-literal-notes-browser-result.json`. Conferida igualdade
do valor copiado no rascunho, sem gravação real no Libib. Versão 0.5.0 mantida.


Last.fm habilitado como fonte complementar de Vídeo em
`src/pages/metadata/video-editor.tsx`. Reutiliza os contratos `metadata:search`,
`lastfm:album`, `lastfm:status` e `lastfm:artwork`, com `lastfmCandidate` e
`lastfmDescription`; sem nova API, permissão ou dependência. Busca por título/artista,
idioma pt/en, paginação vinculada à consulta e descarte de resposta atrasada usam
os contratos/revisão existentes. Diretores originais não inicializam o artista da
busca. Last.fm não recebe EAN/UPC e não oferece leitor de código na busca.

Card, cópia individual/todos/pendentes, reconhecimento por atributo e mesclagem
usam a mesma infraestrutura das fontes existentes. Notas e tags são os extras
copiáveis dessa fonte; não mapear artista para Diretores nem a soma das durações
das faixas para duração do vídeo. Descrição conserva faixas e atribuição; Notas
recebe o texto literal. Capas usam `AlbumArtworkResource` com identidade validada,
retentativa, cancelamento de carregamento e liberação por referência; o rascunho
retém a imagem para aplicação mesmo ao remover o card.

Suíte de 35 arquivos e tipos/build aprovados:
`/tmp/collection-to-play-lastfm-video-tests.log` e
`/tmp/collection-to-play-lastfm-video-build.log`. Chromium em
`/tmp/collection-to-play-lastfm-video-browser-result.json` aprovou cinco cenários:
completa, lápis, manual, configuração ausente/recuperada e capa falha/recuperada.
Conferidos paginação sem duplicação, invalidação após editar artista, busca sem
usar diretor/código, Notas literais, capa, tags, campos preservados, pendentes,
mesclagem com TMDb e confirmação, envio seletivo capturado por mensagem e largura
390 px. Cinco regressões de código de barras em Vídeo aprovadas em
`/tmp/collection-to-play-lastfm-video-barcode-regression.log`. APIs/Libib simulados,
sem gravação real ou consulta autenticada do show na API. Versão 0.5.0 mantida.
