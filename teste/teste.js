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
  // EAN-13: verificador, numeração interna sem repetir e etiqueta de produto com EAN13 na impressora
  const ean = require('../src/ean13.js');
  assert.strictEqual(ean.digito('789100031550'), '7');           // 7891000315507 (EAN real conhecido)
  assert.ok(ean.valido('7891000315507'));
  assert.ok(!ean.valido('7891000315508'));
  assert.strictEqual(ean.problema('810001'), 'não é EAN-13 (6 dígitos)');
  assert.strictEqual(ean.proximoInterno([]), '2000000000015');
  assert.strictEqual(ean.proximoInterno(['2000000000015', '7891000315507']), '2000000000022');
  assert.strictEqual(ean.modulos('7891000315507').length, 95);
  const sku = e.paraTsplSku([{ nome: 'Squishy ursinho game bar que brilha', cor: 'Rosa', barcode: '2000000000015', sku: 'TT-1' }]).toString('latin1');
  assert.ok(/BARCODE \d+,80,"EAN13",58,0,0,2,2,"200000000001"/.test(sku), 'EAN13 com 12 dígitos e módulo de 2 pontos');
  assert.ok(sku.includes('"SQUISHY URSINHO GAME BAR QUE"'), 'nome longo cortado no fim de palavra');
  assert.ok(sku.includes('SIZE 108 mm,25 mm'));
  // página só de controle que o Mercado Livre manda depois de cada etiqueta não vira etiqueta
  assert.strictEqual(e.separarPaginas('^XA^MCY^XZ').length, 0);
  assert.strictEqual(e.separarPaginas('^XA^FO10,10^A0N,30,30^FDOi^FS^XZ\n^XA^MCY^XZ').length, 1);
  // TikTok Shop: cada página é uma imagem ^GFA sem texto; vira uma etiqueta própria, sem corte
  const linhaTk = 'F'.repeat(202); // 101 bytes por linha, tudo preto
  const pgTk = `^XA,^FS\n^FO0,0\n^GFA,${101 * 40},${101 * 40},101,${(linhaTk + '\n').repeat(40)}^FS,^XZ`;
  const tk = await e.montar(pgTk);
  assert.strictEqual(tk.length, 1);
  assert.strictEqual(tk[0].tipo, 'TikTok Shop');
  assert.strictEqual(e.separarEnvios(pgTk + '\n' + pgTk).length, 2);
  // TikTok casado: lê a chave (Code 128) do rodapé da etiqueta e põe a faixa fiscal no padrão do ML
  const { lerCodigos } = require('../src/code128.js');
  const chaveFicticia = '35261100000000000100550020000000031000000017';
  const chaveOk = e.chaveValida(chaveFicticia) ? chaveFicticia : (() => { for (let d = 0; d < 10; d++) { const c = chaveFicticia.slice(0, 43) + d; if (e.chaveValida(c)) return c; } })();
  const zEtq = `^XA^PW800^FO40,40^GB720,900,3^FS^FO60,100^A0N,60,60^FDETIQUETA FICTICIA^FS^FO40,980^BY2^BCN,70,N,N,N^FD>;${chaveOk}^FS^XZ`;
  const etq = await e.montar(zEtq, 'cheio');
  const lidos = lerCodigos(etq[0].img).map((c) => c.texto);
  assert.ok(lidos.includes(chaveOk), 'leitor Code 128 acha a chave');
  const cas = await e.casarTikTok(etq[0].img);
  assert.ok(cas && cas.chave === chaveOk && cas.numero === '3' && cas.serie === '2', 'faixa fiscal com NF e série da chave');
  console.log('ok: todos os testes passaram');
})().catch((err) => { console.error('FALHOU:', err.message); process.exit(1); });
