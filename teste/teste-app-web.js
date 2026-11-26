// App novo (React em src/web) servido pela ponte + repasse da Separação para o Python.
// Ponte isolada (porta livre, dados temporários): nunca toca a instalação nem a impressora.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { subir, RAIZ } = require('./ponte-teste');

(async () => {
  const p = await subir();
  let ok = 0;
  const passo = (nome) => { ok++; console.log(`  ok ${nome}`); };
  try {
    // 1. rotas do app devolvem o index do React, com cabeçalhos de segurança
    for (const rota of ['/', '/fila', '/separacao', '/estoque', '/mercado-livre', '/impressora']) {
      const r = await p.pedir('GET', rota);
      assert.strictEqual(r.status, 200, rota);
      assert.match(r.txt, /<div id="root">/, `${rota} não é o app`);
      assert.strictEqual(r.cab['x-frame-options'], 'SAMEORIGIN');
      assert.strictEqual(r.cab['x-content-type-options'], 'nosniff');
    }
    passo('rotas do app servem o index com nosniff e SAMEORIGIN')

    // 2. arquivos do build e bloqueio de caminho fora da pasta
    const html = (await p.pedir('GET', '/')).txt;
    const js = html.match(/\/assets\/[^"]+\.js/)[0];
    const a = await p.pedir('GET', js);
    assert.strictEqual(a.status, 200);
    assert.match(a.cab['content-type'], /javascript/);
    assert.match(a.cab['cache-control'], /immutable/);
    assert.strictEqual((await p.pedir('GET', '/assets/../../config.json')).status, 404);
    passo('assets do build com cache longo; caminho para fora da pasta = 404');

    // 3. páginas antigas continuam: /painel sempre; /estoque dentro do app (iframe)
    assert.match((await p.pedir('GET', '/painel')).txt, /<title>/);
    const emb = await p.pedir('GET', '/estoque', undefined, { 'sec-fetch-dest': 'iframe' });
    assert.ok(!/<div id="root">/.test(emb.txt), 'iframe de /estoque deveria ser a página original');
    const dentro = await p.pedir('GET', '/fila', undefined, { 'sec-fetch-dest': 'iframe' });
    assert.strictEqual(dentro.status, 302, 'o app não pode abrir dentro dele mesmo');
    passo('páginas originais no iframe; app não se aninha');

    // 4. outro site não usa a API
    const fora = await p.pedir('POST', '/api/pedido/1-1/imprimir', {}, { origin: 'https://exemplo.com' });
    assert.strictEqual(fora.status, 403);
    passo('POST de outra origem recusado');

    // 5. fila: arquivo enviado pelo app aparece aguardando e pode ser descartado
    const zpl = fs.readFileSync(path.join(RAIZ, 'exemplos', 'mercado-livre-exemplo.txt'));
    const env = await p.pedir('POST', '/api/zpl', zpl.toString('latin1'), { 'content-type': 'application/octet-stream', origin: `http://127.0.0.1:${p.porta}` });
    assert.strictEqual(env.status, 200, env.txt);
    const jid = env.json[0].jid;
    let est = await p.estado();
    assert.strictEqual(est.pedidos.find((x) => x.jid === jid).estado, 'aguardando');
    await p.pedir('POST', `/api/pedido/${jid}/descartar`, {});
    est = await p.estado();
    assert.strictEqual(est.pedidos.find((x) => x.jid === jid).estado, 'descartado');
    passo('fila: arquivo entra aguardando e descarta');

    // 6. separação: a ponte sobe o Python e repassa (estado vazio, rota desconhecida, erro em PT)
    const st = await p.pedir('GET', '/api/separacao/state');
    assert.strictEqual(st.status, 200, st.txt);
    assert.deepStrictEqual(st.json, { items: [], files: [], warnings: [] });
    assert.strictEqual((await p.pedir('GET', '/api/separacao/xyz')).status, 404);
    const sem = await p.pedir('POST', '/api/separacao/pdf', { ids: [] });
    assert.strictEqual(sem.status, 422);
    assert.match(sem.json.erro, /Selecione/);
    const novo = await p.pedir('POST', '/api/separacao/reset', {});
    assert.strictEqual(novo.json.ok, true);
    passo('separação repassada ao Python (estado, 404, erro em PT, novo lote)');

    console.log(`teste-app-web: ${ok} verificações ok`);
  } finally { p.parar(); }
})().catch((e) => { console.error('FALHOU teste-app-web:', e.message); process.exit(1); });
