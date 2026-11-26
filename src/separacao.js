// Separação do dia dentro da ponte: sobe o app Python da pasta separacao/ (planilhas do Mercado Livre
// e do TikTok -> checklist A4) como processo filho, só em 127.0.0.1, e repassa /api/separacao/*.
// O Python continua dono das regras (pedidos.py, com testes); a ponte só liga, confere e repassa.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

let ctx = { log: console.log, RAIZ: path.join(__dirname, '..') };
let filho = null, porta = 0, iniciando = null;
const TOKEN = crypto.randomBytes(32).toString('base64url');
const ROTAS = new Set(['state', 'import', 'match', 'reset', 'pdf']);

function iniciar(c) { ctx = { ...ctx, ...c }; }

// Mesmo critério do "Abrir Separação.command": um Python que tenha ReportLab.
function acharPython(pasta) {
  const candidatos = [process.env.SEPARACAO_PYTHON, path.join(pasta, '.venv/bin/python3'),
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'),
    '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'];
  for (const c of candidatos) {
    if (!c || !fs.existsSync(c)) continue;
    try { execFileSync(c, ['-c', 'import reportlab; from zoneinfo import ZoneInfo'], { timeout: 20000, stdio: 'ignore' }); return c; } catch (_) { /* tenta o próximo */ }
  }
  return null;
}

const portaLivre = () => new Promise((ok, erro) => {
  const s = require('net').createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  s.on('error', erro);
});

function chamar(metodo, rota, corpo, timeout = 240000) {
  return new Promise((ok, erro) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: rota, method: metodo, timeout,
      headers: { Host: `127.0.0.1:${porta}`, 'X-Session-Token': TOKEN, ...(corpo ? { 'Content-Type': 'application/json', 'Content-Length': corpo.length } : {}) } }, (res) => {
      const partes = [];
      res.on('data', (d) => partes.push(d));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(partes) }));
    });
    req.on('timeout', () => req.destroy(new Error('a separação demorou demais para responder')));
    req.on('error', erro);
    if (corpo) req.write(corpo);
    req.end();
  });
}

async function garantir() {
  if (filho && filho.exitCode === null && porta) return;
  if (iniciando) return iniciando;
  iniciando = (async () => {
    const pasta = path.join(ctx.RAIZ, 'separacao');
    if (!fs.existsSync(path.join(pasta, 'app.py'))) throw new Error('a separação não veio nesta instalação (pasta separacao/)');
    const py = acharPython(pasta);
    if (!py) throw new Error('não achei um Python com ReportLab para a separação; veja separacao/README.md');
    porta = await portaLivre();
    filho = spawn(py, [path.join(pasta, 'app.py'), '--port', String(porta), '--no-browser'], {
      cwd: pasta, env: { ...process.env, SEPARACAO_TOKEN: TOKEN }, stdio: ['ignore', 'ignore', 'pipe'] });
    filho.stderr.on('data', (d) => ctx.log(`separação: ${String(d).trim().slice(0, 300)}`));
    filho.on('exit', (cod) => { ctx.log(`separação: processo saiu (${cod})`); filho = null; porta = 0; });
    // espera a saúde responder (até 15 s, crescendo a espera)
    for (let i = 0, espera = 150; i < 30; i++, espera = Math.min(espera * 1.5, 1000)) {
      await new Promise((r) => setTimeout(r, espera));
      try { const r = await chamar('GET', '/api/health', null, 2000); if (r.status === 200) { ctx.log(`separação: ativa na porta interna ${porta}`); return; } } catch (_) { /* ainda subindo */ }
      if (!filho) break;
    }
    parar();
    throw new Error('a separação não respondeu ao iniciar');
  })().finally(() => { iniciando = null; });
  return iniciando;
}

function parar() { if (filho) { try { filho.kill(); } catch (_) { /* já saiu */ } } filho = null; porta = 0; }

// Repassa /api/separacao/<rota>. Devolve { status, headers, corpo } para o servidor responder.
async function repassar(metodo, rota, corpo) {
  if (!ROTAS.has(rota)) return { status: 404, headers: { 'content-type': 'application/json' }, corpo: Buffer.from('{"erro":"rota da separação desconhecida"}') };
  await garantir();
  const r = await chamar(metodo, `/api/${rota}`, metodo === 'POST' ? Buffer.from(corpo || '{}') : null);
  // o Python responde {error}; a ponte usa {erro} em todo lugar
  if (r.status >= 400 && /json/.test(r.headers['content-type'] || '')) {
    try { const j = JSON.parse(r.corpo); r.corpo = Buffer.from(JSON.stringify({ erro: j.error || j.erro })); } catch (_) { /* mantém */ }
  }
  return r;
}

// launchd reinicia a ponte com SIGTERM: sem isto o Python ficaria órfão a cada reinício
process.on('exit', parar);
for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(sinal, () => { parar(); if (process.listenerCount(sinal) === 1) process.exit(0); });
}
module.exports = { iniciar, repassar, parar };
