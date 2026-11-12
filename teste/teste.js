// Teste rápido, sem impressora: monta a etiqueta de exemplo (dados fictícios) e confere
// margens, tamanho, largura das barras e o comando gerado. Uso: npm test
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const e = require('../src/etiqueta.js');

const medir = (im) => {
  let x0 = im.l, x1 = 0, y0 = -1, y1 = 0;
  for (let y = 0; y < im.a; y++) for (let x = 0; x < im.l; x++) if (im.bits[y * im.l + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y0 < 0) y0 = y; y1 = y; }
  return { esq: x0, dir: im.l - 1 - x1, topo: y0, baixo: 1197 - y1 };
};

(async () => {
  const zpl = fs.readFileSync(path.join(__dirname, '..', 'exemplos', 'mercado-livre-exemplo.txt'), 'utf8');
  assert.strictEqual(e.separarEnvios(zpl).length, 1, 'um envio (etiqueta + DACE)');

  const [junta] = await e.montar(zpl, 'junto');
  assert.strictEqual(junta.tipo, 'envio + DACE');
  assert.strictEqual(junta.id, '40000000001');
  assert.deepStrictEqual([junta.img.l, junta.img.a], [800, 1200]);
  const m = medir(junta.img);
  assert.ok(m.esq >= 24 && m.dir >= 24, `margens laterais de 3 mm (${m.esq}/${m.dir})`);
  assert.ok(m.topo >= 16 && m.baixo >= 16, `margens de cima e de baixo de 2 mm (${m.topo}/${m.baixo})`);

  // código de barras do envio: módulos de 3 pontos, sem redimensionar
  const larguras = new Set();
  let c = 0, v = 0;
  for (let x = 200; x < 720; x++) { const b = junta.img.bits[300 * junta.img.l + x]; if (b === v) c++; else { larguras.add(c); c = 1; v = b; } }
  assert.ok([...larguras].filter((n) => n < 20).every((n) => n % 3 === 0), `barras em múltiplos de 3 pontos (${[...larguras]})`);

  // texto muito longo não pode estourar: ou cabe com letra menor, ou vira etiquetas separadas
  const longo = zpl.replace('Port_C3_A3o azul', 'texto comprido de teste '.repeat(40));
  const r = await e.montar(longo, 'junto');
  for (const x of r) { const mm = medir(x.img); assert.ok(mm.esq >= 24 && mm.dir >= 24, 'margens mantidas com texto longo'); }

  const tspl = e.paraTspl(junta.img);
  const cab = tspl.toString('latin1', 0, 2300);
  assert.ok(cab.includes('SIZE 100 mm,150 mm'), 'cabeçalho com o tamanho 100x150');
  assert.ok(cab.startsWith('\r\n'.repeat(100)), 'enchimento antes do cabeçalho');
  assert.ok(e.paraTsplCompacto(junta.img).length < tspl.length, 'versão compacta menor que a normal');

  const separadas = await e.montar(zpl, 'cheio');
  assert.strictEqual(separadas.length, 2, 'modo separado: duas etiquetas');

  // Shopee: a etiqueta chega como imagem pronta (~DG + ^XG) e só é encaixada no 10x15
  const shopee = fs.readFileSync(path.join(__dirname, '..', 'exemplos', 'shopee-exemplo.txt'), 'utf8');
  assert.strictEqual(e.separarEnvios(shopee).length, 1, 'Shopee: um envio');
  const [sh] = await e.montar(shopee, 'junto');
  assert.strictEqual(sh.tipo, 'envio + DACE (Shopee)');
  assert.deepStrictEqual([sh.img.l, sh.img.a], [800, 1200]);
  const ms = medir(sh.img);
  assert.ok(ms.topo >= 16 && ms.baixo >= 0, `Shopee cabe na altura (${ms.topo}/${ms.baixo})`);

  fs.mkdirSync(path.join(__dirname, '..', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'exemplo-shopee.png'), e.paraPng(sh.img));
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'exemplo-mercado-livre.png'), e.paraPng(junta.img));
  console.log('ok: todos os testes passaram');
})().catch((err) => { console.error('FALHOU:', err.message); process.exit(1); });
