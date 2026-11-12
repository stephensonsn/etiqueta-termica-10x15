#!/usr/bin/env node
// Uso: node src/imprimir.js <arquivo.txt|.zip> [...] [--previa] [--cheio]
//   --previa  só gera as imagens em previa/, não imprime
//   --cheio   envio e DACE em etiquetas separadas, tamanho cheio
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');
const { receberZpl, log } = require('./impressora');

(async () => {
  const args = process.argv.slice(2);
  const arquivos = args.filter((a) => !a.startsWith('--'));
  if (!arquivos.length) {
    console.error('Informe o arquivo da etiqueta (.txt ou .zip do Mercado Livre)');
    process.exit(2);
  }
  let falhas = 0;
  for (const arq of arquivos) {
    try {
      const zpl = arq.toLowerCase().endsWith('.zip')
        ? execFileSync('/usr/bin/unzip', ['-p', arq], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
        : fs.readFileSync(arq, 'utf8');
      await receberZpl(zpl, {
        origem: 'arquivo',
        imprimir: !args.includes('--previa'),
        modo: args.includes('--cheio') ? 'cheio' : undefined,
      });
    } catch (e) {
      falhas++;
      log(`ERRO em ${arq}: ${e.message}`);
    }
  }
  process.exit(falhas ? 1 : 0);
})();
