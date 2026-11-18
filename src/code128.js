// Leitor de código de barras Code 128 a partir da imagem já desenhada (bits 1 = preto).
// Usado para ler a chave da NF-e que vem só como imagem nas páginas do TikTok Shop.
// Sem bibliotecas: mede as larguras das barras numa linha e confere o dígito de controle.
'use strict';

// larguras (barra, espaço, barra, ...) dos 107 símbolos; 103-105 = início A/B/C, 106 = fim
const PADROES = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
  '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 ' +
  '131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 ' +
  '213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
  '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 ' +
  '421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112').split(' ');
const INDICE = new Map(PADROES.map((p, i) => [p, i]));
// chave por distâncias de borda a borda (barra+espaço, espaço+barra): não muda quando a barra
// "engorda" na impressão térmica. Símbolos com a mesma chave são separados pela soma das barras.
const PORBORDA = new Map();
PADROES.slice(0, 106).forEach((p, i) => {
  const d = [...p].map(Number);
  const k = [0, 1, 2, 3].map((j) => d[j] + d[j + 1]).join('');
  if (!PORBORDA.has(k)) PORBORDA.set(k, []);
  PORBORDA.get(k).push({ i, barras: d[0] + d[2] + d[4] });
});
function porBorda(ws) {
  const T = ws.reduce((a, b) => a + b, 0), m = T / 11;
  const k = [0, 1, 2, 3].map((j) => Math.round((ws[j] + ws[j + 1]) / m)).join('');
  const cands = PORBORDA.get(k);
  if (!cands) return undefined;
  if (cands.length === 1) return cands[0].i;
  const b = (ws[0] + ws[2] + ws[4]) / m;
  return cands.reduce((x, y) => (Math.abs(y.barras - b) < Math.abs(x.barras - b) ? y : x)).i;
}

// decodifica uma sequência de larguras (começando numa barra preta). Devolve o texto ou null.
function decodificarLarguras(w) {
  if (w.length < 6 * 3 + 7) return null;
  const k = (w.length - 7) / 6; // símbolos antes do fim (início + dados + controle)
  if (!Number.isInteger(k)) return null;
  // cada símbolo tem 11 módulos (o fim, 13): normaliza símbolo a símbolo e distribui o arredondamento
  // pelo maior resto, para barras de largura ímpar (impressão escalada) não quebrarem a leitura
  const normalizar = (ws, modulos) => {
    const soma = ws.reduce((a, b) => a + b, 0), m = soma / modulos;
    const simples = ws.map((v) => Math.max(1, Math.min(4, Math.round(v / m))));
    if (simples.reduce((a, b) => a + b, 0) === modulos) return simples.join('');
    const brutos = ws.map((v) => v / m), int = brutos.map((v) => Math.max(1, Math.floor(v)));
    let falta = modulos - int.reduce((a, b) => a + b, 0);
    const ordem = brutos.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
    for (let j = 0; falta > 0 && j < ordem.length; j++, falta--) int[ordem[j][1]]++;
    return int.map((v) => Math.min(4, v)).join('');
  };
  const simbolos = [];
  for (let s = 0; s <= k; s++) {
    const n = s < k ? 6 : 7;
    const ws = w.slice(s * 6, s * 6 + n);
    let i = INDICE.get(normalizar(ws, n === 6 ? 11 : 13));
    if (i === undefined && n === 6) i = porBorda(ws);
    if (i === undefined) return null;
    simbolos.push(i);
  }
  if (simbolos.pop() !== 106) return null;
  const inicio = simbolos[0];
  if (inicio < 103 || inicio > 105) return null;
  const controle = simbolos.pop();
  let soma = inicio;
  for (let i = 1; i < simbolos.length; i++) soma += simbolos[i] * i;
  if (soma % 103 !== controle) return null;
  let modo = inicio === 103 ? 'A' : inicio === 104 ? 'B' : 'C', txt = '';
  for (const c of simbolos.slice(1)) {
    if (modo === 'C') {
      if (c < 100) txt += String(c).padStart(2, '0');
      else if (c === 100) modo = 'B'; else if (c === 101) modo = 'A';
    } else if (c === 99) modo = 'C';
    else if (c === 100 && modo === 'A') modo = 'B';
    else if (c === 101 && modo === 'B') modo = 'A';
    else if (c < 96) txt += modo === 'B' ? String.fromCharCode(c + 32) : String.fromCharCode(c < 64 ? c + 32 : c - 64);
  }
  return txt;
}

// Acha todos os códigos Code 128 da imagem: varre as linhas, separa trechos de barras e
// decodifica; cada código é devolvido uma vez, com a faixa de linhas onde aparece.
function lerCodigos(img) {
  const achados = new Map();
  for (let y = 0; y < img.a; y += 2) {
    const base = y * img.l;
    const runs = []; // [cor, largura, xInicio]
    let cor = img.bits[base], ini = 0;
    for (let x = 1; x <= img.l; x++) {
      const c = x < img.l ? img.bits[base + x] : -1;
      if (c !== cor) { runs.push([cor, x - ini, ini]); cor = c; ini = x; }
    }
    // trechos: sequência de barras com espaços pequenos (zona livre larga separa códigos)
    let trecho = [];
    const fechar = () => {
      while (trecho.length && trecho[0][0] !== 1) trecho.shift();
      while (trecho.length && trecho[trecho.length - 1][0] !== 1) trecho.pop();
      if (trecho.length >= 25) {
        const txt = decodificarLarguras(trecho.map((r) => r[1]));
        if (txt) {
          const a = achados.get(txt);
          const x0 = trecho[0][2], x1 = trecho[trecho.length - 1][2] + trecho[trecho.length - 1][1];
          if (a) { a.y1 = y; } else achados.set(txt, { texto: txt, y0: y, y1: y, x0, x1 });
        }
      }
      trecho = [];
    };
    for (const r of runs) {
      if (r[0] === 0 && r[1] > 40) fechar(); else trecho.push(r);
    }
    fechar();
  }
  return [...achados.values()];
}

module.exports = { lerCodigos, decodificarLarguras };
