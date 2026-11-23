// Lista do TikTok: a automação só confia na lista quando o contador "N pedidos encontrados" bate
// com as linhas na tela. Erro de 23/11/2026: o TikTok lento mostrava a tela sem linhas e a rodada
// dizia "nenhum pedido novo" com 3 pedidos esperando.
'use strict';
const assert = require('assert');
const { criar, linhaPedido } = require('./ambiente-extensao');

const tres = () => [linhaPedido('587350241776600631', 'Sem NF-e'), linhaPedido('587350401991804497', '1 NF-e'), linhaPedido('587350622098523615', 'Processando NF-e')];

(async () => {
  // 1) carregando (só o menu, ~18 s) e depois 3 pedidos: espera e acha os 3
  let a = criar();
  a.tela.cenario = (t) => (t < 18000 ? { texto: 'Gerenciar pedidos Status da NF-e', linhas: [] } : { texto: '3 pedidos encontrados', linhas: tres() });
  assert.equal(await a.f.listaCarregada(), true);
  assert(a.decorrido() >= 18000, 'tem que esperar a lista carregar');
  assert.equal(a.f.linhasDePedido().length, 3);

  // 2) contador já diz 3 mas as linhas ainda não desenharam: não pode dar por carregada
  a = criar();
  a.tela.cenario = (t) => (t < 9000 ? { texto: '3 pedidos encontrados', linhas: [] } : { texto: '3 pedidos encontrados', linhas: tres() });
  assert.equal(await a.f.listaCarregada(), true);
  assert(a.decorrido() >= 9000, 'contador sem linhas não basta');

  // 3) "Nenhum pedido" que logo vira 2 pedidos: confirma depois de 8 s e acha os 2
  a = criar();
  a.tela.cenario = (t) => (t < 3000 ? { texto: 'Nenhum pedido', linhas: [] } : { texto: '2 pedidos encontrados', linhas: tres().slice(0, 2) });
  assert.equal(await a.f.listaCarregada(), true);
  assert.equal(a.f.linhasDePedido().length, 2, 'vazio passageiro não pode virar "nenhum pedido novo"');

  // 4) vazio de verdade (continua vazio depois de 8 s): carregada, sem pedidos
  a = criar();
  a.tela.cenario = () => ({ texto: 'Nenhum pedido', linhas: [] });
  assert.equal(await a.f.listaCarregada(), true);
  assert.equal(a.f.linhasDePedido().length, 0);

  // 5) nunca carregou em 60 s: falha (a rodada para com motivo, não diz "nenhum pedido novo")
  a = criar();
  a.tela.cenario = () => ({ texto: 'Gerenciar pedidos', linhas: [] });
  assert.equal(await a.f.listaCarregada(), false);

  // 6) status da NF-e por linha
  const [sem, emitida, proc] = tres();
  assert.equal(a.f.statusNfe(sem), 'sem');
  assert.equal(a.f.statusNfe(emitida), 'emitida');
  assert.equal(a.f.statusNfe(proc), 'processando');

  console.log('ok: lista do TikTok só vale carregada (contador = linhas; vazio confirmado em 8 s)');
  process.exit(0);
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
