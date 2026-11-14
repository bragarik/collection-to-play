# Collection to Play

Abra os álbuns da sua coleção no streaming escolhido, a partir do próprio catálogo.
Extensão de código aberto para Chrome, desenvolvida em TypeScript e Manifest V3.

Repositório: https://github.com/bragarik/collection-to-play
Licença: GNU GPL versão 3; texto completo em [LICENSE](LICENSE) e autoria em [NOTICE.txt](NOTICE.txt).

## Estado atual

Integrações implementadas: Libib + Spotify e YouTube Music.
Catálogo suportado: https://www.libib.com/library e seus subcaminhos.

Deezer, Apple Music e Amazon Music estão planejados e aparecem
indisponíveis na configuração. Outros catálogos ainda não estão implementados.

## Instalação local

Requisitos: Node.js 22 ou superior, npm, Git e Chrome 120 ou superior.
Para abrir no aplicativo, o Spotify precisa estar instalado no computador.

1. Baixe e compile o projeto:

   ```bash
   git clone https://github.com/bragarik/collection-to-play.git
   cd collection-to-play
   npm ci
   npm run build
   ```

2. No Chrome, abra chrome://extensions e ative o Modo do desenvolvedor.
3. Clique em "Carregar sem compactação" e selecione a pasta dist gerada pelo build.
   Selecione dist, não src nem a raiz do repositório.
4. Abra o ícone da extensão, selecione Spotify ou YouTube Music e salve a preferência.
5. Para Spotify, clique em "Conectar Spotify" e conclua a autorização na janela oficial.
   YouTube Music dispensa login para esta busca.
6. Abra ou atualize https://www.libib.com/library.

O pacote é instalado localmente a partir deste repositório. Os arquivos de dist
não são versionados: é necessário compilar antes de carregar a extensão.

## Uso

Nos itens de música da listagem e dos detalhes do Libib, clique em "Ouvir no Spotify"
e escolha Web Player ou Aplicativo Spotify. A busca usa os dados disponíveis do
item: primeiro UPC/EAN, depois título e artista, ou apenas título quando não houver
artista. Códigos de edições físicas podem não corresponder à edição do streaming.

Spotify e YouTube Music compartilham a limpeza dos títulos extraídos do Libib:
removem prefixo repetido do artista, mídia como [CD]/[CD/DVD Combo] e rótulos finais
conhecidos como Stickered e explicit_lyrics. Termos de edição como Deluxe e
Remaster são preservados. A limpeza atua somente na consulta; o nome cadastrado
e a identidade das lembranças continuam usando os dados originais. Consultas
manuais no diagnóstico são mantidas como digitadas.

Um único resultado de uma busca completa abre diretamente. Havendo vários ou uma
lista ainda parcial, escolha um álbum no painel incorporado ao Libib. As capas
vêm do serviço escolhido quando disponíveis; se uma imagem falhar, aparece o símbolo de disco.
“Carregar mais resultados” consulta novamente o servidor do streaming com o código
de continuação. A lista visível pode conter apenas um candidato do artista mesmo
quando a resposta ainda indica outras páginas; nesse caso, mantém a escolha manual.

Para YouTube Music, clique em "Ouvir no YouTube Music". A busca usa título e artista
(ou somente título), mostra os candidatos no mesmo painel e abre a página do álbum
no navegador. Não usa UPC/EAN nem oferece URI de aplicativo nesta versão.
A busca usa um endpoint não oficial do YouTube Music, sem cookies, chave de API,
conta de desenvolvedor ou servidor. Mudanças no serviço podem exigir atualização
da extensão; não há garantia de estabilidade de uma API oficial.

Ao escolher um resultado da lista, o artista fica lembrado para aquele item.
Marque "Lembrar decisão" se também quiser guardar o álbum específico; a caixa
começa desmarcada. Sem essa marcação, novas buscas ficam restritas ao artista
lembrado e continuam pedindo escolha quando houver mais de um álbum desse artista.
As aberturas automáticas não criam, por si só, uma escolha manual lembrada.

A configuração usa seções expansíveis: **Streaming e conexão**, **Biblioteca Libib**,
**Diagnóstico de busca** e **Dados técnicos do Spotify**. Streaming começa aberto
quando precisa de configuração ou login; os demais grupos ficam recolhidos.
O indicador de atenção do Libib permanece visível no cabeçalho da seção fechada.

Na configuração, "Escolhas salvas" abre um modal para pesquisar e esquecer associações,
com paginação de vinte registros. O link "Abrir em tela inteira" abre a configuração em uma aba.
Esquecer remove artista e álbum daquele registro, preservando as demais escolhas
e o streaming preferido. Inclusão e escolha acontecem pelo álbum no Libib.

Quando o catálogo não fornece ID próprio do item, a lembrança usa a origem,
título, artista e códigos disponíveis. Itens com esses mesmos dados podem ser
indistinguíveis. O projeto não presume um ID interno do Libib que não foi verificado.

### Atualizar título e artistas de um item

Na edição de um item de música do Libib, a lista de campos inclui
"Atualizar dados via Spotify" ou "Atualizar dados via YouTube Music", conforme
o streaming configurado. A opção abre a busca dentro da página e permite
selecionar um álbum para conferir título e artistas, com capas e paginação.
A opção aparece no início da lista, com um destaque turquesa suave.
Você pode ajustar a busca se necessário.

Essa seleção consulta o serviço novamente, sem reutilizar o álbum lembrado para
ouvir. Ela não abre player nem altera as escolhas salvas. Na prévia, você pode
editar o título e os artistas antes de salvar; informe um artista por linha.
Clique em **Aplicar dados** para salvar os valores editados imediatamente, sem outro clique
no botão Salvar do Libib. A ordenação personalizada do título é preservada.
O salvamento usa o fluxo nativo do Libib para manter seus campos e a listagem sincronizados.

Os campos são enviados separadamente. A confirmação informa quando ambos foram
salvos ou quando um campo não pôde ser confirmado; nesse caso, confira o item
antes de tentar novamente. Os campos nativos recebem os valores confirmados e,
ao fechar a edição do Libib, o próprio site atualiza o álbum na listagem.
Se a atualização visual não puder ser confirmada, o painel orienta reabrir o item.
Durante o envio, aguarde a confirmação antes de fechar o painel.

Nomes de artistas com vírgulas, aspas ou quebras de linha exigem edição manual pelo
campo nativo: o formato de escape desses nomes ainda não está confirmado. A extensão
avisa antes de alterar qualquer campo. A preservação das lembranças após renomear
ainda está em desenvolvimento.

## Conectar ao Spotify

O Collection to Play já vem configurado com um Client ID fixo do projeto.
Para usar a extensão, você não precisa criar um aplicativo no Spotify Developer
Dashboard nem informar um Client ID: basta abrir o ícone da extensão, escolher
Spotify e clicar em **Conectar Spotify**, usando sua conta Spotify normal.

A conexão usa Authorization Code com PKCE, sem Client Secret na extensão e sem
servidor próprio. O Client ID é público e identifica o Collection to Play;
a autorização de cada usuário é individual.

Durante o modo de desenvolvimento do aplicativo, sua conta precisa estar na lista
de usuários autorizados pelo responsável pelo projeto. O acesso continua sujeito
aos [limites definidos pelo Spotify](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).
Um erro de acesso pode exigir que o responsável confira essa autorização.

Quem desenvolve um fork pode configurar outro aplicativo seguindo o
[guia de contribuição](CONTRIBUTING.md#aplicativo-spotify-de-um-fork).

## Atualização e desenvolvimento

Depois de atualizar os fontes:

```bash
npm ci
npm test
```

npm test verifica os tipos, compila para dist e executa os testes automatizados.
Para apenas verificar tipos: npm run typecheck.
Para apenas compilar: npm run build.

Recarregue a extensão em chrome://extensions e atualize a aba do Libib para que
os scripts da página usem a nova versão. O build substitui a pasta dist gerada.

Para manter o repositório público com uma instalação reproduzível, package-lock.json
é versionado e npm ci deve ser preferido em instalações a partir desse arquivo.

## Diagnóstico

No ícone da extensão, expanda "Diagnóstico de busca". O formulário permite testar
álbum, artista opcional e UPC/EAN. Preserve os zeros à esquerda dos códigos.

Para investigar uma ação do Libib, execute a ação no item e depois use "Exportar log
da busca" na configuração. Essa exportação lê a última busca; uma nova consulta no
formulário de diagnóstico substitui o registro anterior.

O JSON informa consultas, estratégias, respostas HTTP, paginação e metadados dos
resultados. No Spotify, ao exportar, consulta os detalhes de até vinte álbuns para acrescentar
UPC/EAN devolvidos e a comparação com os códigos solicitados. Informa quantos
resultados não foram consultados. Ausência de código no retorno é distinta de
código diferente. Falhas e limites do serviço são registrados.

Para YouTube Music, o log registra a consulta efetivamente enviada, versão do cliente,
status HTTP, tipo da resposta e código/mensagem de erro JSON retornados pelo serviço,
além dos candidatos e do resultado da resolução. Falhas sem resposta HTTP aparecem
separadamente. Não consulta códigos de barras nem exporta corpo bruto, cookies,
cabeçalhos de autorização ou tokens de continuação; mensagens têm tamanho limitado
e valores de credenciais identificáveis são ocultados.

O log não inclui senha, cookies ou cabeçalhos de autorização. Inclui títulos,
artistas, códigos e a URL de origem da biblioteca: revise esses dados antes de
compartilhá-lo. Logs exportados não fazem parte do repositório público.

## Diagnóstico da biblioteca Libib

Na configuração, a seção **Biblioteca Libib** apresenta a última avaliação registrada
para coleção, detalhes de álbum e edição. Indica estrutura reconhecida, possível
mudança ou informação insuficiente. Coleção vazia, página carregando e áreas ainda
não observadas não são apresentadas como prova de quebra. Reconhecer a estrutura
não garante o funcionamento de todas as operações.

Se o registro tiver sido feito por outra versão da extensão, reabra o Libib para
atualizar a verificação. **Atualizar informações** lê novamente o último registro
local; **Exportar diagnóstico Libib** baixa o JSON para investigação, separado do
log de busca do streaming. A exportação inclui data, versões, avaliações e eventos
filtrados, sem títulos, artistas, corpos de resposta ou autenticação.

O diagnóstico representa a última avaliação registrada, não uma garantia sobre
todas as abas abertas. Os resultados da atualização de título e artistas aparecem
no painel de aplicação e ainda não integram este diagnóstico.

## Dados e permissões

- A sessão Spotify, preferências e escolhas são mantidas no armazenamento local
  da extensão. Desconectar remove a sessão Spotify local, sem apagar as escolhas.
- Tokens ficam nos contextos confiáveis da extensão; a página Libib não os recebe.
- Verificações da estrutura do Libib são registradas localmente com avaliação,
  motivo, data e versão da extensão, sem copiar títulos, artistas ou conteúdo de
  formulários. A seção "Biblioteca Libib" na configuração mostra a última
  avaliação e permite exportar um diagnóstico filtrado.
- A autorização Spotify e sua pesquisa usam accounts.spotify.com e api.spotify.com.
  YouTube Music consulta music.youtube.com sem cookies. Capas válidas são carregadas
  de i.scdn.co, lh3.googleusercontent.com, yt3.googleusercontent.com ou i.ytimg.com.
- Os dados necessários à pesquisa são enviados ao streaming escolhido. Não há backend próprio,
  serviço de telemetria ou upload automático dos diagnósticos neste projeto.
- O content script atua somente na biblioteca Libib suportada. A extensão solicita
  identity, storage, declarativeNetRequestWithHostAccess e acesso aos hosts Spotify
  e YouTube Music indicados no manifesto. A regra de rede remove o cabeçalho Origin
  somente de POSTs da própria extensão ao endpoint de busca YouTube Music; não
  altera navegação normal do usuário nem chamadas Spotify.
- Uma integração local aciona os handlers nativos de título/artistas e confere
  suas respostas. O próprio Libib atualiza seus campos e a listagem ao fechar a edição. Esse script
  não recebe tokens Spotify nem acessa o armazenamento da extensão.

## Contribuição e estrutura

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para a organização do código, testes e orientações para
acrescentar outros catálogos ou streamings.
