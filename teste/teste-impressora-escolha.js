// Escolha da impressora: nunca uma de escritório (o teste de 23/11/2026 foi para a Brother e
// imprimiria páginas de lixo em TSPL). Roda com pasta de dados temporária: não toca a config real.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'etiqueta-escolha-'));
process.env.ETIQUETA_DADOS = dados;
process.env.ETIQUETA_SAIDA_TESTE = path.join(dados, 'saida');
const imp = require('../src/impressora');

try {
  assert.equal(imp.DADOS, dados, 'dados na pasta temporária');
  // escritório: nunca
  for (const nome of ['Brother DCP-L2540DW', 'HP LaserJet Pro M404', 'EPSON L3150 Series', 'Canon PIXMA G3110', 'DCP-T420W', 'MFC-L2710DW', 'Samsung M2020']) {
    assert.equal(imp.ehTermica({ nome, uri: '' }), false, `${nome} não é térmica`);
  }
  assert.equal(imp.ehTermica({ nome: 'Brother', uri: 'usb://Brother/DCP-L2540DW?serial=1' }), false, 'pela URI também');
  // térmicas: sim
  for (const nome of ['OIA-8370-B', 'Label Printer', 'XP-420B', 'Elgin L42 Pro', 'Zebra ZD220', 'TSC TE200']) {
    assert.equal(imp.ehTermica({ nome, uri: '' }), true, `${nome} é térmica`);
  }
  // com a Brother ligada no cabo e nenhuma térmica, a ponte não escolhe nada pelo USB
  imp.cfg.fila = '';
  assert.equal(imp.usbEscolhida([{ fila: 'Brother_DCP', nome: 'Brother DCP-L2540DW', ligada: true }]), undefined);
  // com as duas ligadas, escolhe a térmica
  const t = imp.usbEscolhida([{ fila: 'Brother_DCP', nome: 'Brother DCP-L2540DW', ligada: true }, { fila: 'OIA', nome: 'OIA-8370-B', ligada: true }]);
  assert.equal(t && t.fila, 'OIA');
  // térmica desligada não conta como conectada
  assert.equal(imp.usbEscolhida([{ fila: 'OIA', nome: 'OIA-8370-B', ligada: false }]), undefined);
  // nas conexões que este Mac enxerga agora, nenhuma impressora de escritório entra
  for (const c of imp.conexoesDisponiveis()) if (c.tipo === 'usb') assert(imp.ehTermica({ nome: c.fila || '' }), `conexão USB de escritório: ${c.fila}`);
  console.log('ok: impressora de escritório nunca é escolhida (nome e URI); só térmica ligada');
} finally { fs.rmSync(dados, { recursive: true, force: true }); }
process.exit(0);
