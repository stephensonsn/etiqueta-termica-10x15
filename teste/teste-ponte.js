// Ponte (servidor + fila) numa pasta temporária, sem impressora: rotas, acesso, trava de envio
// repetido, imprimir uma, reimprimir uma e reimprimir várias em sequência.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { subir, RAIZ } = require('./ponte-teste');

const ML = fs.readFileSync(path.join(RAIZ, 'exemplos', 'mercado-livre-exemplo.txt'), 'utf8');
const SHOPEE = fs.readFileSync(path.join(RAIZ, 'exemplos', 'shopee-exemplo.txt'), 'utf8');
const EXT = 'chrome-extension://gnlbmakkaeblkpldbimblkgjoldhnjkl';

(async () => {
  const p = await subir();
  try {
    // ---------- rotas e acesso ----------
    assert.equal((await p.pedir('GET', '/saude')).txt, 'ok');
    const est = await p.estado();
    assert(est && est.config && Array.isArray(est.pedidos), '/api/estado responde');
    assert.equal((await p.pedir('GET', '/painel')).status, 200);
    assert.equal((await p.pedir('GET', '/api/estado', undefined, { origin: 'https://site-qualquer.com' })).status, 403, 'site de fora não lê o painel');
    assert.equal((await p.pedir('GET', '/api/estado', undefined, { origin: EXT })).status, 403, 'extensão não lê o painel inteiro');
    assert.equal((await p.pedir('GET', '/api/tiktok/impressos', undefined, { origin: EXT })).status, 200, 'extensão confere os impressos');
    // endereço: CEP inválido não entra; válido entra
    let r = await p.pedir('POST', '/api/tiktok/enderecos', { lista: [{ rastreio: '3320100000009', rua: 'Rua X', cidade: 'Y', cep: '123' }] }, { origin: EXT });
    assert.equal(r.json.recebidos, 0);
    r = await p.pedir('POST', '/api/tiktok/enderecos', { lista: [{ rastreio: '3320100000009', nome: 'FULANO', rua: 'Rua X', numero: '1', cidade: 'Y', uf: 'SP', cep: '01310100' }] }, { origin: EXT });
    assert.equal(r.json.recebidos, 1);

    // ---------- Mercado Livre pelo botão do site (imitação do Zebra Browser Print) ----------
    assert.equal((await p.pedir('GET', '/default', undefined, { origin: 'https://www.mercadolivre.com.br' })).status, 200);
    r = await p.pedir('POST', '/write', JSON.stringify({ device: {}, data: ML }), { origin: 'https://www.mercadolivre.com.br', 'content-type': 'text/plain' });
    assert.equal(r.status, 200);
    const itens = await p.esperar(async () => { const e = await p.estado(); return e.pedidos.filter((x) => x.tipo !== 'erro').length ? e.pedidos : null; });
    assert(itens, 'etiqueta do ML entrou na lista');
    const qtdMl = itens.length;
    assert(itens.every((x) => x.estado === 'aguardando'), 'modo conferir: não imprime sozinho');
    assert.equal(p.impressos().length, 0);

    // o mesmo arquivo de novo em menos de 3 min (clique duplo, API + Downloads): ignorado
    await p.pedir('POST', '/write', JSON.stringify({ device: {}, data: ML }), { origin: 'https://www.mercadolivre.com.br', 'content-type': 'text/plain' });
    await p.esperar(async () => /ignorad|já veio/.test(await p.log()), 10000);
    assert.equal((await p.estado()).pedidos.length, qtdMl, 'repetido não duplica a etiqueta');

    // ---------- imprimir uma e reimprimir a mesma ----------
    const um = itens[itens.length - 1].jid;
    r = await p.pedir('POST', `/api/pedido/${um}/imprimir`);
    assert.equal(r.status, 200, r.txt);
    assert.equal(p.impressos().length, 1);
    r = await p.pedir('POST', `/api/pedido/${um}/imprimir`);
    assert.equal(r.status, 200, 'reimprimir não é barrado pela trava de repetido');
    assert.equal(p.impressos().length, 2);
    const item = (await p.estado()).pedidos.find((x) => x.jid === um);
    assert.equal(item.impressoes, 2);
    assert.equal(item.estado, 'impresso');

    // ---------- reimprimir várias em sequência (painel: "Imprimir as N em sequência") ----------
    r = await p.pedir('POST', '/api/zpl', SHOPEE, { 'content-type': 'text/plain' });
    assert.equal(r.status, 200, r.txt);
    const todos = await p.esperar(async () => { const e = await p.estado(); return e.pedidos.length > qtdMl ? e.pedidos : null; });
    const ordem = todos.filter((x) => x.tipo !== 'erro').slice().reverse().map((x) => x.jid); // mais antigo primeiro, como o painel
    const antes = p.impressos().length;
    for (const jid of ordem) { r = await p.pedir('POST', `/api/pedido/${jid}/imprimir`); assert.equal(r.status, 200, r.txt); }
    const novos = p.impressos().slice(antes);
    assert.equal(novos.length, ordem.length, 'cada selecionada sai uma vez');
    assert.deepEqual(novos.map((n) => n.split('-').slice(1, 3).join('-')), ordem, 'saem na ordem do mais antigo');
    for (const n of novos) assert(fs.statSync(path.join(p.saida, n)).size > 1000, 'bytes de etiqueta de verdade (TSPL)');

    // item que não existe (ponte reiniciada): erro claro, não trava
    r = await p.pedir('POST', '/api/pedido/20000101000000-999/imprimir');
    assert.notEqual(r.status, 200);
    assert(/não encontrad/.test(r.txt));

    console.log(`ok: ponte isolada (rotas, acesso, ML pelo site, repetido ignorado, imprimir 1, reimprimir 1 e ${ordem.length} em sequência)`);
  } finally { p.parar(); }
  process.exit(0);
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
