# Etiqueta térmica 10x15

Imprime as etiquetas de envio do **Mercado Livre** e da **Shopee** em impressoras térmicas comuns de 10x15 cm (linguagem TSPL), direto do navegador, com o **DANFE ou a DACE resumida na mesma etiqueta**.

Você clica em *Imprimir etiquetas* no Mercado Livre, ou gera a etiqueta na Shopee, e ela sai na impressora. Sem abrir arquivo .txt, sem site conversor, sem mandar dados de cliente para fora do computador.

| Mercado Livre | Shopee |
|:---:|:---:|
| <img src="docs/exemplo-mercado-livre.png" alt="Etiqueta do Mercado Livre com a DACE resumida no rodapé" width="380"> | <img src="docs/exemplo-shopee.png" alt="Etiqueta da Shopee com a DACE resumida no rodapé" width="380"> |
| Envio em cima, destinatário no meio e a faixa fiscal com a chave em código de barras. | A etiqueta já vem pronta da Shopee, com a DACE resumida; a ponte encaixa no 10x15. |

As duas imagens acima são o que sai na impressora, em tamanho 100 x 150 mm. **Todos os dados são fictícios**: foram geradas a partir dos arquivos em [`exemplos/`](exemplos/), que imitam o formato de cada marketplace. Os logotipos aparecem como saem nas etiquetas reais e são marcas dos respectivos donos; este projeto não tem vínculo com eles.

> Estado do projeto: funciona no **macOS**. Windows ainda não tem instalador (veja [Windows](#windows)). Testado em uma impressora: Oásis Market OIA-8370-B.

## O problema que resolve

As térmicas 10x15 baratas falam **TSPL**. O Mercado Livre e a Shopee entregam a etiqueta em **ZPL**, a linguagem da Zebra. O resultado conhecido: baixar um .txt, abrir num conversor, salvar PDF, imprimir, e ainda gastar uma segunda etiqueta com o documento fiscal.

Este projeto fica no meio do caminho e faz a tradução no próprio computador.

## Como funciona

```
Mercado Livre (botão Imprimir etiquetas)          Shopee (gera o .zip Térmica ZPL)
        |  ZPL por http://127.0.0.1:9100                  |  arquivo cai em Downloads
        v                                                 v
   +---------------------------- ponte local (Node) ----------------------------+
   | 1. recebe o ZPL                                                             |
   | 2. desenha a etiqueta aqui mesmo (zebrash), sem serviço externo             |
   | 3. monta o 10x15: envio em cima, destinatário no meio, faixa fiscal embaixo |
   | 4. gera o comando TSPL (imagem de 800 x 1198 pontos)                        |
   +-----------------------------------------------------------------------------+
        |  cabo USB (fila do macOS)      |  Bluetooth 4.0 (conector próprio)     |  rede (porta 9100)
        v                                v                                       v
                                  impressora térmica
```

- **Mercado Livre.** O site procura o programa *Zebra Browser Print* em `http://127.0.0.1:9100`. A ponte responde nesse endereço com as mesmas rotas (`/default`, `/available`, `/write`, `/read`), então o site acredita que há uma Zebra e manda o ZPL.
- **Shopee.** Não tem impressão direta: ela gera um .zip. A ponte vigia a pasta Downloads, lê o arquivo assim que ele chega, imprime e, com tudo impresso, apaga o arquivo (dá para desligar em Ajustes).
- **Uma fila só.** Os dois caem na mesma fila. No modo direto ela fica vazia; só aparece no painel o que ficou parado.

### O layout

- **Mercado Livre:** a etiqueta de envio original em largura cheia, o destinatário logo abaixo e, no rodapé, uma faixa com número, série, emissão e a chave de acesso em código de barras. É o mesmo desenho da impressão conjunta do próprio Mercado Livre.
- **Shopee:** a etiqueta já vem como imagem pronta, com a DACE resumida no rodapé. A ponte só encaixa no 10x15.
- Margens de segurança de 3 mm nas laterais e 2 mm em cima e embaixo.
- Códigos de barras nunca são redimensionados.
- Se nome, endereço ou complemento forem longos, a letra do destinatário diminui até 2,5 mm. Se nem assim couber, envio e documento fiscal saem em etiquetas separadas, em vez de cortar texto.

## Instalação no macOS

**Jeito simples:** baixe o `EtiquetaTermica-<versão>.dmg` na página de [Releases](https://github.com/stephensonsn/etiqueta-termica-10x15/releases), abra e dê dois cliques em *Instalar.command*. Não tem pré-requisito: ele já traz o Node.js e o conector Bluetooth, e começa com uma checagem do computador que mostra o que está pronto, o que falta e como resolver. Como o instalador não é assinado pela Apple, na primeira vez é preciso clicar com o botão direito e escolher *Abrir*.

**Pelo código-fonte:**

Você precisa de:

- macOS com [Node.js](https://nodejs.org) 18 ou mais novo.
- Para Bluetooth sem navegador: as Ferramentas de Linha de Comando da Apple (`xcode-select --install`).
- A impressora ligada por cabo USB ou com o Bluetooth ativo.

Passo a passo:

1. Baixe o projeto e entre na pasta:
   ```bash
   git clone https://github.com/stephensonsn/etiqueta-termica-10x15.git
   cd etiqueta-termica-10x15
   ```
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Instale os serviços (sobem sozinhos a cada login e voltam se caírem):
   ```bash
   ./instalar.sh
   ```
4. Na primeira vez o instalador abre o painel (<http://127.0.0.1:9100/painel>) com o **assistente de configuração**, em 5 etapas que só avançam quando a anterior está pronta de verdade: conexão (cabo, Bluetooth ou rede); liberações do macOS (Bluetooth e pasta Downloads, com botão que abre a tela certa dos Ajustes); impressora conectada; etiqueta de teste confirmada; e o Mercado Livre encontrando a impressora. Na etapa da impressora também dá para instalar o driver de sistema: o próprio macOS pede a senha de administrador.
5. **Cabo USB:** ligue a impressora e clique em *Usar esta impressora*. Se o driver do fabricante já estiver instalado, o assistente reconhece e usa a fila dele. Se não estiver, a ponte cria a própria fila e funciona sem driver. O driver do fabricante só é necessário para imprimir de outros programas; ele não vem neste projeto e deve ser baixado no site do fabricante: [driver para Mac](https://www.cnfujun.com/d/73) (LabelPrinter 2.3.3).
6. **Só para Bluetooth:** abra o painel no Google Chrome, clique em *Escolher impressora* na linha Bluetooth e selecione a sua. É uma vez só; daí em diante o computador liga nela sozinho.

### Ligar no Mercado Livre

1. Em [Preferências de venda](https://www.mercadolivre.com.br/preferencias-de-venda), seção de impressão de etiquetas, escolha **Impressora térmica** e formato **ZPL**.
2. Ligue **Imprimir pelo navegador**.
3. Na tela de Vendas, selecione as vendas e clique em **Imprimir etiquetas**. A impressora aparece como "Termica 10x15 (ponte local)".

### Ligar na Shopee

1. Na Central do Vendedor, em *Envio em massa → Gerar documentos*, escolha **Etiqueta de envio → Térmica ZPL**.
2. Clique em **Gerar documentos selecionados**. O .zip é baixado e a ponte imprime sozinha.

## TikTok Shop

No TikTok Shop (Seller Center Brasil) cada venda sai em **uma etiqueta só**, no mesmo padrão do Mercado Livre: a etiqueta da iMile em cima e, no rodapé, a faixa *DANFE SIMPLIFICADO – ETIQUETA* (1 – Saída, NF, série, código de barras e chave em grupos de 4).

- **Configuração no TikTok:** Logística → Envio → Opções de formato de documento: etiqueta A6, *Imprimir em 1 página*, formato **ZPL**. Na impressão, marque *Etiqueta de envio* e *NF-e*.
- **Como junta:** a etiqueta da iMile já traz a chave da NF-e em código de barras; a ponte lê a chave da imagem (leitor Code 128 próprio, `src/code128.js`) e monta a faixa. O arquivo `<data>_NF-e.txt` do mesmo lote não imprime separado (se a etiqueta não chegar em 10 minutos, ele imprime sozinho).
- **Impressão direta (sem clicar em baixar):** o TikTok não fala com impressora local; ele gera os arquivos e espera o clique em *Baixar todos os arquivos*. A extensão em `extensao-chrome/` faz esse clique sozinha quando a janela *Imprimir resultado* aparece, e a ponte imprime. Para instalar no Chrome: abra `chrome://extensions`, ligue o *Modo do desenvolvedor*, clique em *Carregar sem compactação* e escolha a pasta `extensao-chrome`. Na primeira vez o Chrome pode perguntar se o site pode baixar vários arquivos: responda *Permitir*.
- **Impressão automática (opcional):** com a extensão, aparece no canto da página o quadro *Impressão automática*. Ligue numa aba do Seller Center aberta só para isso (vale só para aquela aba). A cada 5 minutos ela abre *Pedidos → Para enviar*, emite a NF-e dos pedidos *Sem NF-e* pelo emissor do TikTok e, nos que já têm NF-e, clica em *Criar e imprimir etiqueta*: a etiqueta sai na térmica sem nenhum clique. No máximo 10 pedidos por rodada; se um botão esperado não aparecer (por exemplo, produto sem dados fiscais), ela para e mostra o motivo no quadro.
- Fora da impressão automática, a extensão só roda em `seller-br.tiktok.com`, não envia nada para fora do computador e não mexe em pedido.

## Mercado Livre: impressão automática (várias contas)

No painel, em *Mercado Livre: impressão automática*, a ponte confere a cada 5 minutos as contas autorizadas e imprime sozinha as etiquetas de **agência e coleta** que ficaram prontas (`ready_to_ship` / `ready_to_print`, tipos `drop_off`, `xd_drop_off` e `cross_docking`), baixadas em ZPL pela API (`/shipment_labels?response_type=zpl2`) e montadas com a DANFE/DACE como sempre. Cada envio sai uma vez só.

1. Crie um aplicativo grátis em developers.mercadolivre.com.br, com o endereço de retorno da sua loja e as permissões de pedidos e envios. Copie o ID e a chave secreta para o painel (ficam só no `config.json` deste computador).
2. Para cada conta: entre no Mercado Livre com ela, clique em *Autorizar uma conta* e cole o endereço com `?code=` que aparecer.
3. Marque *Imprimir sozinho as etiquetas prontas*.

Venda com nota pendente (`invoice_pending`) e erro de conta viram pendência.


**NF-e automática:** com "Emitir a NF-e pelo Faturador do Mercado Livre" marcado, a venda que espera nota tem a NF-e pedida ao Faturador (o mesmo emissor do painel do Mercado Livre, com a série e o certificado já configurados lá). Na rodada seguinte a etiqueta fica pronta e imprime. Se faltar dado (cadastro fiscal do anúncio, CPF do comprador etc.), o envio fica parado no painel e no ícone vermelho até você corrigir e clicar "Corrigi, tentar de novo". O TikTok segue a mesma regra no quadrinho da aba do Seller Center.

**Cabo ou Bluetooth:** a ponte troca sozinha. Com a impressora no cabo USB vai pelo cabo (mais rápido); sem cabo, pelo Bluetooth.

## Ícone de pendências (extensão)

A extensão mostra no ícone, em vermelho, quantas pendências existem; clicando, abre a lista. Conta como pendência: impressora ou ponte com problema, etiqueta com erro na fila, pedido parado (sem NF-e, nota pendente no Mercado Livre) e automação que parou (TikTok ou Mercado Livre). A extensão consulta `http://127.0.0.1:9100/api/pendencias` a cada minuto.

## O painel

Em <http://127.0.0.1:9100/painel>, acessível só do próprio computador.

| Onde | Para quê |
|---|---|
| **Imprimir direto / Conferir antes** | Direto: o que chega já imprime. Conferir: fica na fila até você clicar. |
| **Fila de impressão** | O que está esperando ou parado, com o motivo. Marque várias e imprima em sequência. |
| **Enviadas** | As últimas 40, para reimprimir depois de um papel travado. Ficam só na memória. Inclui o que foi impresso de outros programas pelo driver de sistema. |
| **Prévia** | A imagem exata que vai para a impressora. |
| **Impressora** | Cabo USB, Bluetooth ou rede. |
| **Ajustes de impressão** | Deslocamento, escuro, velocidade, formato junto ou separado, régua de teste. |
| **Registro técnico** | Últimos eventos, autoteste, recalibrar o sensor de papel, reiniciar a impressora. |

## Etiquetas de produto (código de barras)

Em <http://127.0.0.1:9100/estoque> você escolhe quantas etiquetas de cada produto quer e imprime em rolos de várias colunas (padrão: 3 colunas de 35 x 25 mm, medidas conferidas por foto no OIA-8370-B), direto na mesma impressora.

- **EAN-13:** cada etiqueta leva o nome do produto, a cor, as barras EAN-13 (módulo de 0,25 mm), os 13 números embaixo e o SKU, centralizados na própria coluna. Nome longo vai em letra menor, cortado no fim de uma palavra.
- **EAN-13 interno:** "Gerar EAN-13 que faltam" cria códigos `200` + sequência + dígito verificador para quem ainda não tem e grava no site. Servem para bipar na sua loja; Mercado Livre e Shopee exigem EAN registrado na GS1 Brasil. Rodar de novo não repete número nem troca código existente.
- **Quantidade:** botões − e + por produto, "Quantidade = estoque" (precisa da chave da loja) e "Zerar". Só imprime quem tem EAN-13 válido.
- **Prévia:** a primeira linha aparece com as mesmas medidas e posições do papel. "Imprimir 1 linha de teste" gasta só uma linha.
- **Medidas do rolo:** largura, altura, espaço entre colunas e margem esquerda ficam em "Medidas do rolo e impressão". Para medir um rolo novo: `node ferramentas/teste-sku-linha.js --largura 35 --altura 25 --espaco 2.2 --margem 1` imprime uma linha com moldura e régua em mm em cada etiqueta.
- Ao trocar de rolo (de 100 x 150 para 35 x 25, por exemplo), a ponte recalibra o sensor de papel sozinha antes de imprimir.

## Loja virtual (WooCommerce): estoque e leitor de código de barras

A tela de estoque (<http://127.0.0.1:9100/estoque>) liga na loja WordPress + WooCommerce:

- **Produtos do site:** traz os produtos e as variações (cores), com SKU, código de barras e estoque.
- **Leitor de código de barras:** o leitor USB ou Bluetooth funciona como teclado. Escolha **Entrada** (chegou mercadoria), **Saída** (vendeu ou separou) ou **Consultar** e bipe. A ponte lê o estoque atual no site, soma ou tira e grava de volta; vendas feitas no site no meio do caminho não se perdem.
- **Código de barras no site:** o EAN-13 vai para o campo "GTIN, UPC, EAN ou ISBN" do produto no WooCommerce. Sem a chave, fica neste computador e sobe para o site na próxima sincronização com chave.
- **Etiquetas:** os produtos do site aparecem direto na lista de etiquetas.
- **Site fora do ar:** o movimento fica guardado e é reenviado sozinho a cada minuto, uma vez só.

Para ligar: no WordPress, *WooCommerce → Configurações → Avançado → API REST → Adicionar chave*, permissão **Leitura/Gravação**. Cole a chave e o segredo na tela de estoque. Eles ficam só no `config.json` deste computador, que não vai para o git. Sem a chave, a tela só lê o catálogo público (sem quantidade em estoque).

## Anúncios do Mercado Livre ligados ao estoque da loja

Na tela de estoque, o cartão **Mercado Livre** liga cada anúncio a um produto da loja virtual.

1. Crie uma aplicação em developers.mercadolivre.com.br com a conta que vende. URI de redirect: o endereço do seu site (ex.: `https://sualoja.com.br/`); permissões de leitura e escrita e `offline access`.
2. Cole o ID do aplicativo e a chave secreta, clique em **Autorizar a conta**, aceite e cole de volta o endereço que o navegador abriu (tem `?code=`).
3. **Atualizar anúncios** traz os anúncios ativos. A ponte sugere o produto da loja pelo nome e o número de unidades por venda (kit com 3, atacado 12...). Confira e clique em Salvar em cada linha.
4. Duas chaves, desligadas de início:
   - **Venda no Mercado Livre baixa o estoque do site**: a cada 2 minutos lê os pedidos pagos (só os que chegarem depois de ligar) e tira `quantidade × unidades por venda` do produto ligado. Cada pedido é contado uma vez.
   - **Estoque do site vira a quantidade dos anúncios**: sempre que o estoque muda (bipe, venda, sincronização), o anúncio recebe `estoque ÷ unidades por venda`, arredondado para baixo.

O token fica só no `config.json` deste computador e é renovado sozinho; **Desconectar** apaga o token e desliga as duas chaves.

## Calibração

`node ferramentas/grade-calibracao.js` imprime uma grade com régua em milímetros nas quatro bordas e linhas a cada 10 mm. Pela foto dela dá para medir quanto está sendo cortado de cada lado e se a impressão sai torta. O script espera a impressora conectar (até 15 minutos) antes de enviar.

## Conexões

| Conexão | Como funciona | Observações |
|---|---|---|
| **Cabo USB** | Fila do macOS em modo bruto (`lp -o raw`). | A ponte confere se a impressora está mesmo no cabo e só dá a etiqueta como enviada quando o trabalho sai da fila. |
| **Bluetooth** | Conector próprio em Swift (`conector-bluetooth/`), por Bluetooth 4.0. | Liga sozinho, reconecta se cair, cerca de 2 s por etiqueta. Não usa o pareamento do macOS. |
| **Bluetooth pelo Chrome** | O painel aberto no Chrome fala com a impressora (Web Bluetooth). | Serve para escolher a impressora na primeira vez e como alternativa onde não há o conector. |
| **Rede** | Envio direto para `IP:9100`. | Para impressoras com Wi-Fi ou cabo de rede. Testado só com um receptor simulado. |

A etiqueta vai sempre pela conexão que você escolheu no painel; a ponte não troca de conexão sozinha. Se a impressora não estiver disponível por ela, a etiqueta fica na fila e é reenviada sozinha quando voltar (até 30 minutos).

## Problemas conhecidos e como foram resolvidos

Estas são as armadilhas reais que apareceram. Se a sua impressora se comportar assim, a causa provavelmente é a mesma.

**A etiqueta sai cortada em 5 cm e deslocada para a direita.**
A impressora perde o começo de cada trabalho pelo USB (o primeiro pacote), justamente onde vai `SIZE 100 mm,150 mm`. Sem esse comando ela usa o tamanho padrão de 80x50 mm. A ponte manda 2 KB de linhas vazias antes do cabeçalho, para que o que se perca seja enchimento.

**"Enviado", mas nada imprime.**
Por Bluetooth a impressora testada só recebe: não avisa tampa aberta, papel travado nem fim de rolo. Confira o papel e a tampa, aperte o botão de avanço e reimprima pela aba *Enviadas*. Depois de um travamento, use *Reiniciar a impressora e limpar a memória dela*.

**O macOS não conclui o pareamento Bluetooth.**
O pareamento clássico trava antes de pedir o código. Por isso o projeto usa Bluetooth 4.0 direto, que não depende dele.

**Vários trabalhos saem de uma vez ao ligar o cabo.**
A fila do macOS aceita trabalhos com a impressora desligada. A ponte cancela o trabalho que não sai em tempo.

**O número encosta na borda da caixa preta.**
A letra do renderizador é mais larga que a da Zebra. A ponte mede o texto e centraliza com folga.

## Driver de sistema (imprimir de qualquer programa)

O projeto tem duas partes independentes:

1. **A ponte**, que imprime as etiquetas do Mercado Livre e da Shopee. Não precisa de driver nenhum.
2. **O driver de sistema** (opcional), em `driver-mac/`. Com ele a impressora aparece no *Imprimir* de qualquer programa do Mac (Pré-Visualização, Word, navegador) como "Etiqueta Termica 10x15".

O driver foi escrito do zero para este projeto: um filtro (`rastertotspl.c`) que transforma a página desenhada pelo macOS em comandos TSPL, e um modelo de impressora (`.ppd`) com o papel de 100 x 150 mm, o escuro e a velocidade. O trabalho é entregue à ponte por uma porta local, e a ponte manda pela conexão escolhida no painel. Por isso **qualquer programa imprime também por Bluetooth**, o que o driver do fabricante para Mac não faz.

Para instalar (pede a senha de administrador, porque grava em `/Library/Printers`):

```bash
sudo ./driver-mac/instalar-driver.sh
```

Para remover:

```bash
sudo ./driver-mac/instalar-driver.sh remover
```

Observações:

- A ponte precisa estar instalada e no ar; o driver só funciona junto com ela.
- **Um tamanho só:** a impressora aparece com um único papel, "Etiqueta 100 x 150 mm", que é o que ela tem. Para imprimir um documento maior (A4, Carta), marque *Ajustar* ou *Ajustar ao papel* na janela de impressão do programa.
- **Página em branco não gasta etiqueta:** se o programa mandar em tamanho real um documento A4 para o papel de 100 x 150 mm, só chega um canto vazio da página. O driver recusa o trabalho e avisa na fila de impressão, em vez de soltar uma etiqueta em branco. Se o programa insistir em mandar uma página maior que a etiqueta, o driver corta as margens em branco e reduz o conteúdo para caber.
- A Apple marca esse tipo de driver (filtro e modelo do CUPS) como em fim de vida. Funciona hoje, mas pode deixar de funcionar numa versão futura do macOS.
- Ao imprimir de outros programas o macOS redimensiona a página em frações de ponto; para etiquetas de marketplace use sempre a ponte, que mantém os códigos de barras exatos.

### E o driver do fabricante?

Continua valendo se você preferir. Ele não vem neste projeto:

- O driver oficial da OIA-8370-B é distribuído pela Fujun (cnfujun.com), que fabrica o modelo vendido pela Oásis Market. Downloads:
  - macOS: <https://www.cnfujun.com/d/73> (arquivo `Driver software for Mac-73.zip`, com o `LabelPrinter2.3.3.dmg` dentro)
  - Windows: <https://www.cnfujun.com/d/72> (`Label Printer Driver software for Windows-72.exe`)
- O assistente de configuração e o instalador verificam se ele está instalado e avisam. Se estiver, usam a fila dele; se não estiver, seguem sem ele e mostram o link.

## Impressoras compatíveis

Deve funcionar com térmicas de 10x15 cm, 203 dpi, que falem **TSPL**.

| Impressora | Cabo USB | Bluetooth | Situação |
|---|---|---|---|
| Oásis Market OIA-8370-B | sim | sim | testada |

Outros modelos TSPL (Xprinter, HPRT, Munbyn, iDPRT e parecidos) devem funcionar, mas ninguém testou ainda. Se você testar, abra uma *issue* contando o modelo e o resultado.

Não serve para: impressoras que só falam ESC/POS (cupom), etiquetas menores que 10x15 e impressoras de 300 dpi.

## Windows

Ainda não há instalador para Windows, e nada foi testado nele. O que falta:

- Envio em modo bruto para a impressora USB (no macOS isso é feito pela fila do sistema).
- Instalação como serviço.
- Empacotamento em um instalador.

O que já deve servir sem mudança: a montagem da etiqueta, o painel e o **Bluetooth pelo Chrome**. Quem quiser ajudar a testar é bem-vindo.

## Privacidade

- A conversão é feita no computador. Nenhuma etiqueta vai para serviço externo.
- A ponte escuta só em `127.0.0.1`. O painel recusa pedidos vindos de outros sites, e as rotas de impressão só aceitam o Mercado Livre.
- Por padrão nada fica gravado: nem o ZPL, nem a prévia, nem o registro. *Guardar histórico* é uma opção em Ajustes.

## Desenvolvimento

```bash
npm test                     # monta a etiqueta de exemplo e confere margens, barras e o comando
node src/imprimir.js arquivo.txt --previa   # gera a prévia em previa/ sem imprimir
```

| Arquivo | O que faz |
|---|---|
| `src/servidor.js` | Rotas que imitam o Zebra Browser Print e a API do painel. |
| `src/etiqueta.js` | Lê o ZPL, monta o 10x15 e gera o TSPL. |
| `src/impressora.js` | Fila, conexões, vigia da pasta Downloads, reenvio. |
| `src/painel.html` | O painel. |
| `conector-bluetooth/main.swift` | Conector Bluetooth do macOS. |
| `exemplos/` | Etiquetas de exemplo com dados fictícios, nos formatos do Mercado Livre e da Shopee. |
| `empacotar-mac.sh` | Monta o instalador `.dmg` do macOS. |
| `driver-mac/` | Driver de sistema: filtro TSPL, modelo de impressora e instalador. |

## Créditos

- [zebrash](https://github.com/ingridhq/zebrash) e [zpl-renderer-js](https://www.npmjs.com/package/zpl-renderer-js): desenham o ZPL sem serviço externo.
- [thermal-label/labelife](https://github.com/thermal-label/labelife): referência de como essa família de impressoras conversa por Bluetooth.
- [tspl-cups-driver](https://github.com/RunTheWall/tspl-cups-driver) e [raster-tspl-rs](https://github.com/cbiffle/raster-tspl-rs): notas sobre as manias do TSPL.

Este projeto não tem vínculo com Mercado Livre, Shopee, Zebra ou Oásis Market. Não inclui drivers nem programas de fabricantes.

## Licença

MIT. Veja [LICENSE](LICENSE).
