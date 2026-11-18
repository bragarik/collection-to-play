# Collection to Play

Abra os álbuns da sua coleção no streaming escolhido, a partir do próprio catálogo.
Extensão de código aberto para Chrome, desenvolvida em TypeScript e Manifest V3.

Repositório: https://github.com/bragarik/collection-to-play
Licença: GNU GPL versão 3; texto completo em [LICENSE](LICENSE) e autoria em [NOTICE.txt](NOTICE.txt).

## Estado atual

Versão local: **0.4.1**.

Integrações implementadas: Libib + Spotify, YouTube Music, iTunes e Deezer.
Catálogo suportado: https://www.libib.com/library e seus subcaminhos.

Amazon Music permanece indisponível na configuração. Outros catálogos ainda não estão implementados.

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
4. Abra o ícone da extensão, selecione Spotify, YouTube Music, iTunes ou Deezer e salve a preferência.
5. Para Spotify, clique em "Conectar Spotify" e conclua a autorização na janela oficial.
   YouTube Music, iTunes e Deezer dispensam login para esta busca.
6. Abra ou atualize https://www.libib.com/library.

O pacote é instalado localmente a partir deste repositório. Os arquivos de dist
não são versionados: é necessário compilar antes de carregar a extensão.

## Uso

Nos itens de música da listagem e dos detalhes do Libib, clique em "Ouvir no Spotify"
e escolha Web Player ou Aplicativo Spotify. A busca usa os dados disponíveis do
item: primeiro UPC/EAN, depois título e artista, ou apenas título quando não houver
artista. Códigos de edições físicas podem não corresponder à edição do streaming.

Spotify, YouTube Music, iTunes e Deezer compartilham a limpeza dos títulos extraídos do Libib:
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

Escolha Spotify, YouTube Music, iTunes ou Deezer nos botões com ícone e nome, busque
e adicione um álbum. O serviço selecionado fica destacado; os serviços que já têm
um card mostram ✓ e **Adicionado**, mantendo a marca ao trocar o serviço da busca.
Remover o card também remove essa marca. Os serviços adicionados continuam clicáveis. Você pode
manter até quatro álbuns nos cards, um de cada serviço. A contagem mostra o total
escolhido, por exemplo 1/4. Se precisar trocar uma edição, remova
o card daquele serviço e adicione outro. Os dados já copiados ficam no formulário.

Os campos **Álbum** e **Artista (opcional)** mantêm os termos digitados ao trocar
streaming. O botão ↺ ao lado de cada campo restaura somente aquele campo ao valor
que tinha quando o editor foi aberto.

Os cards mostram as dimensões reais das capas carregadas. O selo **Maior resolução**
identifica a maior área em pixels entre os álbuns escolhidos; empates são indicados.
Enquanto outra capa carrega, o selo informa **Maior resolução até agora**.
Um card com título, artistas ou capa indisponíveis recebe destaque vermelho e **!**;
passe o mouse sobre o indicador para consultar o motivo. Carregamento em andamento
não é tratado como dado ausente. Esses indicadores não copiam nem aplicam campos.

A descrição também pode incluir tipo do lançamento, duração total, duração de cada
faixa, UPC/EAN e direitos autorais, conforme os dados retornados pelo serviço.
Deezer fornece duração total diretamente; Spotify e iTunes só têm o total calculado
quando todas as faixas e suas durações estão disponíveis. No iTunes, não se deduz
tipo ou gravadora a partir de outros campos. Esses dados extras não alteram o
indicador de seis grupos. Conteúdo explícito e quantidade de discos não são incluídos.

O selo **Descrição mais completa** compara seis grupos: álbum, artistas, lançamento,
gravadora, gêneros e lista completa de faixas. Empates destacam todos os líderes.
Havendo descrições geradas ou automáticas disponíveis, pelo menos uma recebe o selo,
inclusive quando todas estão incompletas. Cards sem descrição disponível não concorrem.
A contagem mostra quantos dos seis grupos estão disponíveis;
o destaque indica a melhor opção disponível, sem afirmar que contenha todos os dados.
Enquanto outros cards ainda aguardam geração, consulta ou nova tentativa, o selo
das descrições disponíveis mostra **até agora**. Enquanto não houver descrição
gerada ou automática disponível, nenhum card recebe esse selo.

Depois de obter a descrição, **6/6** mantém o estado normal, **1 a 5/6** usa
um **i amarelo** com os dados ausentes no tooltip e **0/6** usa **! vermelho**.
Falhas de consulta também são informadas. Ausência de capa, álbum ou artista
continua usando o alerta vermelho. Campos ainda não
consultados ou carregando não são classificados como ausentes. O texto desses avisos
não entra na descrição copiada ou salva.

Selecione um card para consultar título, artistas e capa. Use **+** para substituir
um campo no formulário principal ou **+ todos** para copiar os dados disponíveis.
Você pode combinar fontes, por exemplo título do Spotify, artistas do YouTube Music
e capa do iTunes.
O formulário mostra a origem de cada campo; os textos continuam editáveis e os
artistas são apresentados um por linha. Desmarque um campo para mantê-lo no Libib.
Adicionar, consultar ou copiar um card não grava alterações.
O botão ↺ ao lado de Título, Artistas, Capa e Descrição restaura o valor que o
campo tinha ao abrir o editor e desmarca sua aplicação. Na capa, descarta a escolha
do streaming para manter a capa atual do Libib. Os cards e demais campos são preservados.
Restaurar a descrição também revoga a confirmação anterior.

A capa mostra largura, altura, formato e peso. A extensão usa a maior variante
válida obtida, até 20 MB. Imagens abaixo de 300 × 300 pixels podem ser usadas com
aviso. A prévia copiada permanece disponível mesmo depois de remover seu card.

Na **edição completa**, **Preencher campos** prepara apenas os campos marcados,
inclusive somente a capa, e fecha o painel da extensão. Você conclui a gravação
pelo **Salvar do Libib**. Campos desmarcados, preço, tags, grupo, notas,
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
A seleção do serviço no editor não muda o streaming preferido para ouvir. Essas buscas não
abrem player nem alteram as escolhas lembradas.

### Descrição do disco

Adicione um álbum. Quando os dados usados na descrição já estiverem na busca, a
prévia aparece automaticamente no card, sem consulta adicional — atualmente é o caso
do YouTube Music. Nos serviços que precisam de detalhes adicionais, use **Dados do
serviço → Descrição → Gerar descrição**.

A prévia usa os dados disponíveis daquela fonte. Use **+** para copiar a descrição
para o formulário e ajuste o texto como preferir. **+ todos** também inclui a descrição
quando ela já tiver sido gerada.

Para reunir dados de várias fontes, use **Combinar descrições**, ao lado de
**Descrição** em “Dados para o Libib”. A extensão prepara as descrições pendentes
antes de abrir o modal e reutiliza as já geradas. Se um serviço falhar, você pode
continuar com as outras fontes; se todos falharem, tente novamente.

No modal, use o botão de cada dado ou **Usar todos os dados** de uma fonte.
Escolher outro serviço para o mesmo dado substitui a escolha anterior. A lista de
faixas é selecionada inteira, sem misturar automaticamente edições. Você pode
editar livremente o texto final; as edições manuais são preservadas ao escolher
novos dados. O campo **Descrição combinada** é a própria prévia completa e editável,
incluindo Fonte/Fontes quando ativada; não há outra prévia separada. A inclusão de fontes vem marcada e pode ser desmarcada. Se os dados escolhidos vierem de um
único álbum, o rodapé usa **Fonte: serviço** e o link do álbum, como na descrição
individual. Com mais de um álbum, usa **Fontes**, com os nomes dos atributos
aproveitados por serviço (por exemplo, `Spotify - Álbum, Artistas, Faixas`) e o link
do álbum na linha seguinte. Os valores e as faixas não são repetidos nas fontes. Dados alterados manualmente deixam de ser atribuídos
ao serviço.

**Usar descrição** fecha o modal e preenche apenas Descrição no formulário
principal; não grava no Libib. Cancelar ou pressionar Esc mantém o rascunho anterior.
O limite de 5.000 caracteres inclui a seção opcional de fontes e respeita limites
menores declarados pelo campo nativo. Esse valor segue o limite documentado pelo
Libib para [descrição no CSV](https://support.libib.com/libib/website/add-items.html#csv-import);
a documentação não confirma um limite independente para os editores. A extensão
usa esse teto comum na geração, edição, combinação e aplicação. Descrições atuais
maiores permanecem disponíveis para consulta e precisam ser reduzidas antes de substituir.
Usar uma combinação
sempre exige nova confirmação de substituição, mesmo que o texto seja igual ao anterior.

A descrição atual começa desmarcada e pode ser consultada em **Ver descrição atual do
Libib**. Para substituir, marque **Aplicar descrição** e **Confirmo substituir a descrição
atual pelo texto acima**. Alterar o texto ou sua inclusão exige nova confirmação.
O campo deve estar disponível no editor nativo; se não for compatível, os demais
campos continuam funcionando e a descrição permanece preservada.

Na edição completa, **Preencher campos** prepara a descrição; a gravação continua
no **Salvar do Libib**. Na rápida, **Aplicar dados** grava somente os campos marcados.
Se a descrição original mudar durante a edição, a substituição é bloqueada e o
editor pede reabertura para conferência. Quebras de linha equivalentes do navegador
são normalizadas; outras mudanças no texto são verificadas.

Os dados disponíveis variam por serviço:

| Serviço | Dados usados quando fornecidos |
| --- | --- |
| Deezer | Álbum, artista, tipo, lançamento, gravadora, gêneros, quantidade/lista de faixas, duração total e por faixa e UPC |
| iTunes | Álbum, artista, lançamento, gênero, quantidade/lista de faixas, duração por faixa, total calculado com lista completa e direitos autorais |
| Spotify | Álbum, artistas, tipo, lançamento, quantidade/lista de faixas, duração por faixa, total calculado com lista completa, UPC/EAN e direitos autorais; gravadora e gêneros somente quando retornados |
| YouTube Music | Somente os dados já disponíveis na busca: álbum, artistas e data, quando houver |

No Spotify, o campo de gêneros do álbum é documentado como sempre vazio e o campo
de gravadora está descontinuado; esses dados não são garantidos.

Não são geradas resenhas ou biografias. Dados ausentes são omitidos, listas de faixas
parciais são identificadas e a fonte acompanha cada descrição individual. Na
descrição combinada, a seção de fontes é opcional. A descrição aceita até
5.000 caracteres. Consultas adicionais são feitas sob demanda, sem alterar a preferência para ouvir.
Os avisos sobre dados indisponíveis são informativos e não entram no texto copiado.

## Deezer

Escolha **Deezer** nas configurações e salve a preferência. **Ouvir no Deezer**
busca pelo título e artista e abre o link de álbum retornado pela API no navegador.
A busca pública em `https://api.deezer.com/search/album` dispensa login e não usa
UPC/EAN. A reprodução segue as condições de acesso do próprio Deezer.

Resultados ambíguos ou parciais ficam no painel de seleção, com paginação e
lembranças de artista/álbum por item e serviço. As miniaturas usam as imagens
retornadas em cdn-images.dzcdn.net. O Deezer também está disponível no editor para compor título, artistas, capa e descrição,
com até quatro cards, um por serviço. As capas retornadas são baixadas sem cookies
e têm formato, dimensões e peso validados antes da aplicação.

O log exportado registra consulta, posição da página, tempo, HTTP, candidatos e
erros da API, inclusive respostas HTTP 200 com erro JSON. Mensagens brutas da API
não são exportadas. Limites de consulta e indisponibilidade aparecem como falha,
separados de uma busca válida sem resultados. A quota numérica não foi verificada.

## iTunes

Escolha **iTunes** como preferência nas configurações. No Libib, **Ouvir no iTunes**
busca por título e artista e abre o álbum no navegador, sem menu de aplicativo.
Quando houver várias edições, escolha a desejada e, se quiser, marque **Lembrar decisão**.
O artista é lembrado por item; o álbum só é lembrado quando marcado, como nos demais serviços.

A integração usa a [iTunes Search API pública da Apple](https://performance-partners.apple.com/search-api),
sem chave, conta de desenvolvedor ou login, consultando inicialmente o Brasil.
O endereço retornado pode ser do Apple Music; não é convertido nem inventado.
O catálogo da loja pode diferir da disponibilidade para ouvir por assinatura.

UPC/EAN não são usados nesta integração. A consulta retorna até 200 resultados;
se atingir esse teto, o painel pede escolha ou refinamento de título/artista,
sem abertura automática e sem botão de continuação. Ausência de resultados oferece
um link de busca manual no Apple Music Brasil. Erros de rede ou do serviço são
mostrados separadamente de álbum não encontrado.

A busca começa por título e artista. Se o título esperado não aparecer, a extensão
identifica o artista pelos resultados ou por uma busca de artistas e consulta seus
álbuns pelo ID retornado pela Apple. Os resultados são combinados sem duplicar álbuns.
O complemento funciona tanto para ouvir quanto para compor dados no editor.

Sem artista informado, a busca permanece por título. Homônimos mantêm a escolha
manual; nomes ambíguos ou listas parciais pedem conferência ou refinamento. Se uma
consulta complementar falhar, os candidatos válidos já obtidos ficam disponíveis
com aviso. Falhas sem resultados aproveitáveis continuam sendo erros do serviço.
Não é necessário informar link, ID ou código de barras.

Cada busca usa no máximo cinco chamadas e até três artistas identificados. Identidades
e catálogos de artista validados ficam em cache por dez minutos, limitado a 64 entradas
na memória do worker; o prazo total da operação continua em 20 segundos. O cache não
é persistente e não garante que o catálogo da Apple esteja completo.

O iTunes também está disponível no editor de composição de título, artistas, capa e descrição.
A busca do editor independe da preferência para ouvir e das escolhas lembradas.
As capas usam somente os arquivos retornados pela Apple: se a maior disponível
for pequena, o editor permite usá-la com o aviso de baixa resolução.

## Conectar ao Spotify

Cada pessoa configura seu próprio aplicativo Spotify, mantido em **Development Mode**
no [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).

1. Crie seu aplicativo no dashboard. O proprietário precisa de Spotify Premium.
2. No ícone da extensão, abra **Credencial Spotify** e copie o **Redirect URI**.
3. Cadastre esse endereço exatamente em **Settings → Redirect URIs** no dashboard.
4. Confira a lista de usuários autorizados em **Users Management**.
5. Copie o **Client ID** do aplicativo, cole no campo da extensão e clique em **Salvar Client ID**.
6. Escolha Spotify como streaming e clique em **Conectar Spotify**.

A configuração fica localmente neste navegador. O modo de desenvolvimento é uma
configuração do dashboard, não algo que a extensão altera. A conexão usa PKCE,
sem Client Secret e sem servidor próprio. O Redirect URI e o ID da extensão são
informativos e continuam somente para leitura.

A versão atual não inclui Client ID padrão. Se você já usava a versão com ID fixo,
salve o Client ID do seu cadastro e conecte novamente. Ao trocar de Client ID, a
sessão anterior é encerrada; salvar o mesmo ID preserva a conexão. **Remover Client ID**
apaga a credencial local e encerra a sessão Spotify deste navegador. Preferência de
streaming e escolhas salvas são mantidas. Uso sujeito aos
[limites do Spotify](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

## Apoiar o projeto

Gostou da extensão? Você pode contribuir voluntariamente para apoiar seu desenvolvimento.

No rodapé das configurações, **Apoiar o projeto** abre os quatro meios abaixo,
com QR Code e botão para copiar. Escolha o valor no aplicativo do banco, na carteira
ou no PayPal. Os QR Codes são gerados localmente.

<details>
<summary>Pix</summary>

<img src="src/assets/support-pix.svg" width="220" height="220" alt="QR Code de recebimento — Pix">

Copie o código ou leia o QR Code no aplicativo do seu banco.

```text
00020126870014BR.GOV.BCB.PIX0136e55c5a8e-2dd8-4ad0-a601-30a5dfc380380225Doacao Collection to play5204000053039865802BR5922RICARDO CASSIANO BRAGA6009SAO PAULO622605222PbJ3t2ykvYJnABO15WZTr63048618
```

</details>

<details>
<summary>Bitcoin</summary>

<img src="src/assets/support-bitcoin.svg" width="220" height="220" alt="QR Code de recebimento — Bitcoin">

Endereço de recebimento na rede principal do Bitcoin.

```text
BC1QKU5HUK3PHDWHGLFRQ583RVR8UQMMSG49GV7KRN
```

</details>

<details>
<summary>Lightning — sats</summary>

<img src="src/assets/support-lightning.svg" width="220" height="220" alt="QR Code de recebimento — Lightning — sats">

Use uma carteira compatível com Lightning Address ou LNURL.

```text
lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7tnhv4kxctttdehhwm30d3h82unvwqhkx7twd93kzmr5v9kxc7fcxgt45zg2
```

</details>

<details>
<summary>PayPal</summary>

<img src="src/assets/support-paypal.svg" width="220" height="220" alt="QR Code de recebimento — PayPal">

Conclua o apoio na página do PayPal.

[Abrir PayPal](https://www.paypal.com/donate/?business=bragarik%40gmail.com&currency_code=BRL&item_name=Collection%20to%20Play)

```text
https://www.paypal.com/donate/?business=bragarik%40gmail.com&currency_code=BRL&item_name=Collection%20to%20Play
```

</details>

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

Para iTunes, o log registra consulta e país, status HTTP, candidatos e resultado
da resolução. Também identifica as etapas de busca textual, identificação do artista,
consulta de álbuns, uso de cache e complemento completo ou parcial. A exportação lê
o registro local, sem consultar detalhes adicionais.

Nos quatro serviços de reprodução, os eventos de falha registram data, tempo decorrido, limite de
20 segundos, etapa da operação (requisição, HTTP, leitura do corpo ou interpretação),
presença de resposta HTTP e sinais de timeout/cancelamento. O log distingue falha
de transporte durante a leitura de um JSON inválido. Inclui nome do erro, mensagens
padrão conhecidas do navegador e códigos técnicos seguros quando fornecidos, sem
exportar mensagens arbitrárias, pilhas ou causas recursivas. Um erro genérico como
“Failed to fetch” não permite concluir sozinho se houve falha de DNS, bloqueio ou
problema de conexão. Após atualizar, repita a busca e exporte um novo log.

A mesma exportação inclui `artworkByService`, com as últimas cinco tentativas
de obtenção de capa de cada serviço, inclusive fontes escolhidas no editor que
não sejam o streaming preferido para ouvir. Registra álbum, URL da variante
sem parâmetros de consulta, duração, HTTP, leitura, formato, decodificação,
dimensões e resultado. Timeout indica o prazo total de 20 segundos para as
variantes da capa. Não inclui os bytes/base64 da imagem, mensagens arbitrárias
de erro ou autenticação. Para investigar uma capa, tente carregá-la novamente
no editor e depois exporte o log nas configurações.


O log não inclui senha, cookies ou cabeçalhos de autorização. Inclui títulos,
artistas, códigos e a URL de origem da biblioteca: revise esses dados antes de
compartilhá-lo. Logs exportados não fazem parte do repositório público.

O log de busca também pode incluir `descriptionByService`, com até cinco tentativas
por fonte de geração da descrição. Registra álbum, tempos, HTTP, quantidade de faixas
e resultado, sem armazenar a descrição atual do Libib ou o texto gerado. Para investigar,
gere a descrição novamente e exporte o log.

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
  YouTube Music consulta music.youtube.com sem cookies. iTunes consulta itunes.apple.com
  sem cookies. Deezer consulta api.deezer.com sem cookies; miniaturas são carregadas
  de cdn-images.dzcdn.net. As capas do iTunes usam subdomínios de mzstatic.com, também autorizados
  para obter o arquivo público sem cookies e usá-lo na composição. Capas válidas são carregadas
  de i.scdn.co, lh3.googleusercontent.com, yt3.googleusercontent.com ou i.ytimg.com.
  O acesso a esses CDNs também permite obter arquivos de capa sem cookies ou
  autenticação. Esses arquivos são temporários e não são gravados no catálogo
  automaticamente.
- Os dados necessários à pesquisa são enviados ao streaming escolhido. Não há backend próprio,
  serviço de telemetria ou upload automático dos diagnósticos neste projeto.
- O content script atua somente na biblioteca Libib suportada. A extensão solicita
  identity, storage, declarativeNetRequestWithHostAccess e acesso aos hosts Spotify,
  YouTube Music, iTunes e Deezer indicados no manifesto. A regra de rede remove o cabeçalho Origin
  somente de POSTs da própria extensão ao endpoint de busca YouTube Music; não
  altera navegação normal do usuário nem chamadas Spotify.
- Na edição rápida, uma integração local aciona os handlers nativos de título,
  artistas e capa e confere suas respostas. O próprio Libib atualiza seus campos e a listagem ao fechar a edição. Esse script
  não recebe tokens Spotify nem acessa o armazenamento da extensão.

## Contribuição e estrutura

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para a organização do código, testes e orientações para
acrescentar outros catálogos ou streamings.


## Last.fm nos serviços de composição

Em **Credencial Last.fm** nas configurações, salve sua própria API key, substitua-a
ou remova-a. Ela fica localmente neste navegador, sem Shared Secret ou login Last.fm.

Na tela **Compor dados do álbum**, a seleção **Serviços** inclui Spotify,
YouTube Music, iTunes, Deezer e Last.fm. Escolha Last.fm, informe Álbum e Artista,
selecione Português ou Inglês e use **Buscar álbuns**. O clique no serviço já inicia
a busca se ele ainda não tiver um álbum adicionado. O idioma retornado pode ser
diferente do solicitado; não há troca automática de idioma.

Adicione o resultado aos mesmos cards dos outros serviços: até um álbum por
serviço, totalizando cinco. Use os botões **+** para copiar título, artista, capa
ou descrição. A descrição Last.fm já fica disponível a partir da busca, incluindo
história quando fornecida; não precisa gerar novamente. Texto acima do limite
é mantido para revisão no formulário e precisa ser reduzido antes de aplicar.
Nada é salvo automaticamente no Libib.

**Sobre o álbum** é um atributo opcional comum: aparece no merge quando uma fonte
o fornece, antes das faixas. Hoje o Last.fm preenche esse texto; outras integrações
podem fornecer o mesmo atributo futuramente. Tags e MusicBrainz também são blocos
separados quando disponíveis; tags não são convertidas automaticamente em gêneros.
O merge permite trocar a fonte de cada bloco. Ao aproveitar Sobre o álbum do Last.fm,
a origem, o link do álbum e os Termos da API Last.fm acompanham o texto, mesmo se as
fontes opcionais forem desmarcadas ou o texto for editado. A atribuição deixa de ser
associada quando o bloco é removido ou substituído por outro serviço. Revise a descrição
final antes de aplicar.

O uso da API Last.fm nesta extensão destina-se a uso pessoal não comercial, conforme
informado pelo mantenedor. Os termos atuais exigem uso não comercial, crédito e link
para o catálogo Last.fm, proíbem sublicenciamento e limitam os dados armazenados a
100 MB no total; também exigem respeitar os cabeçalhos HTTP de cache. A extensão não
mantém cache próprio das respostas Last.fm e usa o cache HTTP padrão do navegador.
Os termos mencionam aprovação escrita para páginas com acesso público que usem a API;
confirme essa exigência com Last.fm antes de distribuir uma versão com acesso público.
Consulte os [Termos da API Last.fm](https://www.last.fm/api/tos) antes de usar a API.

Last.fm é um serviço de consulta, sem reprodução; não aparece na preferência para
ouvir e não muda o streaming escolhido nas configurações. Remover um card mantém
os dados já copiados no formulário. A credencial é pessoal e fica no armazenamento
local do navegador; diagnósticos não guardam a chave, URL da requisição ou texto
retornado pela API.


## Editar vídeos com TMDb

Em **Configurações → Credencial TMDb**, salve sua API key ou seu token de leitura.
A credencial fica no armazenamento local do navegador. O campo é esvaziado depois
de salvar e permite substituir ou remover a credencial.

No Libib, abra a edição de um item de Vídeo e escolha **Atualizar dados via TMDb**.
Busque o título, adicione uma obra e copie os campos desejados para **Dados para o
Libib**. Título, Diretores, Descrição e Capa são selecionáveis. Diretores vêm dos
créditos de direção da obra. A capa corresponde ao pôster fornecido pelo TMDb.
A descrição reúne a sinopse e os dados disponíveis de ano, duração e gêneros,
com prévia editável e confirmação da substituição. A prévia da capa mostra
dimensões, formato e tamanho do arquivo.

Na edição completa, **Preencher campos** prepara o formulário para revisão e
salvamento pelo botão do Libib. Na edição rápida, aberta pelo lápis, **Aplicar
dados** salva imediatamente os campos marcados pelo handler nativo do Libib.

Se a busca original vier vazia e o título terminar com Blu-ray, DVD ou VHS,
a extensão tenta também o título sem esse sufixo. O diagnóstico guarda as
últimas vinte ocorrências, com termo de busca, idioma, etapa, duração, HTTP e
quantidade de resultados. Pode ser exportado em **Configurações → Credencial
TMDb → Exportar diagnóstico TMDb**. O arquivo não contém a credencial.

This product uses the TMDB API but is not endorsed or certified by TMDB.
