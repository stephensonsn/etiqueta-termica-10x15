'use strict';
// Etiquetas SKU internas, independentes da etiqueta de transporte e do GTIN.
// Layout TSPL nativo: nao renderiza barcode em bitmap, preservando nitidez.
const DPI = 203;
const dot = (mm) => Math.round(Number(mm) * DPI / 25.4);
const txt = (s, max = 90) => String(s == null ? '' : s).normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[\x00-\x1f\x7f]/g, '')
  .replace(/["\\]/g, ' ').replace(/[^\x20-\x7e]/g, ' ')
  .trim().slice(0, max);
function assertFinite(x, name, low, high) {
  if (!Number.isFinite(Number(x)) || Number(x) < low || Number(x) > high) throw new Error(`${name}: valor invalido`);
  return Number(x);
}
function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 5000) throw new Error('Informe entre 1 e 5000 produtos');
  return rows.map((row, index) => {
    const sku = String(row.sku ?? '').trim();
    const barcode = String(row.barcode ?? sku).trim();
    const description = String(row.descricao ?? row.description ?? '').trim();
    const qty = Number(row.quantidade ?? row.quantity ?? 1);
    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{1,39}$/.test(sku)) throw new Error(`Linha ${index+1}: SKU invalido`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,6}$/.test(barcode)) throw new Error(`Linha ${index+1}: barcode longo ou invalido; defina alias interno curto`);
    if (!description) throw new Error(`Linha ${index+1}: descricao obrigatoria`);
    if (!Number.isInteger(qty) || qty < 1 || qty > 500) throw new Error(`Linha ${index+1}: quantidade invalida`);
    return { sku, barcode, descricao: description, quantidade: qty };
  });
}
function generate(rows, opts={}) {
  const data=validateRows(rows);
  const columns = assertFinite(opts.columns ?? 2, 'colunas', 1, 3);
  if (!Number.isInteger(columns)) throw new Error('colunas deve ser inteiro');
  const width = assertFinite(opts.labelWidthMm ?? 34, 'largura da etiqueta', 15, 80);
  const height = assertFinite(opts.labelHeightMm ?? 23, 'altura da etiqueta', 15, 80);
  const gapX = assertFinite(opts.gapXmm ?? 2, 'gap horizontal', 0, 10);
  const gapY = assertFinite(opts.gapYmm ?? 2, 'gap vertical', 0, 10);
  const left = assertFinite(opts.leftMm ?? 2, 'margem esquerda', 0, 15);
  const printableWidth = assertFinite(opts.printableWidthMm ?? 100, 'largura imprimivel', 35, 160);
  const requiredWidth = left + columns*width + (columns-1)*gapX;
  if (requiredWidth > printableWidth - 0.5) throw new Error(`BLOQUEADO: ${columns} colunas exigem ${requiredWidth.toFixed(1)} mm, mas largura imprimivel configurada e ${printableWidth} mm. Confirme o hardware antes de mudar --largura-impressao.`);
  const pgWidth = assertFinite(opts.paperWidthMm ?? Math.ceil(requiredWidth+left), 'largura papel', Math.ceil(requiredWidth), 160);
  const density = assertFinite(opts.density ?? 6, 'densidade', 0, 15);
  const speed = assertFinite(opts.speed ?? 3, 'velocidade', 1, 8);
  const all = data.flatMap(p => Array.from({length:p.quantidade},()=>p));
  const lines=[];
  for(let start=0;start<all.length;start+=columns){
    lines.push(`SIZE ${pgWidth} mm,${height} mm`, `GAP ${gapY} mm,0 mm`, `DENSITY ${density}`, `SPEED ${speed}`, 'DIRECTION 1', 'CLS');
    all.slice(start,start+columns).forEach((item,col)=>{
      const x=dot(left+col*(width+gapX));
      const y0=dot(1.5);
      const textW=Math.max(10,Math.floor((dot(width)-dot(3))/8));
      const title=txt(item.descricao,textW);
      const skustr=txt(item.sku,textW);
      // 34x23mm @203 dpi: descricao, CODE128 e SKU completo; barcode curto e estavel.
      lines.push(`TEXT ${x+dot(1.5)},${y0},"0",0,1,1,"${title}"`);
      lines.push(`BARCODE ${x+dot(1.5)},${dot(5)},"128",${dot(10)},0,0,2,2,"${item.barcode}"`);
      lines.push(`TEXT ${x+dot(1.5)},${dot(16.5)},"0",0,1,1,"${skustr}"`);
    });
    lines.push('PRINT 1,1');
  }
  const map=new Map();
  for(const item of data){
    if(map.has(item.barcode)&&map.get(item.barcode)!==item.sku) throw new Error(`Codigo ${item.barcode} atribuido a SKUs diferentes`);
    map.set(item.barcode,item.sku);
  }
  return { tspl:lines.join('\r\n')+'\r\n', manifest:{layout:{columns,labelWidthMm:width,labelHeightMm:height,gapXmm:gapX,gapYmm:gapY,printableWidthMm:printableWidth,paperWidthMm:pgWidth},rows:Math.ceil(all.length/columns),labels:all.length,products:data} };
}
function parseCSV(input){
  const records=[];let row=[],field='',quoted=false;
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(quoted){if(c==='"'&&input[i+1]==='"'){field+='"';i++;}else if(c==='"'){quoted=false;}else{field+=c;}}
    else if(c==='"') quoted=true;
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'){row.push(field.replace(/\r$/,''));if(row.some(Boolean))records.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw new Error('CSV com aspas sem fechamento');
  row.push(field.replace(/\r$/,''));if(row.some(Boolean))records.push(row);
  if(records.length<2)throw new Error('CSV sem linhas de dados');
  const header=records.shift().map((s)=>s.trim().toLowerCase().replace(/^\uFEFF/,''));
  for(const required of ['sku','descricao','quantidade'])if(!header.includes(required))throw new Error('CSV precisa de sku,descricao,quantidade');
  return records.map((cells,index)=>{
    if(cells.length!==header.length)throw new Error(`CSV linha ${index+2}: numero de colunas incorreto`);
    return Object.fromEntries(header.map((h,i)=>[h,cells[i]]));
  });
}
module.exports={generate,parseCSV,validateRows,dot};
