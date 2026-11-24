// Histórico do quadrinho: pedido impresso limpa o que já se resolveu (23/11/2026: ficavam
// "tentando de novo", "Parei: botão não ficou disponível" e "esta assumiu" depois de impresso).
'use strict';
const assert = require('assert');
const { criar } = require('./ambiente-extensao');

const { semResolvidos } = criar().f;
const antes = [
  '23:06 Pedido …538221: tentando de novo',
  '23:06 A aba que estava ligada foi fechada; esta assumiu',
  '23:06 Parei: o botão "Criar e imprimir etiqueta" não ficou disponível',
  '23:05 Pedido …111111: falta dado fiscal no cadastro do produto. Corrija no TikTok e clique "Corrigi, tentar de novo".',
  '22:50 Etiqueta impressa: pedido …222222',
  '22:40 Nota fiscal pedida: pedido …538221',
];
const depois = semResolvidos(antes, 'Etiqueta impressa: pedido …538221');
assert.deepEqual(depois, [antes[3], antes[4]], 'some o que se resolveu; fica pendência de outro pedido e impressão anterior');
assert.deepEqual(semResolvidos(antes, 'Nota fiscal pedida: pedido …538221'), antes, 'só impressão limpa');
assert.deepEqual(semResolvidos(['x …538221', 'y …333333'], 'Impresso de novo (não tinha saído na térmica): pedido …538221, pedido …333333'), [], 'reimpressão de vários limpa todos');
console.log('ok: pedido impresso limpa do histórico os avisos já resolvidos');
process.exit(0);
