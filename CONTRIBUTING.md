# Contribuindo com Collection to Play

Instale as dependências com npm ci e execute npm test antes de propor mudanças.
O projeto usa Node.js 22+, TypeScript estrito e esbuild. Dependências de build
ficam em devDependencies; não existem dependências de execução instaladas no pacote.

## Estrutura

```text
src/contracts.ts       Contratos de consulta, candidatos, catálogos e mensagens.
src/libib.ts           Extração de itens de música e ações no catálogo Libib.
src/libib-edit.ts      Cliente dos campos nativos de título e criadores do Libib.
src/libib-editor.ts    Opção do editor nativo e modal de seleção de metadados.
src/libib-metadata.ts  Validação dos metadados e resultado de cada campo salvo.
src/libib-native.ts    Gravação pelos handlers reais do editor nativo.
src/libib-native-entry.ts Entrada MAIN com acesso ao jQuery da página.
src/library.ts         Integração das ações e painel na página do catálogo.
src/spotify.ts         OAuth PKCE, sessão, busca e metadados do Spotify.
src/youtube-music.ts   Busca de álbuns não oficial, parser e validação de links.
src/resolution.ts      Correspondência e regras de escolhas lembradas.
src/identifiers.ts     Validação e equivalência de UPC/EAN.
src/album-search-title.ts Limpeza comum dos títulos extraídos do catálogo.
src/libib-diagnostics.ts Avaliação de estrutura e sanitização de diagnósticos Libib.
src/libib-observer.ts Coleta no DOM e envio após estabilidade dos sinais.
src/libib-diagnostic-store.ts Validação, deduplicação, armazenamento e leitura filtrada.
src/libib-diagnostic-ui.ts Avisos da última avaliação e exportação na configuração.
src/preferences.ts     Preferências e associações persistidas.
src/background.ts      Worker, mensagens, armazenamento e abertura de álbuns.
src/setup.html/.ts     Configuração aberta pelo ícone da extensão.
src/album-panel.*     Escolha de resultados incorporada ao catálogo.
scripts/build.mjs      Verificação de tipos e geração da pasta dist.
tests/*.test.mjs       Testes de resolução, serviços, abertura e persistência.
```

A compilação usa os fontes de src e copia os recursos estáticos para dist.
Erros de tipos ou compilação impedem substituir o pacote anterior. A instalação
local carrega exclusivamente dist pelo modo de desenvolvedor do Chrome.

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
2. Substitua `SPOTIFY.clientId` em `src/contracts.ts` pelo Client ID público dele.
3. Compile com `npm run build` e carregue/recarregue a extensão.
4. No ícone da extensão, expanda **Dados do aplicativo e endereço de retorno**.
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

`src/libib-diagnostics.ts` contém funções puras que avaliam observações de estrutura
por operação (coleção, detalhes e edição), sem acessar DOM, rede ou Chrome storage.
Os estados são estrutura reconhecida, mudança provável, informação insuficiente e
contexto não aplicável. Uma página vazia ou carregando não comprova quebra; versão
de CSS isolada não determina compatibilidade. Reconhecer campos de edição também
não confirma sucesso da gravação.

Os registros aceitam somente códigos, operação, data, versão da extensão, motivo
controlado, status HTTP e formato da resposta. Campos arbitrários e corpos brutos
são excluídos. O histórico mantém até cem eventos e rejeita formatos/versões
desconhecidos antes de substituir dados. Há testes para essas regras em
`tests/libib-diagnostics.test.mjs`.

A coleta de estrutura já está conectada em `src/library.ts`. Usa os seletores
comprovados da listagem e dos detalhes; elementos de edição continuam sem
verificação até integrar a observação do editor. Espera os sinais estabilizarem
por 500 ms e envia somente mudanças de avaliação. Verificações periódicas retomam
o envio após falha de entrega ou armazenamento.

O worker aceita observações somente do content script principal no caminho Libib
suportado, com URL do remetente correspondente. Recalcula os resultados, atribui a
hora e a versão da extensão e ignora alegações de gravação ou campos arbitrários.
O estado `libib.diagnostics` fica em armazenamento local restrito aos contextos
confiáveis; gravações são serializadas e avaliações iguais são deduplicadas mesmo
após reinício do worker. O snapshot representa a última avaliação registrada, não
um sinal de atividade contínuo nem uma garantia sobre todas as abas abertas.

`src/libib-diagnostic-ui.ts` mostra a última avaliação e exporta JSON pela configuração.
O canal `libib:diagnostics` é restrito às páginas da extensão; a leitura espera as
gravações em fila, valida o esquema/snapshot e retorna uma projeção dos campos
permitidos. A interface acompanha atualizações do storage sem renderizar seu
conteúdo bruto. Esquema desconhecido ou snapshot incoerente não é exportado nem
sobrescrito; registro de outra versão pede nova observação antes de afirmar o
estado atual. O arquivo exportado inclui a versão de observação e a de exportação.

Os resultados da aplicação de metadados ainda não estão conectados à coleta e à
exportação do diagnóstico Libib.

## Cliente de edição Libib

`src/libib-edit.ts` implementa o contrato nativo capturado na sessão autenticada.
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

`src/libib-editor.ts`, integrado pelo content script, reconhece somente editores
`.jump-edit` musicais com IDs válidos e os campos nativos de título e criadores.
Acrescenta uma opção à `.jump-list`, sem acionar os handlers nativos de Save/Cancel.
Ao abrir, carrega os dados do item e monta `album-panel.html?mode=metadata` em um
dialog com Shadow DOM. Fechar, trocar item/biblioteca, mudar de serviço ou remover
o editor cancela a leitura e descarta o painel anterior.

O painel reutiliza capas, busca e paginação, com seleção e prévia dos metadados.
O propósito `metadata` exige origem Libib válida e mensagem de uma página da
extensão. O worker consulta o streaming sem reutilizar escolhas lembradas e sem
criar uma seleção para abertura. O painel não oferece player ou gravação de
lembranças nesse modo, inclusive para um resultado único/exato.

O botão “Aplicar dados” envia somente título e nomes dos artistas ao content script.
A prévia usa input de título e textarea de artistas (um nome por linha), e o envio
lê seus valores atuais. Editar depois de salvar reabilita a ação; durante o envio,
os dois campos ficam bloqueados. A opção do editor é inserida no começo do menu
nativo, com fundo turquesa suave e borda discreta.
A ponte exige evento nativo de mensagem, origem da extensão, o Window do iframe,
sessão vigente e identificador de requisição correspondente. Eventos sintéticos,
mensagens da página e respostas de outra sessão são descartados. O cliente confere
o contexto atual antes de cada requisição, inclusive após reler a ordenação e entre
os dois campos. Fechar/Escape e cliques repetidos ficam bloqueados durante o envio.

`src/libib-metadata.ts` valida ambos os campos antes de escrever, remove nomes
duplicados e usa texto separado por vírgulas conforme a ajuda nativa capturada.
Como a captura não confirma escapes, nomes com vírgulas, aspas ou quebras de linha
são recusados antes da primeira gravação e orientam edição manual; não se presume
que o endpoint aceite JSON de artistas ou CSV com aspas.

Primeiro salva título, depois criadores. Uma falha interrompe a sequência sem retry
ou rollback. O resultado distingue campo salvo, não enviado e gravação não confirmada.
O texto de sucesso completo exige ambas as confirmações. `tests/libib-metadata.test.mjs`
verifica payloads, ordenação, falhas parciais, cancelamento e mudanças de contexto.
O [script completo de edição do Libib](https://www.libib.com/js/library/quick-edit.js?v=65),
também fornecido pelo desenvolvedor, mantém `item` e `saved` privados dentro de
`$(document).ready(...)`. Eles não podem ser alterados por acesso a globais.
A interface usa os handlers reais: seleciona o campo nativo, preenche somente os
inputs esperados e aciona seu Salvar. O título relê antes a ordenação no servidor.
Cada campo faz uma única gravação; não há um fetch de escrita em paralelo.
O próprio callback nativo atualiza seu cache privado e sinaliza o item como alterado.
O próprio `closeJumpMenu()` consulta `/quickedit/refresh-item` com `join_id`,
`view_type` e `loc=quick-edit-js` e substitui o conteúdo do item correspondente.
A extensão não repete a gravação nem executa manualmente essa requisição de refresh.

O manifesto registra `libib-native-entry.js` no [contexto MAIN do Chrome](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts),
somente na biblioteca Libib. `scripts/build.mjs` empacota essa entrada como IIFE,
sem exportações ou helpers globais que possam colidir com o site. A integração usa
o jQuery existente e valida origem, IDs de atributos e cache jQuery, editor musical
visível único, campo e inputs permitidos. Não recebe sessão Spotify ou Chrome storage.
Mensagens sintéticas/de outra origem são descartadas. Observadores temporários de
`ajaxSend`/`ajaxComplete` acompanham somente o POST correspondente a item, biblioteca,
campo, valor e ordenação esperados, sem substituir `$.ajax` ou handlers do site.
A confirmação vem depois do callback nativo e exige HTTP bem-sucedido e
`outcome=success`. Timeout/cancelamento aborta somente o XHR acompanhado e não
repete a escrita; erro restaura os controles do formulário quando o contexto ainda
é o mesmo. Handler ausente é informado antes de afirmar que houve envio.
`tests/libib-native.test.mjs` cobre o protocolo, os handlers, isolamento por item,
falhas HTTP/JSON, cancelamento, timeout e remoção dos observadores.

Preservar lembranças após renomear e registrar eventos da gravação no diagnóstico
continuam pendentes.
