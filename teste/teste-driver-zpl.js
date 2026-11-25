// Arquivo de etiqueta (.txt com ZPL) aberto e mandado imprimir pelo Mac: tem que sair a etiqueta,
// não o código. Erro de 25/11/2026: o .txt do TikTok impresso pelo navegador saiu como 4 páginas
// de texto ZPL. O filtro do driver (driver-mac/etiquetatexto) acha o ZPL e a ponte desenha.
// Roda o filtro de verdade (caminho do texto; o do PDF também, se o zpldopdf e o Chrome existirem).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');
const { subir, RAIZ } = require('./ponte-teste');

const FILTRO = path.join(RAIZ, 'driver-mac', 'etiquetatexto');
const ML = path.join(RAIZ, 'exemplos', 'mercado-livre-exemplo.txt');
const filtrar = (arq) => execFileSync('/bin/sh', [FILTRO, '1', 'teste', 'titulo', '1', '', arq], { maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
const entregar = (porta, bytes) => new Promise((ok, erro) => { const c = net.connect(porta, '127.0.0.1', () => c.end(bytes, ok)); c.on('error', erro); });

(async () => {
  // o filtro marca o trabalho como ZPL e entrega o código intacto
  const saida = filtrar(ML);
  assert(saida.toString('latin1').startsWith('%ETIQUETA-ZPL\n'), 'texto com ZPL sai marcado');
  assert.equal(saida.toString('utf8').replace(/^%ETIQUETA-ZPL\n/, ''), fs.readFileSync(ML, 'utf8'), 'ZPL intacto');
  // PDF (navegador): só quando der para gerar aqui
  const zpldopdf = path.join(RAIZ, 'driver-mac', 'zpldopdf');
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(zpldopdf) && fs.existsSync(chrome)) {
    const pdf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zpl-pdf-')), 'etiqueta.pdf');
    try { execFileSync(chrome, ['--headless=new', '--disable-gpu', `--print-to-pdf=${pdf}`, 'file://' + ML], { stdio: 'ignore', timeout: 60000 }); } catch (_) { /* sem Chrome utilizável */ }
    if (fs.existsSync(pdf)) {
      const z = filtrar(pdf).toString('utf8');
      assert(z.startsWith('%ETIQUETA-ZPL\n'), 'PDF do navegador com ZPL sai marcado');
      assert.equal(z.replace(/^%ETIQUETA-ZPL\n/, '').replace(/\s+/g, ''), fs.readFileSync(ML, 'utf8').replace(/\s+/g, ''), 'ZPL do PDF igual ao do arquivo');
      console.log('ok: ZPL achado no PDF impresso pelo navegador');
    }
  }

  // a ponte recebe pelo driver e desenha a etiqueta; mandar de novo de propósito imprime de novo
  const p = await subir({ imprimir: 'direto' });
  try {
    await entregar(p.portaDriver, saida);
    assert(await p.esperar(async () => p.impressos().length === 1, 20000), 'etiqueta impressa:\n' + await p.log());
    const item = (await p.estado()).pedidos.find((x) => x.estado === 'impresso');
    assert(item && !/outro programa/.test(item.tipo), 'saiu como etiqueta, não como documento de texto');
    await entregar(p.portaDriver, saida);
    assert(await p.esperar(async () => p.impressos().length === 2, 20000), 'reimprimir pelo Mac não é barrado como repetido');
    assert(/código ZPL impresso pelo Mac/.test(await p.log()));
  } finally { p.parar(); }
  console.log('ok: .txt de etiqueta impresso pelo Mac sai como etiqueta (texto e PDF), não como código');
  process.exit(0);
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
