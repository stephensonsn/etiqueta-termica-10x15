# Separação de pedidos

Aplicativo Python local para gerar o checklist A4 do Mercado Livre e do TikTok Shop. Não altera a ponte de impressão térmica.

## Abrir no Mac

1. Dê dois cliques em **Abrir Separação.command** nesta pasta. A tela abre no navegador.
2. Mantenha a janela do Terminal aberta enquanto usa o aplicativo.
3. Escolha ou arraste uma ou mais planilhas **XLSX** exportadas dos marketplaces.
4. Selecione os itens desejados. Para localizar pela etiqueta, digite/bipe o envio, rastreio ou pedido completo e clique em **Selecionar pacote**.
5. Clique em **Baixar PDF A4** e imprima em A4, escala 100%.

Se o macOS pedir confirmação ao abrir, clique com o botão direito no arquivo e escolha **Abrir**. Não é necessário instalar extensão, configurar a impressora térmica nem fornecer senha de marketplace.

O endereço padrão é http://127.0.0.1:9175. Abrir o arquivo novamente reutiliza a sessão já ativa. Para encerrar o servidor, use Control+C na primeira janela do Terminal.

## Regras do checklist

- **Só o dia.** Ao importar, ficam marcados só os pacotes com despacho hoje ou atrasado. O prazo vem da coluna "Descrição do status" do Mercado Livre ("despachar hoje", "amanhã", data), contado a partir da data do relatório. Pacote com prazo não reconhecido fica desmarcado e aparece nos avisos. O relatório do TikTok não traz prazo: pedido "A ser enviado" conta como do dia.
- **Duas conferências por item:** Separado e embalado, e Despachado.

- A plataforma aparece por extenso em cada item.
- A quantidade é a unidade de venda: um kit vendido é 1, não o número de peças internas.
- Linhas de resumo de pacote do Mercado Livre não viram produtos. Os dados de envio do resumo são herdados somente pelas linhas associadas a esse pacote.
- Importar novamente o mesmo item não soma sua quantidade. Dados conflitantes impedem a importação; use **Iniciar novo lote** antes de importar um relatório atualizado.
- Cancelados, entregues e outros status fora da lista de preparação não são incluídos e aparecem nos avisos. Revise todos os avisos; esta versão aceita os dois layouts fornecidos e seus cabeçalhos, não promete todos os layouts futuros.
- A busca pela etiqueta é exata; não há aproximação por nome, CEP ou trecho de código. Um pedido localizado seleciona todos os itens do mesmo pacote.
- É possível baixar um só item ou vários. Seleção incompleta de um pacote exige confirmação e fica marcada no PDF.
- A4 tem paginação automática para lotes maiores; não diminui indefinidamente a letra nem corta produtos para caber em uma página.
- Esta versão recebe planilhas, não fotos/PDFs/ZPL de etiquetas. Confira o código com a etiqueta física.

## Privacidade

Processamento no computador com **Docling**. Não usa APIs de marketplace, CDN ou telemetria. O servidor escuta somente em `127.0.0.1`; não oferece acesso pela rede. Arquivos originais não são alterados. As cópias temporárias da conversão são removidas automaticamente; os itens importados ficam em memória até encerrar ou iniciar novo lote. O PDF baixado fica no local escolhido pelo navegador e contém destinatários e identificadores de pedido: não o publique nem faça commit.

## Dependências

Configurado para este Mac com Python/ReportLab do runtime local e Docling em `$HOME/DEV/01-Tools/docling/.venv-imep/bin/docling`. Não instala pacotes automaticamente.

Para outro ambiente, use Python 3.10+ com `reportlab`, e o Docling local instalado. `SEPARACAO_PYTHON` permite escolher o Python; `DOCLING_CLI` permite escolher o executável Docling. O launcher também aceita um Python em `.venv/bin/python3` nesta pasta. Não é um aplicativo autossuficiente para distribuir para outros computadores.

Testes: execute `python3 -m unittest discover -s tests -v` com o Python que tenha ReportLab. O teste real opcional usa `SEPARACAO_TESTAR_ARQUIVOS=1` e os dois XLSX originais em Downloads; eles não são copiados para o repositório.

Referências de implementação: [Docling](https://docling-project.github.io/docling/concepts/serialization/) e [tabelas ReportLab](https://docs.reportlab.com/reportlab/userguide/ch7_tables/).
