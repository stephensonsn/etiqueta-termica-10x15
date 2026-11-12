// Gera exemplos/shopee-exemplo.txt: uma etiqueta FICTÍCIA no mesmo formato em que a Shopee entrega
// (a etiqueta inteira como imagem: "~DG<gráfico>" + "^XG"), para testar e documentar sem dados reais.
// Uso: node exemplos/gerar-exemplo-shopee.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PNG } = require('pngjs');
const { zplToBase64Async } = require('zpl-renderer-js');

const L = 816, A = 1218; // tamanho da imagem que a Shopee manda
// logotipo da Shopee como sai na etiqueta (marca registrada da Shopee; usado aqui só para mostrar o resultado real)
const LOGO = '^FO611,49^GFA,663,663,17,0000FF0000000000000000000000000000000F070000000000000000000000000000000F1F4000000000000000000000000000000E00E000000000000000000000000000001C00C000000000000000000000000000003000C000000000000000000000000000003001D000000000000000000000000000001000E000000000000000000000000000FFFFFFFFF4000000000000000000000000FFFFFFFFF4000000000000000000000000FFFFFFFFF0000000000000000000000000FFFFFFFFF0000000000000000000000000FFFFF7FFF003DE0D000000000000000000FFFFF7FFF801FE0C000000000000000000FFF418FFE4077387000000000000000000FFFE18FFE407FB8F000000000000000000FFF3FFFFF00F000F000000000000000000FFF0FFFFF007000D000000000000000000FFF1FFFFF007000D000000000000000000FFF8FFFFF003C00F70011C11C0007003107FF47FFFE00760071801841860021001847FFF1FFFE002FA0FFF07FE1FFF0FFC1FFE3FFF07FFF002FC0FFF07FE1FFE07FC1FFC3FFFE1FFF0000F8F839E00970F3C071C3C3FFFFFFFF00001CD03DE0194053FFF3FFEBFFFFEFFF00001CF03DE0194011FFF3FFE7FFFFE7FE00001C70258039C010C1039047FFFFEFFE00001CF02FA039C018E1839863FF3FEFFF00E01CF03DF879E1F0F0E18043FF0FAFFF007058D03CE02970F3C831E003FFC41FFF007FF0D03C7FC17FE0FFF0FFCBFFFFFFFF00082000000081480002000007FFF9FFFE00060060041841C60001001847FFFFFFFC00000000000001C00000000003FFFFFFFE00000000000001C00000000000FFFFFFF800000000000001400000000000FFFFFFF80000000000000140000000000000000000000000000000014000000000000000000000000000000001C0000000000^FS';
const t = (x, y, alt, txt, extra = '') => `^FO${x},${y}^A0N,${alt},${alt}${extra}^FH^FD${txt}^FS`;
const zpl = ['^XA', '^CI28', `^PW${L}`, `^LL${A}`, '^LH0,0',
  // destinatário
  ...Array.from({ length: 21 }, (_, i) => `^FO${236 + i * 28},36^GB16,3,3^FS`),
  '^FO0,36^GB226,40,40^FS', t(22, 44, 28, 'DESTINAT_C3_81RIO', '^FR'),
  t(40, 84, 32, 'Fulana de Tal Exemplo'),
  t(40, 134, 24, 'Rua dos Testes, 123, Port_C3_A3o azul, Cidade', '^FB540,2,0,L'),
  t(40, 162, 24, 'Exemplo, S_C3_A3o Paulo'),
  t(40, 204, 26, 'Bairro:  Modelo'), t(40, 232, 26, 'CEP:  01000-001'), t(40, 260, 26, 'Pedido:  000000EXEMPLO'),
  LOGO,
  '^FO594,100^BQN,2,7^FDLA,PEDIDO-FICTICIO-000000EXEMPLO^FS',
  '^FO504,230^GB74,52,52^FS', t(504, 238, 44, 'R', '^FB74,1,0,C^FR'),
  '^FO0,284^GB816,3,3^FS',
  // roteamento
  '^FO84,300^BQN,2,9^FDLA,ROTA-FICTICIA-SP1-LSP01^FS',
  '^FO343,298^GB426,124,124^FS', t(343, 322, 86, 'SP1 -1', '^FB426,1,0,C^FR'),
  '^FO343,446^GB426,124,124^FS', t(343, 470, 86, 'LSP-01', '^FB426,1,0,C^FR'),
  t(40, 558, 30, 'Cidade Exemplo', '^FB320,1,0,C'), t(40, 624, 34, 'EXE-A-01', '^FB320,1,0,C'),
  t(343, 590, 84, 'EXE-A-01', '^FB426,1,0,C'),
  '^FO0,678^GB816,3,3^FS',
  // código de barras e remetente
  '^FO56,696^BY2,,0^BCN,104,N,N,N^FD>:BR000000000000X^FS', t(56, 808, 26, 'BR000000000000X', '^FB400,1,0,C'),
  '^FO584,748^GB190,50,3^FS', t(584, 753, 20, 'LEVAR PARA', '^FB190,1,0,C'), t(584, 774, 20, 'AG_C3_8ANCIA', '^FB190,1,0,C'),
  '^FO0,832^GB178,24,24^FS', t(36, 834, 22, 'REMETENTE', '^FR'),
  t(40, 862, 22, 'Loja Exemplo Ltda'), t(40, 908, 22, 'Avenida das Etiquetas, 100, Cidade Exemplo'),
  t(40, 956, 22, 'CEP:  01000000'), t(40, 982, 22, 'Envio previsto:  01/01/2026'),
  '^FO512,816^BQN,2,6^FDLA,REMETENTE-FICTICIO^FS',
  '^FO700,816^GB74,74,3^FS', t(700, 828, 22, 'SOC', '^FB74,1,0,C'), t(700, 852, 22, 'SP1', '^FB74,1,0,C'),
  '^FO0,1006^GB816,3,3^FS',
  // DACE resumida
  t(0, 1012, 22, 'DACE RESUMIDA - Declara_C3_A7_C3_A3o Auxiliar de Conte_C3_BAdo Eletr_C3_B4nica', '^FB816,1,0,C'),
  '^FO22,1042^BQN,2,3^FDLA,https://exemplo.invalid/dce?chDCe=00000000000000000000000000001234567800000000^FS',
  t(162, 1038, 17, 'N._C2_BA  12345678'), t(372, 1038, 17, 'S_C3_A9rie  1'), t(540, 1038, 17, 'Emiss_C3_A3o  01/01/2026 10:00:00'),
  t(162, 1058, 17, 'Protocolo de Autoriza_C3_A7_C3_A3o  0000000000000000'),
  t(162, 1078, 17, 'Modalidade de Transporte  1 - Transporte por conta pr_C3_B3pria'),
  t(162, 1098, 17, 'CNPJ Fisco/ Market./ Transp.  00.000.000/0001-00'),
  t(162, 1118, 17, 'Nome Fisco/ Market./ Transp.  TRANSPORTADORA'),
  t(162, 1138, 17, 'CPF Destinat_C3_A1rio  11111111111'), t(470, 1138, 17, 'CPF/CNPJ Remetente  00000000000'),
  t(162, 1158, 17, 'Chave de Acesso DC-e  00000000000000000000000000001234567800000000'),
  '^XZ'].join('\n');

// CRC-16 CCITT (o que o ZPL usa no formato :Z64:)
function crc16(buf) {
  let c = 0;
  for (const b of buf) { c ^= b << 8; for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; }
  return c.toString(16).padStart(4, '0');
}

(async () => {
  const png = PNG.sync.read(Buffer.from(await zplToBase64Async(zpl, L / 8, A / 8, 8), 'base64'));
  const bpl = L / 8;
  const bits = Buffer.alloc(bpl * A, 0);
  for (let y = 0; y < A && y < png.height; y++) {
    for (let x = 0; x < L && x < png.width; x++) {
      const p = (y * png.width + x) * 4;
      if (png.data[p + 3] > 127 && png.data[p] < 128) bits[y * bpl + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const b64 = zlib.deflateSync(bits, { level: 9 }).toString('base64');
  const saida = `~DGR:DEMO.GRF,${bits.length},${bpl},:Z64:${b64}:${crc16(Buffer.from(b64, 'ascii'))}^XA^MMT,Y^PON^MNY^FO0,0^XGR:DEMO.GRF,1,1^FS^PQ1,0,0,N^XZ^XA^IDR:DEMO.GRF^FS^XZ\n`;
  fs.writeFileSync(path.join(__dirname, 'shopee-exemplo.txt'), saida);
  console.log(`exemplos/shopee-exemplo.txt gerado (${saida.length} caracteres)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
