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
    for (const rota of ['/', '/fila', '/separacao', '/estoque', '/mercado-livre', '/impressora', '/impressora/configurar', '/configuracoes']) {
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

// Histórico da fila sobrevive a reiniciar a ponte, reimprime pela prévia e respeita os dias da configuração.
(async () => {
  await new Promise((r) => setTimeout(r, 100));
  const p1 = await subir();
  try {
    const zpl = fs.readFileSync(path.join(RAIZ, 'exemplos', 'mercado-livre-exemplo.txt')).toString('latin1');
    const env = await p1.pedir('POST', '/api/zpl', zpl, { 'content-type': 'application/octet-stream' });
    const jid = env.json[0].jid;
    await p1.pedir('POST', `/api/pedido/${jid}/imprimir`, {});
    assert.strictEqual((await p1.estado()).pedidos.find((x) => x.jid === jid).estado, 'impresso');
    await p1.parar(true);
    const p2 = await subir({}, { base: p1.base });
    try {
      const volta = (await p2.estado()).pedidos.find((x) => x.jid === jid);
      assert.ok(volta, 'a etiqueta sumiu do histórico ao reiniciar');
      assert.strictEqual(volta.estado, 'impresso');
      assert.strictEqual(volta.impressoes, 1);
      assert.deepStrictEqual(volta.eventos.map((x) => x.tipo), ['chegou', 'impressa'], 'linha do tempo gravada');
      const r = await p2.pedir('POST', `/api/pedido/${jid}/imprimir`, {});
      assert.strictEqual(r.status, 200, r.txt);
      assert.strictEqual(r.json.impressoes, 2);
      assert.deepStrictEqual(r.json.eventos.map((x) => x.tipo), ['chegou', 'impressa', 'impressa']);
      assert.strictEqual(r.json.eventos[2].detalhe, '2ª vez');
      console.log('  ok histórico sobrevive a reiniciar e reimprime pela prévia');
      assert.strictEqual((await p2.pedir('POST', '/api/config', { historicoDias: 0 })).status, 400);
      const c = await p2.pedir('POST', '/api/config', { historicoDias: 5 });
      assert.strictEqual(c.json.historicoDias ?? (await p2.estado()).config.historicoDias, 5);
      console.log('  ok dias do histórico: aceita 1 a 30, recusa fora disso');
      // arquivo antigo: pedido com mais de N dias some ao reiniciar, junto da prévia
      const arq = path.join(p2.dados, 'logs', 'historico-fila.json');
      await new Promise((r2) => setTimeout(r2, 3500));
      const h = JSON.parse(fs.readFileSync(arq, 'utf8'));
      h[0].hora = new Date(Date.now() - 6 * 864e5).toISOString();
      await p2.parar(true);
      fs.writeFileSync(arq, JSON.stringify(h));
      const p3 = await subir({}, { base: p1.base });
      try {
        assert.ok(!(await p3.estado()).pedidos.some((x) => x.jid === jid), 'pedido de 6 dias deveria ter saído do histórico');
        assert.ok(!fs.existsSync(path.join(p3.dados, 'previa', `${jid}.png`)), 'a prévia antiga deveria ter saído');
        console.log('  ok mais velho que o prazo sai do histórico e a prévia é apagada');
      } finally { await p3.parar(); }
    } finally { await p2.parar(true); }
  } catch (e) { console.error('FALHOU histórico da fila:', e.message); process.exitCode = 1; }
})();
