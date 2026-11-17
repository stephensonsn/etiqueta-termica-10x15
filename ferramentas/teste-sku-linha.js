#!/usr/bin/env node
// Teste de UMA linha do rolo de etiquetas de produto (3 colunas de 35 x 25 mm).
// Cada etiqueta sai com uma moldura exatamente nas bordas que o programa calcula, o número da coluna
// e uma régua em mm. Pela foto dá para ver se a moldura cai dentro de cada etiqueta física ou se
// "anda" para o lado (espaço entre colunas ou margem esquerda errados) ou para cima/baixo (sensor).
//
// Uso:  node ferramentas/teste-sku-linha.js [--espaco 2.5] [--margem 0] [--largura 34] [--altura 23]
//       node ferramentas/teste-sku-linha.js --arquivo     só grava ferramentas/teste-sku-linha.tspl
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');

const arg = (n, pad) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : pad; };
const larguraMm = arg('largura', 35), alturaMm = arg('altura', 25);
const espacoMm = arg('espaco', 2.2), margemMm = arg('margem', 1), colunas = 3;
const PM = 8;
const wCol = Math.round(larguraMm * PM), hEt = Math.round(alturaMm * PM);
const passo = Math.round((larguraMm + espacoMm) * PM), x0 = Math.round(margemMm * PM);
const totalMm = Math.min(108, Math.ceil(margemMm + colunas * larguraMm + (colunas - 1) * espacoMm));

const c = [];
for (let k = 0; k < colunas; k++) {
  const x = x0 + k * passo;
  c.push(`BOX ${x},0,${x + wCol - 1},${hEt - 1},2`);                 // moldura na borda calculada
  for (let mm = 0; mm <= larguraMm; mm++) {                            // régua no topo, risco por mm
    const alto = mm % 10 === 0 ? 24 : mm % 5 === 0 ? 16 : 8;
    c.push(`BAR ${x + Math.min(mm * PM, wCol - 2)},0,2,${alto}`);
  }
  for (let mm = 0; mm <= alturaMm; mm++) {                             // régua na esquerda
    const largo = mm % 10 === 0 ? 24 : mm % 5 === 0 ? 16 : 8;
    c.push(`BAR ${x},${Math.min(mm * PM, hEt - 2)},${largo},2`);
  }
  c.push(`BAR ${x + wCol / 2 - 1},${hEt / 2 - 20},3,40`);              // centro
  c.push(`BAR ${x + wCol / 2 - 20},${hEt / 2 - 1},40,3`);
  c.push(`TEXT ${x + 40},${hEt / 2 - 30},"4",0,1,1,"${k + 1}"`);       // número da coluna
  c.push(`TEXT ${x + wCol / 2 + 30},${hEt - 40},"2",0,1,1,"COL ${k + 1}"`);
}

const tspl = Buffer.from(
  '\r\n'.repeat(1024) +
  `SIZE ${totalMm} mm,${alturaMm} mm\r\nGAP 2 mm,0 mm\r\nREFERENCE 0,0\r\nDIRECTION 0\r\nOFFSET 0 mm\r\nDENSITY 8\r\nSPEED 4\r\nCLS\r\n` +
  c.join('\r\n') + '\r\nPRINT 1,1\r\n', 'latin1');

const arq = path.join(__dirname, 'teste-sku-linha.tspl');
fs.writeFileSync(arq, tspl);
console.log(`teste gerado: ${arq} (${tspl.length} bytes; ${colunas} x ${larguraMm}x${alturaMm} mm, espaço ${espacoMm} mm, margem ${margemMm} mm, papel ${totalMm} mm)`);
if (process.argv.includes('--arquivo')) process.exit(0);

const sock = net.connect({ host: '127.0.0.1', port: 9102 }, () => sock.end(tspl));
sock.setTimeout(15000, () => { console.error('a ponte não respondeu na porta 9102'); sock.destroy(); process.exit(1); });
sock.on('error', (e) => { console.error(`ponte fora do ar: ${e.message}`); process.exit(1); });
sock.on('close', () => console.log(`${new Date().toLocaleTimeString('pt-BR')} enviado para a impressora`));
