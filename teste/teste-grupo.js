// Teste em grupo (ponta a ponta, sem papel): ponte isolada imprimindo direto numa saída falsa.
//   1) lote do TikTok baixado em Downloads com 2 pacotes: endereço de um chega ANTES do arquivo,
//      o do outro chega DEPOIS (durante a espera); os dois saem reescritos e entram nos impressos;
//   2) etiqueta do Mercado Livre baixada em Downloads sai uma vez; a mesma de novo é ignorada;
//   3) reimprimir 1 e reimprimir as 3 em sequência pelo painel.
// Uso: npm run teste:grupo   (leva ~1 min por causa das esperas reais da vigia)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { zplToBase64Async } = require('zpl-renderer-js');
const { subir, RAIZ } = require('./ponte-teste');

const EXT = 'chrome-extension://gnlbmakkaeblkpldbimblkgjoldhnjkl';
const R1 = '3320100000011';
const R2 = '3320100000022';
// etiqueta iMile sintética (dados inventados), igual ao desenho real
const imile = (rastreio) => `^XA^CI28^PW800^LH0,0
^FO20,20^GB760,1160,3^FS
^FO60,60^A0N,60,60^FDiMile^FS
^FO60,200^BY3^BCN,120,N,N,N^FD${rastreio}^FS
^FO45,462^GB711,244,2^FS
^FO525,462^GB2,244,2^FS
^FO80,490^GB50,50,25^FS
^FO155,486^A0N,20,20^FDFulano de Tal^FS
^FO155,524^A0N,22,20^FDApto 12, Centro Rua Exemplo^FS
^FO155,550^A0N,22,20^FD100, Cidade Teste, Sao Paulo, 0^FS
^FO155,575^A0N,22,20^FD1310100^FS
^FO55,663^A0N,40,40^FDTikTok Shop 01310100^FS
^FO95,808^BY3^BCN,90,N,N,N^FD${rastreio}^FS
^XZ`;
// o TikTok manda a etiqueta como imagem (^GFA): desenha e converte para o mesmo formato
async function comoTikTok(zpl) {
  const png = PNG.sync.read(Buffer.from(await zplToBase64Async(zpl, 100, 150, 8), 'base64'));
  const porLinha = png.width / 8;
  let hex = '';
  for (let y = 0; y < png.height; y++) for (let b = 0; b < porLinha; b++) {
    let v = 0;
    for (let k = 0; k < 8; k++) { const i = (y * png.width + b * 8 + k) * 4; if (png.data[i + 3] > 127 && png.data[i] < 128) v |= 0x80 >> k; }
    hex += v.toString(16).padStart(2, '0').toUpperCase();
  }
  const total = porLinha * png.height;
  return `^XA^PW800^LL1200^FO0,0^GFA,${total},${total},${porLinha},${hex}^FS^XZ`;
}
const endereco = (rastreio, nome) => ({ rastreio, nome, nick: 'cliente', usuario: 'cliente123', rua: 'Rua Exemplo', numero: '100', complemento: 'Apto 12', bairro: 'Centro', cidade: 'Cidade Teste', uf: 'SP', cep: '01310100' });

(async () => {
  const p = await subir({ imprimir: 'direto', limparDownloads: true });
  const esperarLog = (re, ms = 60000) => p.esperar(async () => re.test(await p.log()), ms);
  try {
    // ---------- 1) TikTok: lote com 2 pacotes ----------
    await p.pedir('POST', '/api/tiktok/enderecos', { lista: [endereco(R1, 'FULANO DE TAL DA SILVA')] }, { origin: EXT });
    const lote = (await comoTikTok(imile(R1))) + '\n' + (await comoTikTok(imile(R2)));
    await new Promise((r) => setTimeout(r, 1500)); // a vigia ignora o que já existia na primeira volta
    fs.writeFileSync(path.join(p.downloads, '11-23_16-21-23_Shipping label.txt'), lote);
    await new Promise((r) => setTimeout(r, 6000));
    await p.pedir('POST', '/api/tiktok/enderecos', { lista: [endereco(R2, 'BELTRANA DE SOUZA')] }, { origin: EXT }); // chega depois do arquivo
    assert(await esperarLog(new RegExp(`reescritos \\(rastreio ${R2}`), 60000), 'pacote 2 reescrito com o endereço que chegou depois:\n' + await p.log());
    assert(new RegExp(`reescritos \\(rastreio ${R1}`).test(await p.log()), 'pacote 1 reescrito');
    const imp = await p.esperar(async () => { const r = (await p.pedir('GET', '/api/tiktok/impressos', undefined, { origin: EXT })).json.rastreios; return r.includes(R1) && r.includes(R2) ? r : null; }, 30000);
    assert(imp, 'os 2 rastreios constam como impressos (a extensão não reimprime)');
    assert.equal(p.impressos().length, 2, 'uma etiqueta por pacote');
    assert(await p.esperar(async () => !fs.existsSync(path.join(p.downloads, '11-23_16-21-23_Shipping label.txt')), 10000), 'arquivo apagado depois de imprimir');

    // ---------- 2) Mercado Livre por Downloads; repetido ignorado ----------
    const ml = fs.readFileSync(path.join(RAIZ, 'exemplos', 'mercado-livre-exemplo.txt'), 'utf8');
    fs.writeFileSync(path.join(p.downloads, 'Etiqueta de envio.txt'), ml);
    assert(await p.esperar(async () => p.impressos().length > 2, 30000), 'etiqueta do ML impressa');
    await new Promise((r) => setTimeout(r, 1500));
    const depoisMl = p.impressos().length;
    fs.writeFileSync(path.join(p.downloads, 'Etiqueta de envio (1).txt'), ml); // baixou de novo
    assert(await esperarLog(/ignorad|já veio/, 20000), 'cópia repetida ignorada');
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(p.impressos().length, depoisMl, 'repetida não imprime de novo');

    // ---------- 3) reimprimir 1 e as 3 em sequência ----------
    const lista = (await p.estado()).pedidos.filter((x) => x.estado === 'impresso');
    assert(lista.length >= 3);
    const antes = p.impressos().length;
    assert.equal((await p.pedir('POST', `/api/pedido/${lista[0].jid}/imprimir`)).status, 200);
    assert.equal(p.impressos().length, antes + 1, 'reimprimir uma');
    const tres = lista.slice(0, 3).reverse().map((x) => x.jid);
    for (const jid of tres) assert.equal((await p.pedir('POST', `/api/pedido/${jid}/imprimir`)).status, 200);
    const novos = p.impressos().slice(antes + 1);
    assert.deepEqual(novos.map((n) => n.split('-').slice(1, 3).join('-')), tres, 'as 3 saem na ordem');

    console.log(`ok: grupo ponta a ponta (TikTok 2 pacotes com endereço antes e depois, ML uma vez, repetido ignorado, reimprimir 1 e 3) — ${p.impressos().length} etiquetas na saída falsa`);
  } finally { p.parar(); }
  process.exit(0);
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
