// Sobe uma ponte isolada para teste: pasta de dados, pasta "Downloads" e saída da impressora
// temporárias, porta livre. Nunca toca a instalação nem a impressora de verdade.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const portaLivre = () => new Promise((ok, erro) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); s.on('error', erro); });

function pedir(porta, metodo, rota, corpo, cab = {}) {
  return new Promise((ok, erro) => {
    const dados = corpo === undefined ? null : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: rota, headers: { host: `127.0.0.1:${porta}`, ...(dados ? { 'content-type': 'application/json', 'content-length': dados.length } : {}), ...cab } }, (res) => {
      const partes = []; res.on('data', (d) => partes.push(d)); res.on('end', () => { const txt = Buffer.concat(partes).toString(); let json = null; try { json = JSON.parse(txt); } catch (_) { /* texto */ } ok({ status: res.statusCode, txt, json, cab: res.headers }); });
    });
    req.on('error', erro);
    req.setTimeout(30000, () => req.destroy(new Error('sem resposta em 30 s')));
    if (dados) req.write(dados);
    req.end();
  });
}

async function subir(config = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'etiqueta-teste-'));
  const dados = path.join(base, 'dados'); const downloads = path.join(base, 'Downloads'); const saida = path.join(base, 'saida');
  for (const d of [dados, downloads, saida]) fs.mkdirSync(d, { recursive: true });
  const cfg = { ...JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.exemplo.json'), 'utf8')), configurado: true, imprimir: 'conferir', ...config };
  fs.writeFileSync(path.join(dados, 'config.json'), JSON.stringify(cfg, null, 2));
  const porta = await portaLivre(); const portaDriver = await portaLivre();
  const filho = spawn(process.execPath, [path.join(RAIZ, 'src', 'servidor.js')], { env: { ...process.env, ETIQUETA_DADOS: dados, ETIQUETA_DOWNLOADS: downloads, ETIQUETA_SAIDA_TESTE: saida, ETIQUETA_PORTA: String(porta), ETIQUETA_PORTA_DRIVER: String(portaDriver) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let saidaProc = '';
  filho.stdout.on('data', (d) => { saidaProc += d; }); filho.stderr.on('data', (d) => { saidaProc += d; });
  const fim = Date.now() + 20000;
  for (;;) {
    try { const r = await pedir(porta, 'GET', '/saude'); if (r.status === 200) break; } catch (_) { /* subindo */ }
    if (Date.now() > fim || filho.exitCode !== null) { filho.kill(); throw new Error('ponte de teste não subiu: ' + saidaProc.slice(-500)); }
    await new Promise((r) => setTimeout(r, 200));
  }
  const p = {
    porta, portaDriver, dados, downloads, saida,
    pedir: (m, r, c, cab) => pedir(porta, m, r, c, cab),
    estado: async () => (await pedir(porta, 'GET', '/api/estado')).json,
    impressos: () => fs.readdirSync(saida).sort(),
    log: async () => (await p.estado()).log.join('\n'),
    esperar: async (cond, ms = 30000) => { const f = Date.now() + ms; for (;;) { const v = await cond(); if (v) return v; if (Date.now() > f) return null; await new Promise((r) => setTimeout(r, 250)); } },
    parar: () => { filho.kill(); try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) { /* fica no tmp */ } },
  };
  return p;
}

module.exports = { subir, RAIZ };
