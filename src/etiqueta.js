// Converte a etiqueta ZPL do Mercado Livre (envio + DACE) em UMA etiqueta 10x15 cm
// e gera o comando TSPL para a impressora térmica. Tudo local: nada sai da máquina.
'use strict';
const { PNG } = require('pngjs');
const { zplToBase64Async } = require('zpl-renderer-js');

const L = 800;          // largura da etiqueta em pontos (100 mm a 203 dpi)
const A = 1200;         // altura da etiqueta em pontos (150 mm)
const ENVIO_L = 832;    // o ZPL do ML passa um pouco de 800; renderiza com folga
const ENVIO_A = 1218;
const LINHAS_MAX = 1198; // 150 mm a 203 dpi
const MX = 36;           // margem lateral de segurança (4,5 mm de cada lado)
const MY = 32;           // margem de cima e de baixo (4 mm)
const UTIL = L - 2 * MX; // largura útil, centralizada

// ---------- utilidades de ZPL ----------
function separarPaginas(zpl) {
  const paginas = [];
  // a Shopee manda a etiqueta como imagem: "~DG<gráfico>" antes do ^XA que a usa
  const re = /((?:~DG[^~^]*)*)\^XA[\s\S]*?\^XZ/g;
  let m;
  while ((m = re.exec(zpl))) {
    if (/\^ID[^\^]*\^FS/.test(m[0]) && !/\^(FD|XG|GF|GB|B[A-Z0-9])/.test(m[0].replace(/\^ID[^\^]*\^FS/, ''))) continue; // só apaga o gráfico da memória
    paginas.push(m[0]);
  }
  return paginas;
}
// Página que é só uma imagem pronta (modelo da Shopee): não tem texto para remontar.
const ehImagemPronta = (pagina) => /~DG/.test(pagina) && /\^XG/.test(pagina) && !/\^FD/.test(pagina);

// Decodifica texto de um ^FD com ^FH (ex.: _C3_A7 -> ç)
function decodificarFH(txt) {
  const bytes = [];
  const bruto = Buffer.from(txt, 'utf8');
  for (let i = 0; i < bruto.length; i++) {
    if (bruto[i] === 0x5f && i + 2 < bruto.length + 0 && /^[0-9A-Fa-f]{2}$/.test(bruto.toString('latin1', i + 1, i + 3))) {
      bytes.push(parseInt(bruto.toString('latin1', i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(bruto[i]);
  }
  return Buffer.from(bytes).toString('utf8');
}

// Codifica texto para um ^FD com ^FH (acentos e caracteres de controle viram _XX)
function codificarFH(txt) {
  let s = '';
  for (const b of Buffer.from(String(txt), 'utf8')) {
    if (b < 0x20 || b > 0x7e || b === 0x5f || b === 0x5e || b === 0x7e) s += '_' + b.toString(16).toUpperCase().padStart(2, '0');
    else s += String.fromCharCode(b);
  }
  return s;
}

function camposTexto(pagina) {
  const campos = [];
  const re = /\^FD([\s\S]*?)\^FS/g;
  let m;
  while ((m = re.exec(pagina))) campos.push(decodificarFH(m[1]).trim());
  return campos;
}

// ---------- documento fiscal (2ª página: DACE ou DANFE simplificado) ----------
function lerFiscal(pagina) {
  const campos = camposTexto(pagina);
  const tudo = campos.join('\n');
  const chave = (tudo.match(/(?<!\d)\d{44}(?!\d)/) || [])[0];
  if (!chave) return null;
  const dace = /DACE|DECLARA.{1,6}O AUXILIAR/i.test(tudo);
  const pega = (re) => ((tudo.match(re) || [])[1] || '').trim();
  return {
    titulo: dace ? 'DACE Resumida' : 'Danfe Simplificado',
    numero: pega(/N\S{0,6}\s+(\d[\d.]*)/) || String(parseInt(chave.slice(25, 34), 10)),
    serie: pega(/S.RIE:?\s+(\d+)/i) || String(parseInt(chave.slice(22, 25), 10)),
    emissao: pega(/EMISS.O:?\s*(\d{2}[-\/]\d{2}[-\/]\d{4})/i).replace(/-/g, '/'),
    chave,
  };
}

// Faixa fiscal no rodapé, igual ao modelo conjunto do Mercado Livre:
// título | número/série | emissão, e a chave de acesso em código de barras.
function zplFaixaFiscal(f) {
  return ['^XA', '^CI28', '^PW800', '^LH0,0',
    `^FO${MX},0^GB${UTIL},2,2^FS`,
    `^FO${MX},14^A0N,26,26^FH^FD${codificarFH(f.titulo)}^FS`,
    `^FO${MX},16^A0N,22,22^FB${UTIL},1,0,C^FH^FD${codificarFH(`Número ${f.numero}/Série ${f.serie}`)}^FS`,
    f.emissao ? `^FO${MX},16^A0N,22,22^FB${UTIL},1,0,R^FH^FD${codificarFH(`Emissão ${f.emissao}`)}^FS` : '',
    '^FO123,50^BY2,,0^BCN,92,N,N,N^FD>;' + f.chave + '^FS',
    `^FO${MX},150^A0N,24,24^FB${UTIL},1,0,C^FD${f.chave}^FS`,
    '^XZ'].join('\n');
}

// Reposiciona um ZPL do Mercado Livre para dentro das margens de segurança, centralizado.
// O conteúdo original vai de x=20 até x=800 (passa da etiqueta de 100 mm). Aqui cada posição,
// largura e fonte é reduzida na mesma proporção (cerca de 3,6%), mantendo o alinhamento entre
// os campos. Códigos de barras e QR não mudam de tamanho: só de posição.
function ajustarMargens(zpl, my = MY) {
  const lh = zpl.match(/\^LH(\d+),(\d+)/);
  const lx = lh ? Number(lh[1]) : 0;
  const k = UTIL / 780;
  const esc = (v) => Math.max(1, Math.round(v * k));
  return zpl.replace(/\^LH\d+,\d+/, '^LH0,0').split('^FS').map((seg) => {
    let x = null, dir = null; // dir = borda direita que o campo teria sem o limite da margem
    seg = seg.replace(/\^FO(\d+),(\d+)/, (_, fx, fy) => {
      const natural = MX + (Number(fx) + lx - 5 - 20 + (lx ? 0 : 5)) * k;
      x = Math.max(MX, Math.round(natural));
      dir = (w) => Math.min(L - MX, Math.round(natural + w * k));
      return `^FO${x},${Number(fy) + my}`;
    });
    if (x === null) return seg;
    seg = seg.replace(/\^A0N,(\d+),(\d+)/, (_, h, w) => `^A0N,${esc(h)},${esc(w)}`);
    // quando o início encosta na margem, a largura encolhe para a borda direita ficar no lugar
    seg = seg.replace(/\^FB(\d+)/, (_, w) => `^FB${Math.max(1, dir(Number(w)) - x)}`);
    seg = seg.replace(/\^GB(\d+),(\d+),(\d+)/, (_, w, h, t) => {
      const w2 = Number(w) <= 4 ? Number(w) : Math.max(1, dir(Number(w)) - x);
      return `^GB${w2},${h},${Math.min(Number(t), Math.max(w2, Number(h)))}`;
    });
    return seg;
  }).join('^FS');
}

// ---------- zona do destinatário, refeita em fluxo ----------
// Lê os textos e o QR da seção "RECEIVER ZONE" do ZPL do Mercado Livre.
function lerDestinatario(pagina) {
  const ini = pagina.search(/\^FX\s+RECEIVER ZONE/);
  if (ini < 0) return null;
  const secao = pagina.slice(ini);
  const qr = (secao.match(/\^BQ[^\^]*\^FD([\s\S]*?)\^FS/) || [])[1];
  const textos = [];
  const re = /\^FO\d+,\d+\^A0N,(\d+),\d+[^\n]*?\^FD([\s\S]*?)\^FS/g;
  let m;
  while ((m = re.exec(secao))) {
    if (/\^FR/.test(m[0])) continue; // caixa "R" em negativo
    textos.push({ fonte: Number(m[1]), bruto: m[2], txt: decodificarFH(m[2]).trim() });
  }
  // o ML repete o rótulo ("Endereço:") antes do texto completo: fica só o completo
  const unicos = textos.filter((t, i) => t.txt && !textos.some((o, j) => j !== i && (o.txt.length > t.txt.length ? o.txt.startsWith(t.txt) : o.txt === t.txt && j < i)));
  const letra = (secao.match(/\^FR\^FD([A-Z0-9]{1,3})\^FS/) || [])[1] || '';
  return { topo: pagina.slice(0, ini) + '^XZ', textos: unicos, qr, letra };
}

// ---------- imagem ----------
async function renderizar(zpl, larg, alt) {
  const b64 = await zplToBase64Async(zpl, larg / 8, alt / 8, 8);
  const png = PNG.sync.read(Buffer.from(b64, 'base64'));
  const bits = new Uint8Array(png.width * png.height);
  for (let i = 0; i < bits.length; i++) {
    const p = i * 4;
    const lum = (png.data[p] * 299 + png.data[p + 1] * 587 + png.data[p + 2] * 114) / 1000;
    bits[i] = png.data[p + 3] > 127 && lum < 128 ? 1 : 0;
  }
  return { l: png.width, a: png.height, bits };
}

// Acha o deslocamento (0..2) que deixa as barras do código alinhadas de 3 em 3 pontos,
// para que a redução a 2/3 transforme cada módulo de 3 pontos em exatamente 2.
function alinhamentoBarras(img) {
  const pontos = [0, 0, 0];
  for (let y = 240; y < 380 && y < img.a; y += 10) {
    for (let x = 1; x < img.l; x++) {
      if (img.bits[y * img.l + x] !== img.bits[y * img.l + x - 1]) pontos[x % 3]++;
    }
  }
  return pontos.indexOf(Math.max(...pontos));
}

// Reduz a 2/3 por média de área (cada ponto de saída cobre 1,5 x 1,5 pontos de origem)
function reduzirDoisTercos(img, desloc) {
  const l = Math.floor(((img.l - desloc) * 2) / 3);
  const a = Math.floor((img.a * 2) / 3);
  const bits = new Uint8Array(l * a);
  const amostra = (i) => (i % 2 === 0 ? [[(i / 2) * 3, 1], [(i / 2) * 3 + 1, 0.5]] : [[((i - 1) / 2) * 3 + 1, 0.5], [((i - 1) / 2) * 3 + 2, 1]]);
  for (let y = 0; y < a; y++) {
    const ys = amostra(y);
    for (let x = 0; x < l; x++) {
      let soma = 0;
      for (const [sy, wy] of ys) {
        if (sy >= img.a) continue;
        for (const [sx0, wx] of amostra(x)) {
          const sx = sx0 + desloc;
          if (sx < img.l && img.bits[sy * img.l + sx]) soma += wy * wx;
        }
      }
      bits[y * l + x] = soma / 2.25 >= 0.34 ? 1 : 0;
    }
  }
  return { l, a, bits };
}

function colar(dest, orig, x0, y0, maxL, maxA) {
  for (let y = 0; y < orig.a && y < maxA; y++) {
    for (let x = 0; x < orig.l && x < maxL; x++) {
      if (orig.bits[y * orig.l + x]) dest.bits[(y + y0) * dest.l + x + x0] = 1;
    }
  }
}

function paraPng(img) {
  const png = new PNG({ width: img.l, height: img.a });
  for (let i = 0; i < img.bits.length; i++) {
    const v = img.bits[i] ? 0 : 255;
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

// Desloca a imagem (em pontos); o que sai da etiqueta é cortado.
function deslocar(img, dx, dy) {
  if (!dx && !dy) return img;
  const bits = new Uint8Array(img.l * img.a);
  for (let y = 0; y < img.a; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= img.a) continue;
    for (let x = 0; x < img.l; x++) {
      const nx = x + dx;
      if (nx >= 0 && nx < img.l && img.bits[y * img.l + x]) bits[ny * img.l + nx] = 1;
    }
  }
  return { l: img.l, a: img.a, bits };
}

// Comando TSPL (bit 0 = ponto preto). Cabeçalho igual ao do driver oficial (rastertodlabel).
// calib: deslocXmm, deslocYmm, densidade, velocidade, gapMm, offsetMm,
//        faixaLinhas (0 = imagem inteira num comando; N = fatias de N linhas), crlfInicial
// A impressora perde o começo de cada trabalho (primeiro pacote USB). Linhas vazias na frente
// garantem que o que se perde é enchimento, e não o comando SIZE.
const PREAMBULO = '\r\n'.repeat(1024);
function paraTspl(img0, calib = {}, copias = 1) {
  const c = { deslocXmm: 0, deslocYmm: 0, densidade: 6, velocidade: 8, gapMm: 2, offsetMm: 2, faixaLinhas: 0, crlfInicial: true, ...calib };
  const img = deslocar(img0, Math.round(c.deslocXmm * 8), Math.round(c.deslocYmm * 8));
  const lb = Math.ceil(img.l / 8);
  const alt = Math.min(img.a, LINHAS_MAX);
  const dados = Buffer.alloc(lb * alt, 0xff);
  for (let y = 0; y < alt; y++) {
    for (let x = 0; x < img.l; x++) {
      if (img.bits[y * img.l + x]) dados[y * lb + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  const partes = [Buffer.from(
    `${c.crlfInicial ? PREAMBULO : ''}SIZE 100 mm,150 mm\r\nREFERENCE 0 ,0 \r\nDIRECTION 0\r\nGAP ${c.gapMm} mm,0 mm\r\nOFFSET ${c.offsetMm} mm\r\nDENSITY ${c.densidade}\r\nSPEED ${c.velocidade}\r\nCLS\r\n`, 'latin1')];
  const passo = c.faixaLinhas > 0 ? c.faixaLinhas : alt;
  for (let y = 0; y < alt; y += passo) {
    const n = Math.min(passo, alt - y);
    partes.push(Buffer.from(`BITMAP 0,${y},${lb},${n},1,`, 'latin1'), dados.subarray(y * lb, (y + n) * lb), Buffer.from('\r\n', 'latin1'));
  }
  partes.push(Buffer.from(`PRINT 1,${copias}\r\n`, 'latin1'));
  return Buffer.concat(partes);
}

// Versão compacta do mesmo comando: manda só as faixas que têm tinta, recortadas na largura.
// A imagem impressa é idêntica; o volume cai bastante, o que importa no Bluetooth de baixo consumo.
function paraTsplCompacto(img0, calib = {}, copias = 1) {
  const c = { deslocXmm: 0, deslocYmm: 0, densidade: 6, velocidade: 8, gapMm: 2, offsetMm: 2, ...calib };
  const img = deslocar(img0, Math.round(c.deslocXmm * 8), Math.round(c.deslocYmm * 8));
  const lb = Math.ceil(img.l / 8);
  const alt = Math.min(img.a, LINHAS_MAX);
  const partes = [Buffer.from(`\r\n\r\nSIZE 100 mm,150 mm\r\nREFERENCE 0 ,0 \r\nDIRECTION 0\r\nGAP ${c.gapMm} mm,0 mm\r\nOFFSET ${c.offsetMm} mm\r\nDENSITY ${c.densidade}\r\nSPEED ${c.velocidade}\r\nCLS\r\n`, 'latin1')];
  const FAIXA = 16;
  for (let y = 0; y < alt; y += FAIXA) {
    const n = Math.min(FAIXA, alt - y);
    let b0 = lb, b1 = -1;
    const linhas = [];
    for (let yy = y; yy < y + n; yy++) {
      const linha = Buffer.alloc(lb, 0xff);
      for (let x = 0; x < img.l; x++) {
        if (img.bits[yy * img.l + x]) { linha[x >> 3] &= ~(0x80 >> (x & 7)); if ((x >> 3) < b0) b0 = x >> 3; if ((x >> 3) > b1) b1 = x >> 3; }
      }
      linhas.push(linha);
    }
    if (b1 < 0) continue; // faixa toda em branco
    partes.push(Buffer.from(`BITMAP ${b0 * 8},${y},${b1 - b0 + 1},${n},1,`, 'latin1'), ...linhas.map((l) => l.subarray(b0, b1 + 1)), Buffer.from('\r\n', 'latin1'));
  }
  partes.push(Buffer.from(`PRINT 1,${copias}\r\n`, 'latin1'));
  return Buffer.concat(partes);
}

// Etiqueta de régua: moldura na borda, linhas a cada 10 mm e marcas de canto.
// Serve para ver no papel onde a impressão começa e o que está sendo cortado.
async function etiquetaRegua() {
  const z = ['^XA', '^CI28', '^PW800', '^LL1200', '^LH0,0', '^FO0,0^GB800,1198,3^FS'];
  for (let mm = 10; mm < 150; mm += 10) {
    const y = mm * 8;
    z.push(`^FO0,${y}^GB800,${mm % 50 === 0 ? 3 : 1},${mm % 50 === 0 ? 3 : 1}^FS`);
    z.push(`^FO12,${y + 6}^A0N,22,22^FD${mm} mm do topo^FS`);
    z.push(`^FO640,${y + 6}^A0N,22,22^FD${mm} mm^FS`);
  }
  for (let mm = 10; mm < 100; mm += 10) {
    const x = mm * 8;
    z.push(`^FO${x},0^GB1,60,1^FS`, `^FO${x + 4},34^A0N,20,20^FD${mm}^FS`);
    z.push(`^FO${x},1138^GB1,60,1^FS`);
  }
  z.push('^FO250,8^A0N,24,24^FDTOPO  |  largura em mm^FS');
  z.push('^FO200,600^GB400,60,60^FS', '^FO200,614^A0N,36,36^FB400,1,0,C^FR^FDCENTRO 50 x 75^FS');
  z.push('^FO250,1150^A0N,30,30^FDFIM DA ETIQUETA 150 mm^FS', '^XZ');
  return renderizar(z.join('\n'), L, A);
}

// ---------- montagem ----------
const linhaTemPreto = (img, y) => { const o = y * img.l; for (let x = 0; x < img.l; x++) if (img.bits[o + x]) return true; return false; };
function ultimaLinha(img) { for (let y = img.a - 1; y >= 0; y--) if (linhaTemPreto(img, y)) return y; return -1; }
function recortar(img, altura) { return { l: img.l, a: altura, bits: img.bits.slice(0, img.l * altura) }; }
function limites(img) { // caixa que contém o preto
  let x0 = img.l, x1 = -1, y1 = ultimaLinha(img);
  for (let y = 0; y <= y1; y++) for (let x = 0; x < img.l; x++) if (img.bits[y * img.l + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  return { x0, x1, y1 };
}
// Empilha imagens de mesma largura com um espaço entre elas
function empilhar(imgs, espaco) {
  const a = imgs.reduce((t, i) => t + i.a + espaco, 0);
  const out = { l: L, a, bits: new Uint8Array(L * a) };
  let y = 0;
  for (const i of imgs) { colar(out, i, 0, y, L, i.a); y += i.a + espaco; }
  return out;
}
// Encolhe as faixas em branco maiores que "maximo" linhas
function apertar(img, maximo) {
  const linhas = [];
  let brancas = 0, comecou = false; // a margem de cima (antes do primeiro preto) não é apertada
  for (let y = 0; y < img.a; y++) {
    if (linhaTemPreto(img, y)) { brancas = 0; comecou = true; linhas.push(y); } else if (!comecou || ++brancas <= maximo) linhas.push(y);
  }
  const out = { l: img.l, a: linhas.length, bits: new Uint8Array(img.l * linhas.length) };
  linhas.forEach((y, i) => out.bits.set(img.bits.subarray(y * img.l, (y + 1) * img.l), i * img.l));
  return out;
}
// Tira o branco que sobra em cima, deixando exatamente a margem de segurança
function ancorarTopo(img) {
  let y0 = 0;
  while (y0 < img.a && !linhaTemPreto(img, y0)) y0++;
  const corte = Math.max(0, y0 - MY);
  return { l: img.l, a: img.a - corte, bits: img.bits.slice(corte * img.l) };
}
const bloco = (corpo, alt = 420) => renderizar(`^XA^CI28^PW800^LH0,0\n${corpo}\n^XZ`, L, alt);

// Texto em negativo dentro de caixa preta (canal "21", "XSP10"): a letra do renderizador é mais
// larga que a da Zebra e o número encostava na borda. Aqui o texto é medido e, se preciso,
// estreitado para caber com folga, e fica centralizado na caixa nas duas direções.
async function ajustarCaixas(zpl) {
  const re = /\^FO(\d+),(\d+)\^GB(\d+),(\d+),(\d+)\^FS(\s*(?:\^FX[^\n]*\n\s*)?)\^FO(\d+),(\d+)\^A0N,(\d+),(\d+)\^FB(\d+),1,0,C\^FR((?:\^FH)?)\^FD([^\^]*)\^FS/g;
  const trocas = [];
  let m;
  while ((m = re.exec(zpl))) {
    const [tudo, bx, by, bw, bh, bt, meio, , , fh, fw, , h, txt] = m;
    if (Number(bt) < Math.min(Number(bw), Number(bh)) / 2) continue; // só caixa cheia
    // folga mínima: 12% da largura de cada lado e a tinta ocupa no máximo 68% da altura da caixa
    const folga = Math.max(8, Math.round(Number(bw) * 0.12));
    const medir = async (fa, fl) => {
      const img = await bloco(`^FO20,20^A0N,${fa},${fl}${h}^FD${txt}^FS`, 300);
      const lim = limites(img);
      let y0 = 0; while (y0 < img.a && !linhaTemPreto(img, y0)) y0++;
      return { larg: lim.x1 - lim.x0 + 1, alt: lim.y1 - y0 + 1, y0 };
    };
    let fa = Number(fh), fl = Number(fw);
    let md = await medir(fa, fl);
    const fator = Math.min(1, (Number(bw) - 2 * folga) / md.larg, (Number(bh) * 0.68) / md.alt);
    if (fator < 1) {
      fa = Math.max(10, Math.floor(fa * fator)); fl = Math.max(10, Math.floor(fl * fator));
      md = await medir(fa, fl);
    }
    const ty = Number(by) + Math.round((Number(bh) - md.alt) / 2) - (md.y0 - 20);
    trocas.push([tudo, `^FO${bx},${by}^GB${bw},${bh},${bt}^FS${meio}^FO${bx},${ty}^A0N,${fa},${fl}^FB${bw},1,0,C^FR${h}^FD${txt}^FS`]);
  }
  for (const [de, para] of trocas) zpl = zpl.replace(de, para);
  return zpl;
}

// Layout conjunto no modelo do Mercado Livre, com blocos fixos:
//   TOPO   (fixo em cima)  : etiqueta de envio original, dentro das margens
//   MEIO   (flexível)      : destinatário; se o texto crescer, a letra diminui até caber
//   RODAPÉ (fixo embaixo)  : faixa fiscal (DACE/DANFE) com a chave em código de barras
// Nada passa das margens e nenhum bloco invade o outro.
const FONTE_MIN = 20;      // 2,5 mm: menor letra aceita no destinatário
const ESPACO_TOPO = 18;    // espaço em branco máximo entre as partes do topo

async function zonaDestinatario(d, reducao) {
  const fonte = (f) => Math.max(FONTE_MIN, f - reducao);
  // QR e letra encostados na margem direita
  const qr0 = await bloco(`^FO500,2^BQN,2,6^FD${d.qr}^FS`);
  const l0 = limites(qr0);
  const qx = 500 + (L - MX - 1 - l0.x1);
  const lq = { x0: l0.x0 + qx - 500, larg: l0.x1 - l0.x0 + 1, y1: l0.y1 };
  const dir = await bloco(`^FO${qx},2^BQN,2,6^FD${d.qr}^FS` + (d.letra
    ? `\n^FO${lq.x0},${lq.y1 + 12}^GB${lq.larg},36,36^FS\n^FO${lq.x0},${lq.y1 + 16}^A0N,34,34^FB${lq.larg},1,0,C^FR^FD${d.letra}^FS` : ''));
  const largEsq = lq.x0 - 24 - MX; // coluna de texto: da margem até o QR, com respiro
  const colEsq = [], largos = [];
  for (const t of d.textos) {
    const comp = /^Complemento/i.test(t.txt);
    const f = fonte(t.fonte);
    const img = await bloco(`^FO${MX},2^A0N,${f},${f}^FB${comp ? UTIL : largEsq},8,0,L^FH^FD${t.bruto}^FS`);
    (comp ? largos : colEsq).push(recortar(img, ultimaLinha(img) + 1));
  }
  const esq = empilhar(colEsq, 12);
  const altDir = ultimaLinha(dir) + 1;
  const alt = Math.max(esq.a, altDir);
  const lado = { l: L, a: alt, bits: new Uint8Array(L * alt) };
  colar(lado, esq, 0, 0, L, esq.a); colar(lado, dir, 0, 0, L, altDir);
  const tudo = empilhar([lado, ...largos], 12);
  return recortar(tudo, ultimaLinha(tudo) + 1);
}

async function montarConjunta(pagEnvio, fiscal) {
  const d = lerDestinatario(pagEnvio);
  if (!d || !d.qr) return null;
  const topo0 = ancorarTopo(await renderizar(ajustarMargens(await ajustarCaixas(d.topo)), L, ENVIO_A));
  const fx0 = await bloco(zplFaixaFiscal(fiscal), 260);
  const faixa = recortar(fx0, ultimaLinha(fx0) + 1);
  const yFaixa = LINHAS_MAX - MY - faixa.a;
  // tenta primeiro com a letra original; se não couber, aperta os espaços em branco do topo
  // e só então diminui a letra do destinatário
  for (let reducao = 0; reducao <= 6; reducao += 2) {
    const zona = await zonaDestinatario(d, reducao);
    for (const aperto of [ESPACO_TOPO, 12, 8]) {
      const topo = apertar(recortar(topo0, ultimaLinha(topo0) + 1), aperto);
      const sobra = yFaixa - 10 - (topo.a + 10) - zona.a;
      if (sobra < 0) continue;
      const folha = { l: L, a: A, bits: new Uint8Array(L * A) };
      colar(folha, topo, 0, 0, L, topo.a);
      colar(folha, zona, 0, topo.a + 10 + Math.floor(sobra / 2), L, zona.a); // centralizado no espaço do meio
      colar(folha, faixa, 0, yFaixa, L, faixa.a);
      return folha;
    }
  }
  return null; // não coube nem com a menor letra: quem chamou imprime separado
}

// Encaixa uma etiqueta que já vem como imagem (816 x 1218 na Shopee) na área de 800 x 1198,
// sem redimensionar (para não estragar os códigos de barras): centraliza e corta só as sobras das bordas.
async function encaixarImagem(pagina) {
  const larg = Number((pagina.match(/~DG[^,]*,\d+,(\d+),/) || [])[1] || 102) * 8;
  const total = Number((pagina.match(/~DG[^,]*,(\d+),\d+,/) || [])[1] || 0);
  const alt = total && larg ? Math.ceil(total / (larg / 8)) : ENVIO_A;
  const img = await renderizar(pagina, larg, alt);
  const lim = limites(img);
  let y0 = 0; while (y0 < img.a && !linhaTemPreto(img, y0)) y0++;
  const altTinta = lim.y1 - y0 + 1, largTinta = lim.x1 - lim.x0 + 1;
  // horizontal: centraliza a tinta; vertical: começa na margem de cima, ou centraliza se for justo
  const dx = Math.round((L - largTinta) / 2) - lim.x0;
  const dy = (altTinta <= LINHAS_MAX - 2 * MY ? MY : Math.round((LINHAS_MAX - altTinta) / 2)) - y0;
  const folha = { l: L, a: A, bits: new Uint8Array(L * A) };
  for (let y = y0; y <= lim.y1; y++) {
    const ny = y + dy; if (ny < 0 || ny >= LINHAS_MAX) continue;
    for (let x = lim.x0; x <= lim.x1; x++) {
      const nx = x + dx; if (nx < 0 || nx >= L) continue;
      if (img.bits[y * img.l + x]) folha.bits[ny * L + nx] = 1;
    }
  }
  return folha;
}

// Recebe o ZPL completo de UM envio (1 ou 2 páginas) e devolve as etiquetas 10x15 prontas.
// modo 'junto'  : envio + faixa fiscal na mesma etiqueta, no modelo do Mercado Livre (padrão)
// modo 'cheio'  : cada página numa etiqueta inteira
async function montar(zpl, modo = 'junto') {
  const paginas = separarPaginas(zpl);
  if (!paginas.length) throw new Error('Nenhuma etiqueta ZPL (^XA...^XZ) encontrada');
  if (ehImagemPronta(paginas[0])) {
    // Shopee: a etiqueta já vem como imagem completa, com a DACE resumida no rodapé
    const saidaImg = [];
    for (const p of paginas) saidaImg.push({ id: 'Shopee ' + require('crypto').createHash('sha1').update(p).digest('hex').slice(0, 6), tipo: 'envio + DACE (Shopee)', img: await encaixarImagem(p) });
    return saidaImg;
  }
  const id = (paginas[0].match(/"id":"(\d+)"/) || [])[1] || '';
  const fiscal = paginas[1] ? lerFiscal(paginas[1]) : null;
  if (modo === 'junto' && fiscal) {
    const folha = await montarConjunta(paginas[0], fiscal);
    if (folha) {
      const saida = [{ id, tipo: `envio + ${fiscal.titulo.split(' ')[0]}`, img: folha }];
      for (const extra of paginas.slice(2)) saida.push({ id, tipo: 'extra', img: await renderizar(extra, L, A) });
      return saida;
    }
  }
  const saida = [];
  for (const [i, p] of paginas.entries()) {
    // a página fiscal original já tem moldura própria até a borda: entra sem margem extra em cima
    const img0 = i === 0 ? ancorarTopo(await renderizar(ajustarMargens(await ajustarCaixas(p)), L, ENVIO_A)) : await renderizar(ajustarMargens(p, 0), L, ENVIO_A);
    // a página original do ML passa de 150 mm: aperta os espaços em branco até caber com margem
    let img = recortar(img0, ultimaLinha(img0) + 1);
    for (let g = 40; img.a > LINHAS_MAX - MY && g >= 4; g -= 2) img = apertar(recortar(img0, ultimaLinha(img0) + 1), g);
    const folha = { l: L, a: A, bits: new Uint8Array(L * A) };
    colar(folha, img, 0, 0, L, A);
    saida.push({ id, tipo: i === 0 ? 'envio' : 'fiscal', img: folha });
  }
  return saida;
}

// Separa um arquivo com vários envios (cada envio = etiqueta com QR "id" + página fiscal seguinte)
function separarEnvios(zpl) {
  const paginas = separarPaginas(zpl);
  const envios = [];
  for (const p of paginas) {
    if (/"id":"\d+"/.test(p) || ehImagemPronta(p) || !envios.length) envios.push(p);
    else envios[envios.length - 1] += p;
  }
  return envios;
}

module.exports = { montar, separarEnvios, separarPaginas, paraPng, paraTspl, paraTsplCompacto, lerFiscal, etiquetaRegua, PREAMBULO };
