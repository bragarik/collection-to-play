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

Requisitos: Node.js 22.12 ou superior, npm, Git e Chrome 120 ou superior.
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

### Compor dados de um álbum

Na edição rápida ou em **Detalhes → Editar**, use **Atualizar dados via streaming**.
Na edição rápida, a opção fica no início da lista; na completa, imediatamente à
esquerda de **Salvar**, mantendo o estilo dos botões nativos.

Escolha Spotify ou YouTube Music no combo, busque e adicione um álbum. Você pode
manter um álbum de cada serviço nos cards. Se precisar trocar uma edição, remova
o card daquele serviço e adicione outro. Os dados já copiados ficam no formulário.

Selecione um card para consultar título, artistas e capa. Use **+** para substituir
um campo no formulário principal ou **+ todos** para copiar os dados disponíveis.
Você pode combinar fontes, por exemplo título do Spotify e capa do YouTube Music.
O formulário mostra a origem de cada campo; os textos continuam editáveis e os
artistas são apresentados um por linha. Desmarque um campo para mantê-lo no Libib.
Adicionar, consultar ou copiar um card não grava alterações.

A capa mostra largura, altura, formato e peso. A extensão usa a maior variante
válida obtida, até 20 MB. Imagens abaixo de 300 × 300 pixels podem ser usadas com
aviso. A prévia copiada permanece disponível mesmo depois de remover seu card.

Na **edição completa**, **Preencher campos** prepara apenas os campos marcados,
inclusive somente a capa, e fecha o painel da extensão. Você conclui a gravação
pelo **Salvar do Libib**. Campos desmarcados, descrição, preço, tags, grupo, notas,
ordenação e rascunhos permanecem como estão. Um arquivo de capa já escolhido só
é substituído se você aplicar uma nova capa.

Na **edição rápida**, **Aplicar dados** salva imediatamente apenas os campos
marcados, inclusive somente a capa. A ordenação personalizada é preservada.
Cada campo é confirmado separadamente; uma falha interrompe os próximos envios.
Quando todos os campos escolhidos são confirmados, o popup de streaming fecha.
Se houver falha parcial ou resultado sem confirmação, ele continua aberto com o
aviso e desmarca os campos confirmados, mantendo os valores. Confira o item antes
de uma nova tentativa. Ao fechar a edição rápida, o Libib atualiza
a listagem usando seu fluxo nativo.

Nomes de artistas com vírgulas, aspas ou quebras de linha exigem edição pelo campo
nativo, pois o formato de escape ainda não foi confirmado. A extensão avisa antes
de alterar os campos escolhidos.

Se o Spotify exigir conexão, o painel oferece **Abrir configurações** e
**Verificar conexão**. Busca, cards e dados montados são preservados ao reconectar.
A escolha no combo não muda o streaming preferido para ouvir. Essas buscas não
abrem player nem alteram as escolhas lembradas.

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
npm run build
```

npm test verifica os tipos e executa os testes automatizados diretamente nos fontes.
O pacote é gerado separadamente por npm run build, usando Vite + CRXJS.
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
todas as abas abertas. O histórico registra leituras e resultados da gravação de
cada campo pela edição rápida, incluindo falhas parciais e respostas sem confirmação.
A configuração avisa quando a última tentativa de uma etapa falhou; uma tentativa
confirmada posterior da mesma etapa resolve esse aviso. Cancelar antes do envio
não é apresentado como falha do Libib.

Na edição completa, registra apenas o preenchimento dos campos. O salvamento
posterior pelo botão nativo do Libib não é acompanhado pela extensão. O diagnóstico
não guarda valores dos campos, IDs dos itens ou endereços da biblioteca.

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
  O acesso a esses CDNs também permite obter arquivos de capa sem cookies ou
  autenticação. Esses arquivos são temporários e não são gravados no catálogo
  automaticamente.
- Os dados necessários à pesquisa são enviados ao streaming escolhido. Não há backend próprio,
  serviço de telemetria ou upload automático dos diagnósticos neste projeto.
- O content script atua somente na biblioteca Libib suportada. A extensão solicita
  identity, storage, declarativeNetRequestWithHostAccess e acesso aos hosts Spotify
  e YouTube Music indicados no manifesto. A regra de rede remove o cabeçalho Origin
  somente de POSTs da própria extensão ao endpoint de busca YouTube Music; não
  altera navegação normal do usuário nem chamadas Spotify.
- Na edição rápida, uma integração local aciona os handlers nativos de título,
  artistas e capa e confere suas respostas. O próprio Libib atualiza seus campos e a listagem ao fechar a edição. Esse script
  não recebe tokens Spotify nem acessa o armazenamento da extensão.

## Contribuição e estrutura

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para a organização do código, testes e orientações para
acrescentar outros catálogos ou streamings.
