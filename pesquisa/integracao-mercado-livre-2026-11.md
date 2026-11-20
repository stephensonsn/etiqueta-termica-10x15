# Integração com o Mercado Livre: o que a documentação diz (pesquisa de 20/11/2026)

Pesquisa feita com o Firecrawl local (self-hosted), páginas oficiais raspadas na data. Cópias em markdown ficaram
no scratchpad da sessão; aqui ficam as conclusões com a fonte de cada uma.

## 1. Criar aplicação própria: bloqueado hoje

| Fato | Fonte |
| --- | --- |
| A página "Crie uma aplicação no Mercado Livre" (atualizada em 16/11/2026, BR e MX iguais) não tem mais o passo a passo: manda preencher um formulário e "analisaremos sua solicitação". | developers.mercadolivre.com.br/pt_br/crie-uma-aplicacao-no-mercado-livre |
| O formulário (forms.gle/2Q39SStHLJNQLjuK9) está fechado: "não está mais aceitando respostas". | Conferido no navegador em 19/11/2026 |
| O DevCenter, com a conta vinculada, não mostra botão de criar; /devcenter/create-app dá erro. | Conferido no navegador em 19/11/2026 |
| O suporte de desenvolvedores (developers.mercadolivre.com.br/support) recusa: "Canal exclusivo para integradores certificados pelo Developer Partner Program". | Conferido no navegador em 19/11/2026 |
| Entrar no Developer Partner Program exige, no Brasil, GMV mensal de USD 2.500.000 dos vendedores que usam a solução, assessment de segurança ≥ 65% e análise trimestral. Fora de alcance para uso próprio. | developers.mercadolivre.com.br/pt_br/developer-partner-program (atualizada em 14/10/2026) |
| Desde 30/08/2026 cada aplicação é de uma unidade só (Mercado Livre ou Mercado Pago); app com escopo `urn:mp:...` perde acesso às APIs do Mercado Livre. O app "WooCommerce" que existe na conta é de Mercado Pago, então não serve. | developers.mercadolivre.com.br/devcenter/gerencie-seu-aplicativo (atualizada em 15/10/2026) |
| Quando existir app, a configuração é: Redirect URI HTTPS, PKCE opcional, unidade Mercado Livre, escopos leitura/escrita, tópicos de notificação. Nosso código já segue isso (PKCE S256, retorno HTTPS no GitHub Pages). | global-selling.mercadolibre.com/devsite/create-application (mesmo formulário de app) |

## 2. Caminhos que funcionam sem app próprio

### A. Extensão no Seller Central (mesmo modelo do TikTok) — recomendado
- A extensão do Chrome já automatiza o TikTok dentro da página logada do vendedor. No Mercado Livre o mesmo vale:
  na lista de vendas, emitir a NF-e pelo emissor integrado e baixar a etiqueta; a ponte já imprime sozinha o que cai em
  Downloads (casando etiqueta e DANFE).
- Não precisa de app, nem de aprovação, nem de mensalidade. A trava "erro de cadastro só tenta de novo depois de
  Corrigi" é a mesma do TikTok.
- Requisitos do emissor integrado (grátis): CNPJ habilitado na Sefaz do estado, cadastro do ML igual ao da Sefaz,
  certificado digital A1, Simples Nacional ou Regime Normal (Normal precisa das regras tributárias); MEI do RS não pode.
  Fonte: mercadolivre.com.br/emitir-nota-fiscal/
- Limite: depende da tela do Seller Central (se o ML mudar a tela, a extensão precisa de ajuste) e do Chrome aberto e logado.

### B. ERP certificado com API pública (Bling)
- O Bling é integrador do ML e tem API pública aberta (qualquer um cria app no Bling, OAuth): developer.bling.com.br.
- Ele importa os pedidos do ML, emite a NF-e e envia ao ML; `GET /logisticas/etiquetas?formato=...&idsVendas[]=...`
  devolve as etiquetas do Mercado Envios (inclusive ZPL). Fontes: developer.bling.com.br/referencia;
  ajuda.bling.com.br "Etiqueta da logística Mercado Envios" e "Como imprimir etiquetas no formato ZPL".
- Atenção: a integração do Bling com o Faturador do ML só funciona em SP; fora de SP a nota sai pelo emissor do próprio
  Bling (com o A1 da empresa). Fonte: capturama.com.br/guias/bling/mercado-livre/ (cita a central do Bling, 15/10/2026).
- Custo: assinatura do Bling. Mesmo raciocínio vale para Olist/Tiny (API v2/v3 com "Gerar Nota Fiscal do Pedido").

### C. Continuar tentando o app próprio
- Pedir pelo atendimento de vendedor (texto pronto entregue em 19/11) e vigiar se o formulário reabre.
- Quando sair, nada muda no código: colar ID e chave secreta no painel e clicar Conectar.

## 3. Decisão sugerida
1. Fazer o caminho A agora (extensão no Seller Central), reaproveitando o que já funciona no TikTok.
2. Manter o código da API (já pronto, testado em simulação) para o dia em que houver app.
3. Bling só se a empresa já usa ou quer um ERP; não vale assinar só para a etiqueta.
