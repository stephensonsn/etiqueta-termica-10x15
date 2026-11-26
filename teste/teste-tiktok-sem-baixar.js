// TikTok sem baixar (25/11/2026): a extensão lê os arquivos da janela "Imprimir resultado" direto da
// página e manda à ponte por /api/tiktok/arquivos. Confere: etiqueta + NF-e do mesmo lote saem como uma
// etiqueta só, nada cai em Downloads, só a extensão pode mandar e conteúdo sem ZPL é recusado.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { subir, RAIZ } = require('./ponte-teste');

const EXT = 'chrome-extension://gnlbmakkaeblkpldbimblkgjoldhnjkl';
const etiqueta = fs.readFileSync(path.join(RAIZ, 'exemplos', 'mercado-livre-exemplo.txt'), 'utf8');
const nfe = '^XA^PW800^LL1200^FO40,40^GB720,900,120^FS^FO50,50^A0N,40,40^FDDANFE SIMPLIFICADO TESTE^FS^XZ';

(async () => {
  const p = await subir({ imprimir: 'direto' });
  try {
    const arquivos = [{ nome: '11-25_22-59-38_NF-e.txt', conteudo: nfe }, { nome: '11-25_22-59-38_Shipping label.txt', conteudo: etiqueta }];
    const r = await p.pedir('POST', '/api/tiktok/arquivos', { arquivos }, { origin: EXT });
    assert.equal(r.status, 200, r.txt);
    assert.equal(r.json.arquivos, 2);
    assert(await p.esperar(async () => p.impressos().length >= 1, 30000), 'etiqueta impressa:\n' + await p.log());
    await new Promise((ok) => setTimeout(ok, 1500));
    assert.equal(p.impressos().length, 1, 'NF-e do mesmo lote vai junto, não sai separada');
    assert(/TikTok \(sem baixar\): 11-25_22-59-38_Shipping label\.txt \+ 11-25_22-59-38_NF-e\.txt/.test(await p.log()), 'casou a NF-e com a etiqueta');
    assert.deepEqual(fs.readdirSync(p.downloads), [], 'nada em Downloads');

    // mesmo envio de novo em seguida (clique duplo): a trava de repetido segura
    await p.pedir('POST', '/api/tiktok/arquivos', { arquivos }, { origin: EXT });
    await new Promise((ok) => setTimeout(ok, 2000));
    assert.equal(p.impressos().length, 1, 'repetido não imprime de novo');

    // NF-e sozinha (sem etiqueta no lote) sai sozinha
    await p.pedir('POST', '/api/tiktok/arquivos', { arquivos: [{ nome: '11-25_23-10-00_NF-e.txt', conteudo: nfe.replace('TESTE', 'OUTRA') }] }, { origin: EXT });
    assert(await p.esperar(async () => p.impressos().length === 2, 30000), 'NF-e sozinha imprime:\n' + await p.log() + '\n' + p.impressos());

    // site qualquer não pode mandar; conteúdo sem ZPL é recusado
    assert.equal((await p.pedir('POST', '/api/tiktok/arquivos', { arquivos }, { origin: 'https://exemplo.com' })).status, 403);
    assert.equal((await p.pedir('POST', '/api/tiktok/arquivos', { arquivos: [{ nome: 'x_NF-e.txt', conteudo: 'texto comum' }] }, { origin: EXT })).status, 400);
  } finally { p.parar(); }
  console.log('ok: TikTok sem baixar (etiqueta + NF-e numa só, nada em Downloads, repetido barrado, só a extensão)');
  process.exit(0);
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
