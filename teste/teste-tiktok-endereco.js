// Teste do endereço do TikTok/iMile: etiqueta sintética (dados inventados) no desenho da iMile.
// Confere: rua e número antes do complemento, trava pelo rastreio e etiqueta sem endereço intacta.
'use strict';
const assert = require('assert');
const { PNG } = require('pngjs');
const { zplToBase64Async } = require('zpl-renderer-js');
const et = require('../src/etiqueta');
const { lerCodigos } = require('../src/code128');

const RASTREIO = '3320100000001';
const ZPL = `^XA^CI28^PW800^LH0,0
^FO45,462^GB711,244,2^FS
^FO525,462^GB2,244,2^FS
^FO80,490^GB50,50,25^FS
^FO155,486^A0N,20,20^FDFulano de Tal^FS
^FO155,524^A0N,22,20^FDApto 12, Centro Rua Exemplo^FS
^FO155,550^A0N,22,20^FD100, Cidade Teste, Sao Paulo, 0^FS
^FO155,575^A0N,22,20^FD1310100^FS
^FO55,663^A0N,40,40^FDTikTok Shop 01310100^FS
^FO95,808^BY3^BCN,90,N,N,N^FD${RASTREIO}^FS
^XZ`;

async function imagem(zpl) {
  const png = PNG.sync.read(Buffer.from(await zplToBase64Async(zpl, 100, 150, 8), 'base64'));
  const bits = new Uint8Array(png.width * png.height);
  for (let i = 0; i < bits.length; i++) bits[i] = png.data[i * 4 + 3] > 127 && png.data[i * 4] < 128 ? 1 : 0;
  return { l: png.width, a: png.height, bits };
}
const recorte = (img, x0, x1, y0, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += img.bits[y * img.l + x]; return n; };

(async () => {
  const folha = await imagem(ZPL);
  assert(lerCodigos(folha).some((c) => c.texto === RASTREIO), 'o rastreio precisa ser lido no código de barras');
  assert(et.caixaEnderecoTikTok(folha), 'a caixa do destinatário precisa ser achada');

  // sem endereço recebido: sai como veio
  let r = await et.reescreverEnderecoTikTok(folha);
  assert(!r.img && /não chegou/.test(r.motivo));

  // dado inválido (CEP curto) não entra
  assert.equal(et.registrarEnderecosTikTok([{ rastreio: RASTREIO, rua: 'Rua X', cidade: 'Y', cep: '123' }]), 0);
  // endereço de outro rastreio não é usado
  et.registrarEnderecosTikTok([{ rastreio: '3320199999999', rua: 'Rua Errada', numero: '1', cidade: 'Outra', uf: 'RJ', cep: '20000000' }]);
  r = await et.reescreverEnderecoTikTok(folha);
  assert(!r.img, 'não pode usar o endereço de outro pacote');

  assert.equal(et.registrarEnderecosTikTok([{ rastreio: RASTREIO, nome: 'FULANO DE TAL DA SILVA', nick: 'fulano', usuario: 'fulano123', rua: 'Rua Exemplo', numero: '100', complemento: 'Apto 12', bairro: 'Centro', cidade: 'Cidade Teste', uf: 'SP', cep: '01310100' }]), 1);
  r = await et.reescreverEnderecoTikTok(folha);
  assert(r.img, r.motivo);
  assert.equal(r.rastreio, RASTREIO);
  assert(r.nome && r.nick, 'nome do destinatário e nick devem caber');
  // fora da caixa do endereço nada muda (nome, bolinha, logo, QR e código de barras)
  const iguais = (x0, x1, y0, y1) => recorte(folha, x0, x1, y0, y1) === recorte(r.img, x0, x1, y0, y1);
  assert(iguais(0, 800, 0, 476), 'topo intacto (o nome é trocado pelo da NF-e)');
  assert(iguais(0, 800, 657, 1200), 'logo, código de barras e rodapé intactos');
  assert(iguais(0, 148, 0, 1200), 'bolinha e borda esquerda intactas');
  assert(iguais(520, 800, 0, 1200), 'lado do QR intacto');
  // a caixa foi redesenhada
  assert.notEqual(recorte(folha, 150, 520, 512, 657), recorte(r.img, 150, 520, 512, 657));
  // casos reais (dados inventados no mesmo formato): sem complemento e nome bem longo
  const R2 = '3320100000002';
  const folha2 = await imagem(ZPL.replace(RASTREIO, R2));
  et.registrarEnderecosTikTok([{ rastreio: R2, nome: 'MARIA APARECIDA DE FATIMA DOS SANTOS OLIVEIRA PEREIRA', nick: 'Maria Aparecida Santos', usuario: 'mariaaparecida.santos.oliveira', rua: 'Avenida Presidente Juscelino Kubitschek de Oliveira', numero: '1909', complemento: '', bairro: 'Jardim Presidente Dutra', cidade: 'São José dos Pinhais', uf: 'PR', cep: '83090-310' }]);
  const r2 = await et.reescreverEnderecoTikTok(folha2);
  assert(r2.img, 'nome longo e sem complemento ainda cabe: ' + r2.motivo);
  assert(r2.nome, 'nome da NF-e sempre aparece');
  assert.equal(r2.rastreio, R2);
  const iguais2 = (x0, x1, y0, y1) => recorte(folha2, x0, x1, y0, y1) === recorte(r2.img, x0, x1, y0, y1);
  assert(iguais2(0, 800, 657, 1200), 'nome longo não invade o código de barras');
  assert(iguais2(520, 800, 0, 1200), 'nome longo não invade o QR');
  // texto montado: rua e número primeiro, complemento por último e só quando existe
  const linhas = et.textoEnderecoTikTok ? et.textoEnderecoTikTok({ rua: 'Rua A', numero: '10', complemento: '', bairro: 'B', cidade: 'C', uf: 'SP', cep: '01310100' }) : null;
  assert(linhas, 'textoEnderecoTikTok exportado');
  assert(!linhas.some((l) => /Compl/.test(l)), 'sem complemento, sem linha "Compl."');
  const comp = et.textoEnderecoTikTok({ rua: 'Rua Nelson', numero: '39', complemento: 'casa', bairro: 'Sao Marcos', cidade: 'Sao Jose', uf: 'PR', cep: '83090310' });
  assert.deepEqual(comp, ['Rua Nelson, 39', 'Sao Marcos - Sao Jose/PR', 'CEP 83090-310', 'Compl.: casa'], 'rua e número primeiro; bairro - cidade/UF; CEP; complemento por último');
  console.log('ok: endereço do TikTok com rua e número antes do complemento, trava pelo rastreio');
  process.exit(0);
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
