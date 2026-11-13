# Contribuindo com Collection to Play

Instale as dependências com npm ci e execute npm test antes de propor mudanças.
O projeto usa Node.js 22+, TypeScript estrito e esbuild. Dependências de build
ficam em devDependencies; não existem dependências de execução instaladas no pacote.

## Estrutura

```text
src/contracts.ts       Contratos de consulta, candidatos, catálogos e mensagens.
src/libib.ts           Extração de itens de música e ações no catálogo Libib.
src/library.ts         Integração das ações e painel na página do catálogo.
src/spotify.ts         OAuth PKCE, sessão, busca e metadados do Spotify.
src/youtube-music.ts   Busca de álbuns não oficial, parser e validação de links.
src/resolution.ts      Correspondência e regras de escolhas lembradas.
src/identifiers.ts     Validação e equivalência de UPC/EAN.
src/album-search-title.ts Limpeza comum dos títulos extraídos do catálogo.
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
