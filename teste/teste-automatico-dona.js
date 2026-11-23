// Aba dona da automação do TikTok: se ela foi fechada, a marca "ligada em outra aba" ficava para
// sempre e nenhuma aba rodava (23/11/2026: dois pedidos parados com o quadrinho dizendo isso).
// Agora a dona dá sinal a cada 30 s; sem sinal há mais de 3 min, a aba aberta assume sozinha.
'use strict';
const assert = require('assert');
const { criar } = require('./ambiente-extensao');
const esperarFila = () => new Promise((r) => setTimeout(r, 50));

(async () => {
  // regra pura
  const { donaSumiu, ORFA } = criar().f;
  assert.equal(donaSumiu(null, 1e6), false, 'desligada não é dona sumida');
  assert.equal(donaSumiu({ dono: 'x', quando: 1e6 - 30000 }, 1e6), false, 'sinal recente: a outra aba está viva');
  assert.equal(donaSumiu({ dono: 'x', quando: 1e6 - ORFA - 1 }, 1e6), true, 'sem sinal há mais de 3 min');
  assert.equal(donaSumiu({ dono: 'x' }, 1e6), true, 'marca antiga, sem hora');

  // dona fechada há 10 min: a aba que abriu assume
  const a = criar({ armazem: (agora) => ({ ttAuto: { dono: 'aba-fechada', quando: agora - 10 * 60000 } }) });
  for (let i = 0; i < 20 && a.armazem.ttAuto.dono === 'aba-fechada'; i++) await esperarFila();
  assert.equal(a.armazem.ttAuto.dono, a.f.meuId, 'esta aba assumiu a automação');

  // dona viva (sinal há 20 s): não rouba a vez
  const b = criar({ armazem: (agora) => ({ ttAuto: { dono: 'aba-viva', quando: agora - 20000 } }) });
  for (let i = 0; i < 10; i++) await esperarFila();
  assert.equal(b.armazem.ttAuto.dono, 'aba-viva', 'não assume com a outra aba viva');

  console.log('ok: aba dona fechada é substituída depois de 3 min sem sinal; dona viva continua');
  process.exit(0);
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
