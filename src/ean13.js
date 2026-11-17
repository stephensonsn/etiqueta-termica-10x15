// EAN-13: dígito verificador, validação, numeração interna e desenho das barras.
//
// Código interno: começa com "200" (faixa 20-29 da GS1, "circulação restrita"). Vale para bipar na
// própria loja; o Mercado Livre e a Shopee não aceitam, porque exigem um EAN registrado na GS1 Brasil.
// Formato: 200 + 9 dígitos sequenciais + dígito verificador = 13 dígitos.
'use strict';

const PREFIXO_INTERNO = '200';

function digito(doze) {
  const s = String(doze);
  if (!/^\d{12}$/.test(s)) throw new Error('o EAN-13 precisa de 12 dígitos antes do verificador');
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(s[i]) * (i % 2 ? 3 : 1);
  return String((10 - (soma % 10)) % 10);
}

const valido = (c) => /^\d{13}$/.test(String(c || '')) && digito(String(c).slice(0, 12)) === String(c)[12];
const interno = (c) => valido(c) && String(c).startsWith(PREFIXO_INTERNO);

// diz o que há de errado com um código (texto curto), ou '' se for um EAN-13 válido
function problema(c) {
  const s = String(c || '').trim();
  if (!s) return 'sem código';
  if (!/^\d+$/.test(s)) return 'não é EAN-13 (tem letras)';
  if (s.length !== 13) return `não é EAN-13 (${s.length} dígitos)`;
  const d = digito(s.slice(0, 12));
  if (d !== s[12]) return `dígito verificador errado (o certo é ${d})`;
  return '';
}

// próximo código interno livre, depois do maior que já existe
function proximoInterno(existentes) {
  let maior = 0;
  for (const c of existentes) if (interno(c)) maior = Math.max(maior, Number(String(c).slice(3, 12)));
  const doze = PREFIXO_INTERNO + String(maior + 1).padStart(9, '0');
  return doze + digito(doze);
}

// barras em módulos ('1' = preto), 95 módulos, para desenhar a prévia
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).reverse().join(''));
const R = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function modulos(codigo) {
  if (!valido(codigo)) throw new Error('EAN-13 inválido');
  const s = String(codigo), par = PARIDADE[Number(s[0])];
  let m = '101';
  for (let i = 1; i <= 6; i++) m += (par[i - 1] === 'L' ? L : G)[Number(s[i])];
  m += '01010';
  for (let i = 7; i <= 12; i++) m += R[Number(s[i])];
  return m + '101';
}

module.exports = { PREFIXO_INTERNO, digito, valido, interno, problema, proximoInterno, modulos };
