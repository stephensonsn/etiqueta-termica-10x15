#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');
const {generate,parseCSV}=require('./etiquetas-sku');
function options(args){const res={};for(let i=0;i<args.length;i++){if(args[i]==='--imprimir'){res.imprimir=true;continue;}if(!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Argumento invalido: ${args[i]}`);res[args[i].slice(2)]=args[++i];}return res;}
async function main(){
 const a=options(process.argv.slice(2));
 if(!a.csv)throw new Error('Uso: node scripts/imprimir-skus.js --csv exemplos/squishies.csv --saida /tmp/squishies.tspl --colunas 2 --largura-impressao 100 [--imprimir]');
 const rows=parseCSV(fs.readFileSync(a.csv,'utf8'));
 const params={ columns:Number(a.colunas??2),labelWidthMm:Number(a['etiqueta-largura']??34),labelHeightMm:Number(a['etiqueta-altura']??23),gapXmm:Number(a['gap-horizontal']??2),gapYmm:Number(a['gap-vertical']??2),printableWidthMm:Number(a['largura-impressao']??100),paperWidthMm:a['papel-largura']?Number(a['papel-largura']):undefined,leftMm:Number(a['margem-esquerda']??2)};
 const {tspl,manifest}=generate(rows,params);
 const output=path.resolve(a.saida||'etiquetas-sku.tspl');fs.writeFileSync(output,tspl);
 fs.writeFileSync(output+'.json',JSON.stringify({...manifest,generatedAt:new Date().toISOString()},null,2));
 process.stdout.write(`Preparado: ${manifest.labels} etiquetas / ${manifest.rows} linhas | ${output}\n`);
 if(a.imprimir){
  const {enviarBruto}=require('../src/impressora');
  try{await enviarBruto(Buffer.from(tspl,'ascii'));process.stdout.write('Enviado ao agente de impressao; confira fisicamente cada etiqueta.\n');}
  finally{process.exit(0);}
 }
}
main().catch(e=>{console.error('ERRO:',e.message);process.exit(1);});
