# Etiquetas internas SKU 34 x 23 mm — Trend Toy

MVP em TSPL para a impressora Oásis OIA-8370-B. **Não modifica estoque, anúncio ou GTIN.**

## Primeiros passos

Acesse seu clone do repositório atualizado na branch `feat/squishy-sku-labels-34x23` e execute:

```bash
node --test teste/teste-sku.js
node scripts/imprimir-skus.js --csv exemplos/squishies.csv --saida /tmp/trendtoy-sku.tspl --colunas 2 --largura-impressao 100
```

Após montar o rolo e confirmar as dimensões, para impressão física:

```bash
node scripts/imprimir-skus.js --csv exemplos/squishies.csv --saida /tmp/trendtoy-sku.tspl --colunas 2 --largura-impressao 100 --imprimir
```

A opção `--imprimir` utiliza `enviarBruto` de `src/impressora.js`. Sem essa opção apenas gera arquivo TSPL e manifesto JSON. **Não executamos teste físico de impressão.**

## Limites de largura

O rolo do usuário é 34x23 mm em três colunas. São 102 mm só de etiquetas, sem espaços. O projeto atual usa 100 mm de largura útil para etiquetas de envio. **Três colunas estão bloqueadas por padrão** até identificar capacidade real da cabeça de impressão e medir espaçamento. O perfil inicial usa duas colunas do rolo (terceira em branco, provisoriamente), sujeito à verificação de avanço/posicionamento do equipamento.

## CSV

```csv
sku,barcode,descricao,quantidade
TT-SQ-UNI-BUN-001,SQ0001,Squishy Mini Unicornio,3
```

- `sku`: reproduzir exatamente o SKU interno real do Mercado Livre (`SELLER_SKU`).
- `barcode`: alias curto interno impresso em Code 128, não EAN/GTIN. O alias deve ser único e persistente no PIM. Aliases SQ0001 etc. são *propostos* e não foram gravados em nenhum ERP.
- `quantidade`: quantidade de etiquetas impressas; não indica saldo físico.

## Teste de homologação

1. Medir a largura do suporte e da área realmente imprimível da impressora, os gaps horizontais e verticais.
2. Validar que a bobina é térmica direta, compatível com o equipamento.
3. Imprimir uma linha com duas colunas, conferir posição, avanço e ausência de cortes.
4. Ler cada código Code128 com dois celulares, cinco vezes cada.
5. Verificar que o alias lido identifica o SKU correto e que o texto legível corresponde ao produto.
6. Após o teste, recolocar a bobina 100x150 e confirmar que etiquetas de envio continuam saindo corretamente.

## Evolução

Próximos passos: tela de criação de aliases no painel, persistência de mapeamentos, impressão mobile e fila auditada por pedido/produto. A presente mudança adiciona arquivos sem alterar o conversor ZPL/TSPL existente.
