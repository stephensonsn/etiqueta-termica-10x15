#!/usr/bin/env node
// Ponte local que responde como o "Zebra Browser Print" (http://127.0.0.1:9100).
// O botão "Imprimir etiquetas" do Mercado Livre manda o ZPL para cá; a ponte monta a
// etiqueta 10x15 (envio + DACE) e imprime na térmica. Escuta SOMENTE em 127.0.0.1.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
let siteVisto = 0; // última vez que o site do Mercado Livre procurou a impressora
const { enviarBruto, bleInformar, lerZplDeArquivo, iniciarVigia, bleProximo, bleFeito, receberZpl, imprimirPedido, descartarPedido, diagnostico, salvarConfig, estado, log, cfg, RAIZ } = require('./impressora');
const loja = require('./loja');
loja.iniciar({ cfg, log, RAIZ });
const ml = require('./ml');
ml.iniciar({ cfg, log, RAIZ, loja });
ml.aoSalvarConfig(() => salvarConfig({}));
const mlEtiquetas = require('./mlEtiquetas');
mlEtiquetas.iniciar({ cfg, log, RAIZ, receberZpl, salvarConfig: () => salvarConfig({}) });

// Pendências para o ícone vermelho da extensão: impressora/ponte, etiquetas com erro na fila,
// pedidos parados (sem NF-e) e automações que pararam (Mercado Livre aqui, TikTok pela extensão).
const pendenciasExtensao = new Map(); // fonte -> { texto, quando }
function pendencias() {
  const out = [];
  const e = estado();
  if (!e.fila.ok) out.push({ tipo: 'impressora', texto: e.fila.texto });
  for (const p of e.pedidos) if (p.estado === 'erro') out.push({ tipo: 'etiqueta', texto: p.erro || `etiqueta ${p.id} com erro na fila` });
  out.push(...mlEtiquetas.pendencias());
  for (const [fonte, v] of pendenciasExtensao) if (Date.now() - v.quando < 6 * 3600 * 1000) out.push({ tipo: 'automacao', texto: `${fonte}: ${v.texto}` });
  return out;
}

const DISPOSITIVO = {
  deviceType: 'printer',
  uid: 'etiqueta-ml-10x15',
  provider: 'com.zebra.ds.webdriver.desktop.provider.DefaultDeviceProvider',
  name: 'Termica 10x15 (ponte local)',
  connection: 'usb',
  version: 2,
  manufacturer: 'Zebra Technologies',
};

// Resposta do comando ~HQES sem erros. O site lê os caracteres 70, 84, 87 e 88.
const STATUS_OK = (() => {
  const cab = '\u0002\r\n\r\nPRINTER STATUS'.padEnd(49, ' ') + '\r\n';
  return `${cab}   ERRORS:         0 00000000 00000000\r\n   WARNINGS:       0 00000000 00000000\r\n\u0003`;
})();

const ORIGENS = /^https:\/\/([a-z0-9-]+\.)*(mercadolivre\.com\.br|mercadolibre\.com(\.[a-z]{2})?)$/i;
let respostaPendente = '';
let fila = Promise.resolve();

function cabecalhos(req) {
  const origem = req.headers.origin || '';
  const h = { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain;charset=UTF-8' };
  if (ORIGENS.test(origem)) {
    h['Access-Control-Allow-Origin'] = origem;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = req.headers['access-control-request-headers'] || 'content-type';
    h['Access-Control-Allow-Private-Network'] = 'true';
    h.Vary = 'Origin';
  }
  return h;
}

function corpo(req, limite = 32 * 1024 * 1024, bruto = false) {
  return new Promise((ok, erro) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limite) { erro(new Error('corpo grande demais')); req.destroy(); } else partes.push(c);
    });
    req.on('end', () => ok(bruto ? Buffer.concat(partes) : Buffer.concat(partes).toString('utf8')));
    req.on('error', erro);
  });
}

const servidor = http.createServer(async (req, res) => {
  const rota = req.url.split('?')[0];
  const h = cabecalhos(req);
  const origem = req.headers.origin || '';
  try {

    // ---------- painel local (só o próprio computador) ----------
    if (rota === '/' || rota === '/painel' || rota === '/estoque' || rota.startsWith('/api/')) {
      const host = (req.headers.host || '').toLowerCase();
      const proprio = [`127.0.0.1:${cfg.porta}`, `localhost:${cfg.porta}`];
      if (!proprio.includes(host) || (origem && !proprio.map((x) => `http://${x}`).includes(origem))) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('acesso negado');
      }
      const json = (obj, cod = 200) => { res.writeHead(cod, { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'GET' && (rota === '/' || rota === '/painel')) {
        res.writeHead(200, { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(path.join(__dirname, 'painel.html')));
      }
      if (req.method === 'GET' && rota === '/estoque') {
        res.writeHead(200, { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(path.join(__dirname, 'estoque.html')));
      }
      if (req.method === 'GET' && rota === '/api/estado') return json({ ...estado(), siteVisto });
      if (req.method === 'GET' && rota === '/api/loja') return json(loja.estadoLoja());
      if (req.method === 'GET' && rota === '/api/ml') return json(ml.estadoMl());
      if (req.method === 'GET' && rota === '/api/pendencias') return json({ pendencias: pendencias() });
      if (req.method === 'GET' && rota === '/api/ml-etiquetas') return json(mlEtiquetas.estado());
      if (req.method === 'GET' && rota === '/api/ml-etiquetas/autorizar') { try { return json({ url: mlEtiquetas.urlAutorizacao() }); } catch (e) { return json({ erro: e.message }, 400); } }
      if (req.method === 'GET' && rota === '/api/ml/autorizar') { try { return json({ url: ml.urlAutorizacao() }); } catch (e) { return json({ erro: e.message }, 400); } }
      if (req.method === 'GET' && rota === '/api/ble/proximo') return json(bleProximo() || {});
      const mPrevia = rota.match(/^\/api\/previa\/([0-9]+-[0-9]+)\.png$/);
      if (req.method === 'GET' && mPrevia) {
        const arq = path.join(RAIZ, 'previa', `${mPrevia[1]}.png`);
        if (!fs.existsSync(arq)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' }); return res.end(fs.readFileSync(arq));
      }
      if (req.method === 'POST' && rota === '/api/zpl') {
        // aceita o .txt ou o .zip inteiro (Mercado Livre e Shopee)
        const dados = await corpo(req, 64 * 1024 * 1024, true);
        const tmp = path.join(os.tmpdir(), `etiqueta-${process.pid}-${Date.now()}`);
        try {
          fs.writeFileSync(tmp, dados);
          const zpl = lerZplDeArquivo(tmp);
          if (!zpl) return json({ erro: 'o arquivo não tem etiqueta em ZPL' }, 400);
          return json(await receberZpl(zpl, { origem: 'painel', imprimir: false }));
        } catch (e) {
          log(`ERRO no painel (${rota}): ${e.message}`);
          return json({ erro: e.message }, 400);
        } finally { fs.rmSync(tmp, { force: true }); }
      }
      if (req.method === 'POST') {
        const txt = await corpo(req);
        try {
          if (rota === '/api/config') return json(salvarConfig(JSON.parse(txt || '{}')));
          // ---------- loja virtual (WooCommerce) ----------
          if (rota === '/api/loja/config') { loja.salvarConfig(JSON.parse(txt || '{}')); salvarConfig({}); return json(loja.estadoLoja()); }
          if (rota === '/api/loja/sincronizar') { const n = await loja.sincronizar(); return json({ ...loja.estadoLoja(), importados: n }); }
          if (rota === '/api/loja/bipe') return json(await loja.bipar(JSON.parse(txt || '{}')));
          // ---------- Mercado Livre ----------
          if (rota === '/api/ml-etiquetas/autorizar') { await mlEtiquetas.adicionarConta(JSON.parse(txt || '{}').colado); return json(mlEtiquetas.estado()); }
          if (rota === '/api/ml-etiquetas/config') { mlEtiquetas.salvarConfig(JSON.parse(txt || '{}')); return json(mlEtiquetas.estado()); }
          if (rota === '/api/ml-etiquetas/rodada') { await mlEtiquetas.rodada(); return json(mlEtiquetas.estado()); }
          if (rota === '/api/pendencias/extensao') {
            const { fonte, texto } = JSON.parse(txt || '{}');
            if (fonte) { if (texto) pendenciasExtensao.set(String(fonte).slice(0, 40), { texto: String(texto).slice(0, 300), quando: Date.now() }); else pendenciasExtensao.delete(String(fonte)); }
            return json({ pendencias: pendencias() });
          }
          if (rota === '/api/ml/config') { ml.salvarConfig(JSON.parse(txt || '{}')); return json(ml.estadoMl()); }
          if (rota === '/api/ml/autorizar') { await ml.concluirAutorizacao(JSON.parse(txt || '{}').colado); return json(ml.estadoMl()); }
          if (rota === '/api/ml/anuncios') { const n = await ml.sincronizarAnuncios(); return json({ ...ml.estadoMl(), lidos: n }); }
          if (rota === '/api/ml/vincular') { ml.vincular(JSON.parse(txt || '{}')); return json(ml.estadoMl()); }
          if (rota === '/api/ml/enviar-estoque') { const n = await ml.enviarTodos(); return json({ ...ml.estadoMl(), produtos: n }); }
          if (rota === '/api/loja/codigo') return json(await loja.definirCodigo(JSON.parse(txt || '{}')));
          if (rota === '/api/loja/gerar-ean') return json(await loja.gerarEan13(JSON.parse(txt || '{}')));
          if (rota === '/api/ble/estado') { const b = JSON.parse(txt || '{}'); bleInformar({ bt: Number.isInteger(b.bt) ? b.bt : undefined, conectada: b.conectada === true, nome: String(b.nome || '').slice(0, 60), jaRespondeu: b.jaRespondeu === true, respondeAgora: b.respondeAgora === true, estado: Number.isInteger(b.estado) ? b.estado : undefined }); return json({}); }
          if (rota === '/api/ble/feito') { const b = JSON.parse(txt || '{}'); bleFeito(Number(b.id), b.ok === true, String(b.erro || '').slice(0, 200)); return json({}); }
          if (rota === '/api/teste') return json(await diagnostico(JSON.parse(txt || '{}').tipo));
          if (rota === '/api/abrir-ajustes') {
            // abre a tela certa dos Ajustes do Sistema para a pessoa liberar a permissão
            const telas = {
              bluetooth: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Bluetooth',
              arquivos: 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
              impressoras: 'x-apple.systempreferences:com.apple.Print-Scan-Settings.extension',
              bluetoothLigar: 'x-apple.systempreferences:com.apple.BluetoothSettings',
            };
            const alvo = telas[JSON.parse(txt || '{}').qual];
            if (!alvo) return json({ erro: 'tela desconhecida' }, 400);
            require('child_process').execFile('/usr/bin/open', [alvo], () => {});
            return json({ ok: true });
          }
          if (rota === '/api/instalar-driver') {
            // driver de sistema: o próprio macOS pede a senha de administrador, na janela padrão dele
            const script = path.join(RAIZ, 'driver-mac', 'instalar-driver.sh');
            if (!fs.existsSync(script)) return json({ erro: 'o driver de sistema não veio nesta instalação' }, 400);
            const cmd = `do shell script quoted form of "${script.replace(/"/g, '')}" with administrator privileges`;
            const r = await new Promise((ok) => require('child_process').execFile('/usr/bin/osascript', ['-e', cmd], { timeout: 180000 }, (e, so, se) => ok({ e, se })));
            if (r.e) return json({ erro: /cancel/i.test(String(r.se)) ? 'instalação cancelada' : `não instalou: ${String(r.se || r.e.message).trim().slice(0, 160)}` }, 400);
            return json({ ok: true });
          }
          if (rota === '/api/sku/imprimir') {
            const { etiquetas, opts } = JSON.parse(txt || '{}');
            if (!Array.isArray(etiquetas) || !etiquetas.length) return json({ erro: 'lista de etiquetas vazia' }, 400);
            const { paraTsplSku } = require('./etiqueta');
            const tspl = paraTsplSku(etiquetas, opts || {});
            await enviarBruto(tspl);
            log(`SKU: impressas ${etiquetas.length} etiqueta(s) via /api/sku/imprimir`);
            return json({ ok: true, quantidade: etiquetas.length });
          }
          const mAcao = rota.match(/^\/api\/pedido\/([0-9]+-[0-9]+)\/(imprimir|descartar)$/);
          if (mAcao) return json(mAcao[2] === 'imprimir' ? await imprimirPedido(mAcao[1]) : descartarPedido(mAcao[1]));
        } catch (e) {
          log(`ERRO no painel (${rota}): ${e.message}`);
          return json({ erro: e.message }, 400);
        }
      }
      res.writeHead(404); return res.end();
    }

    if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
    // páginas de outros sites não podem usar a impressora
    if (origem && !ORIGENS.test(origem)) { res.writeHead(403, h); return res.end('origem nao permitida'); }

    if (origem && ORIGENS.test(origem)) siteVisto = Date.now(); // o site do marketplace já enxerga a ponte
    if (req.method === 'GET' && rota === '/default') { res.writeHead(200, h); return res.end(JSON.stringify(DISPOSITIVO)); }
    if (req.method === 'GET' && rota === '/available') { res.writeHead(200, h); return res.end(JSON.stringify({ printer: [DISPOSITIVO] })); }
    if (req.method === 'GET' && rota === '/config') { res.writeHead(200, h); return res.end(JSON.stringify({ application: { version: '1.3.2.489', build_number: 489, api_level: 5, platform: 'macos', supportedConversions: {} } })); }
    if (req.method === 'GET' && rota === '/saude') { res.writeHead(200, h); return res.end('ok'); }

    if (req.method === 'POST' && rota === '/write') {
      const txt = await corpo(req);
      let dados = txt;
      try { dados = JSON.parse(txt).data ?? ''; } catch (_) { /* corpo já é o ZPL */ }
      if (/\^XA/i.test(dados)) {
        // responde logo e imprime em fila, um pedido por vez
        fila = fila.then(() => receberZpl(dados, { origem: origem || 'local' })).catch((e) => log(`ERRO ao receber: ${e.message}`));
      } else if (/~HQES/i.test(dados)) {
        respostaPendente = STATUS_OK;
      } else if (/~HS/i.test(dados)) {
        respostaPendente = '\u0002030,0,0,1245,000,0,0,0,000,0,0,0\u0003\r\n\u0002000,0,0,0,1,2,6,0,00000000,1,000\u0003\r\n\u00021234,0\u0003\r\n';
      } else {
        log(`comando ignorado: ${JSON.stringify(dados.slice(0, 60))}`);
      }
      res.writeHead(200, h); return res.end('');
    }
    if (req.method === 'POST' && rota === '/read') {
      await corpo(req);
      const r = respostaPendente; respostaPendente = '';
      res.writeHead(200, h); return res.end(r);
    }
    res.writeHead(404, h); res.end('');
  } catch (e) {
    log(`ERRO na rota ${rota}: ${e.message}`);
    res.writeHead(500, h); res.end('');
  }
});

// Porta para o driver de sistema: o macOS entrega aqui o trabalho já em TSPL (fila "socket://127.0.0.1:porta").
// O macOS não aceita programas de entrega de terceiros, então a entrega usa o envio por rede que já vem nele.
const portaDriver = cfg.portaDriver || 9102;
net.createServer((c) => {
  const partes = [];
  let total = 0;
  c.setTimeout(120000, () => c.destroy());
  c.on('data', (d) => { total += d.length; if (total > 64 * 1024 * 1024) c.destroy(); else partes.push(d); });
  c.on('error', () => {});
  c.on('end', () => {
    fila = fila.then(() => enviarBruto(Buffer.concat(partes))).catch((e) => log(`ERRO no trabalho do driver: ${e.message}`));
  });
}).on('error', (e) => log(`ERRO na porta do driver (${portaDriver}): ${e.message}`)).listen(portaDriver, '127.0.0.1');

servidor.on('error', (e) => { log(`ERRO do servidor: ${e.message}`); process.exit(1); });
servidor.listen(cfg.porta, '127.0.0.1', () => { iniciarVigia(); log(`ponte ativa em http://127.0.0.1:${cfg.porta} -> fila ${cfg.fila} (imprimir=${cfg.imprimir}); painel em http://127.0.0.1:${cfg.porta}/painel`); });
