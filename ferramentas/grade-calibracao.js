#!/usr/bin/env node
// Etiqueta de calibração: grade com a posição de todas as linhas e colunas, em milímetros.
// Usa só comandos nativos da impressora (BOX, BAR, TEXT), sem passar pela montagem de imagem,
// para medir o comportamento físico dela: onde a impressão começa, o que é cortado em cada borda,
// se sai torta ou deslocada. Com a foto da etiqueta impressa dá para ler, pelos números que
// aparecem inteiros em cada borda, quantos milímetros estão sendo perdidos de cada lado.
//
// Uso:  node ferramentas/grade-calibracao.js            imprime pela ponte (conexão escolhida no painel)
//       node ferramentas/grade-calibracao.js --arquivo   só grava ferramentas/grade-calibracao.tspl
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');

const PM = 8;                 // pontos por milímetro (203 dpi)
const L = 100 * PM;           // 800 pontos de largura
const A = 150 * PM;           // 1200 pontos de altura (a imagem útil vai até 1198)
const c = [];                 // comandos

const texto = (x, y, fonte, s, mult = 1) => c.push(`TEXT ${x},${y},"${fonte}",0,${mult},${mult},"${s}"`);
const barra = (x, y, w, h) => c.push(`BAR ${x},${y},${w},${h}`);

// 1) moldura exatamente na borda do papel: se um lado sumir na impressão, esse lado está sendo cortado
c.push(`BOX 0,0,${L - 1},${A - 3},3`);

// 2) régua horizontal (colunas) no topo e na base: risco a cada 1 mm, maior a cada 5, número a cada 10
for (let mm = 0; mm <= 100; mm++) {
  const x = Math.min(mm * PM, L - 2);
  const alto = mm % 10 === 0 ? 40 : mm % 5 === 0 ? 24 : 12;
  barra(x, 0, 2, alto);
  barra(x, A - 2 - alto, 2, alto);
  if (mm % 10 === 0 && mm > 0 && mm < 100) {
    texto(x - 8, 44, '2', String(mm));
    texto(x - 8, A - 2 - 64, '2', String(mm));
  }
}

// 3) régua vertical (linhas) na esquerda e na direita: risco a cada 1 mm, maior a cada 5, número a cada 10
for (let mm = 0; mm <= 150; mm++) {
  const y = Math.min(mm * PM, A - 4);
  const largo = mm % 10 === 0 ? 40 : mm % 5 === 0 ? 24 : 12;
  barra(0, y, largo, 2);
  barra(L - largo, y, largo, 2);
  if (mm % 10 === 0 && mm > 0 && mm < 150) {
    texto(46, y - 8, '2', String(mm));
    texto(L - 46 - (mm >= 100 ? 36 : 24), y - 8, '2', String(mm));
  }
}

// 4) grade interna a cada 10 mm, em linha fina, para ver se a impressão sai torta
for (let mm = 10; mm < 100; mm += 10) barra(mm * PM, 90, 1, A - 180);
for (let mm = 10; mm < 150; mm += 10) barra(90, mm * PM, L - 180, 1);

// 5) área que a etiqueta usa hoje (margens de 4,5 mm nas laterais e 4 mm em cima e embaixo)
c.push(`BOX 36,32,${L - 36},${A - 2 - 32},4`);

// 6) centro e identificação
barra(L / 2 - 60, A / 2 - 1, 120, 3);
barra(L / 2 - 1, A / 2 - 60, 3, 120);
texto(L / 2 - 186, A / 2 + 100, '3', 'GRADE DE CALIBRACAO');
texto(L / 2 - 186, A / 2 + 140, '2', 'Colunas e linhas em mm');
texto(L / 2 - 186, A / 2 + 172, '2', 'Fotografe a etiqueta inteira');
c.push(`REVERSE ${L / 2 - 210},${A / 2 + 80},420,150`); // fundo preto, letra branca
texto(L / 2 - 120, A / 2 - 120, '3', 'CENTRO 50 x 75');
texto(L / 2 - 40, 140, '3', 'TOPO');
texto(L / 2 - 40, A - 190, '3', 'BASE');
texto(110, A / 2 - 12, '3', 'ESQ');
texto(L - 170, A / 2 - 12, '3', 'DIR');

// mesmo cabeçalho que a ponte usa nas etiquetas (com o enchimento contra a perda do começo pelo USB)
const tspl = Buffer.from(
  '\r\n'.repeat(1024) +
  `SIZE 100 mm,150 mm\r\nREFERENCE 0 ,0 \r\nDIRECTION 0\r\nGAP 2 mm,0 mm\r\nOFFSET 2 mm\r\nDENSITY 6\r\nSPEED 8\r\nCLS\r\n` +
  c.join('\r\n') + '\r\nPRINT 1,1\r\n', 'latin1');

const arq = path.join(__dirname, 'grade-calibracao.tspl');
fs.writeFileSync(arq, tspl);
console.log(`grade gerada: ${arq} (${tspl.length} bytes, ${c.length} comandos)`);
if (process.argv.includes('--arquivo')) process.exit(0);

// espera a impressora estar conectada (até 15 minutos, consultando a cada 3 s) e envia pela ponte,
// que manda pela conexão escolhida no painel
const http = require('http');
const LIMITE = Date.now() + 15 * 60 * 1000;
function situacao() {
  return new Promise((ok) => {
    http.get('http://127.0.0.1:9100/api/estado', { timeout: 4000 }, (r) => {
      let b = ''; r.on('data', (d) => { b += d; });
      r.on('end', () => { try { ok(JSON.parse(b).fila); } catch (_) { ok(null); } });
    }).on('error', () => ok(null)).on('timeout', function () { this.destroy(); ok(null); });
  });
}
(async () => {
  let avisou = '';
  for (;;) {
    const f = await situacao();
    if (f && f.ok) break;
    const t = f ? f.texto : 'ponte fora do ar';
    if (t !== avisou) { console.log(`${new Date().toLocaleTimeString('pt-BR')} aguardando: ${t}`); avisou = t; }
    if (Date.now() > LIMITE) { console.error('desisti: a impressora não conectou em 15 minutos'); process.exit(1); }
    await new Promise((r) => setTimeout(r, 3000));
  }
  const sock = net.connect({ host: '127.0.0.1', port: 9102 }, () => sock.end(tspl));
  sock.setTimeout(15000, () => { console.error('a ponte não respondeu na porta 9102'); sock.destroy(); process.exit(1); });
  sock.on('error', (e) => { console.error(`ponte fora do ar: ${e.message}`); process.exit(1); });
  sock.on('close', () => console.log(`${new Date().toLocaleTimeString('pt-BR')} enviada para a impressora`));
})();
