// Mercado Livre: impressão automática das etiquetas prontas, em várias contas.
//
// Usa o mesmo aplicativo do Mercado Livre da integração de estoque (ID e segredo em cfg.ml), mas
// guarda as contas à parte (cfg.mlEtiquetas.contas), uma por vendedor. Ligado, a cada 5 minutos:
//   - lê as vendas pagas dos últimos 3 dias de cada conta;
//   - para cada envio de agência/coleta (drop_off, xd_drop_off, cross_docking) com
//     status ready_to_ship e substatus ready_to_print, baixa a etiqueta em ZPL
//     (GET /shipment_labels?response_type=zpl2) e manda para a fila da ponte, que monta a
//     etiqueta casada com a DANFE/DACE e imprime;
//   - envio com nota pendente (invoice_pending) ou erro de conta vira pendência.
// Cada envio é impresso uma vez só (lista em logs/ml-etiquetas.json, guardada por 15 dias).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const API = 'https://api.mercadolibre.com';
const TIPOS = new Set(['drop_off', 'xd_drop_off', 'cross_docking']); // agência e coleta
const INTERVALO = 5 * 60 * 1000;
let cfg, log, RAIZ, receberZpl, salvarCfg = () => {};
let dados = { impressos: {}, pendencias: [], ultima: '', eventos: [] };
const ARQ = () => path.join(RAIZ, 'logs', 'ml-etiquetas.json');

function iniciar(ctx) {
  ({ cfg, log, RAIZ, receberZpl } = ctx);
  if (ctx.salvarConfig) salvarCfg = ctx.salvarConfig;
  if (!cfg.mlEtiquetas) cfg.mlEtiquetas = { ligado: false, contas: [] };
  try { dados = { ...dados, ...JSON.parse(fs.readFileSync(ARQ(), 'utf8')) }; } catch (_) { /* primeira vez */ }
  setInterval(() => { rodada().catch((e) => evento(`rodada: ${e.message}`)); }, INTERVALO);
  setTimeout(() => { rodada().catch(() => {}); }, 20000);
}
function gravar() { try { fs.writeFileSync(ARQ(), JSON.stringify(dados)); } catch (e) { log(`ml-etiquetas: não gravou ${e.message}`); } }
function evento(txt) {
  dados.eventos.unshift({ hora: new Date().toISOString(), txt });
  dados.eventos = dados.eventos.slice(0, 60);
  log(`ML etiquetas: ${txt}`);
  gravar();
}

// ---------- contas ----------
async function trocarToken(params) {
  const ml = cfg.ml || {};
  if (!ml.appId || !ml.segredo) throw new Error('cadastre primeiro o ID e o segredo do aplicativo do Mercado Livre');
  const corpo = new URLSearchParams({ client_id: ml.appId, client_secret: ml.segredo, ...params });
  const r = await fetch(`${API}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: corpo, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error_description || `o Mercado Livre recusou (${r.status})`);
  return { acesso: j.access_token, refresh: j.refresh_token, expira: Date.now() + (j.expires_in || 21600) * 1000, usuario: j.user_id };
}
function urlAutorizacao() {
  const ml = cfg.ml || {};
  if (!ml.appId) throw new Error('cadastre primeiro o ID do aplicativo do Mercado Livre');
  return `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${encodeURIComponent(ml.appId)}&redirect_uri=${encodeURIComponent(ml.retorno)}`;
}
// cola o endereço com "?code=" depois de autorizar: adiciona (ou renova) a conta
async function adicionarConta(colado) {
  const txt = String(colado || '').trim();
  const code = (txt.match(/[?&]code=([^&\s#]+)/) || [])[1] || (/^TG-/.test(txt) ? txt : '');
  if (!code) throw new Error('não achei o código: cole o endereço inteiro da barra do navegador, que tem "?code="');
  const t = await trocarToken({ grant_type: 'authorization_code', code: decodeURIComponent(code), redirect_uri: cfg.ml.retorno });
  const eu = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${t.acesso}` }, signal: AbortSignal.timeout(20000) }).then((r) => r.json()).catch(() => ({}));
  const conta = { uid: t.usuario, apelido: eu.nickname || String(t.usuario), tokens: t };
  cfg.mlEtiquetas.contas = cfg.mlEtiquetas.contas.filter((c) => c.uid !== conta.uid).concat(conta);
  salvarCfg();
  evento(`conta ${conta.apelido} autorizada para impressão automática`);
  return conta;
}
function removerConta(uid) {
  cfg.mlEtiquetas.contas = cfg.mlEtiquetas.contas.filter((c) => String(c.uid) !== String(uid));
  salvarCfg();
}
async function acesso(conta) {
  if (Date.now() > conta.tokens.expira - 5 * 60000) {
    const t = await trocarToken({ grant_type: 'refresh_token', refresh_token: conta.tokens.refresh });
    conta.tokens = { ...t, refresh: t.refresh || conta.tokens.refresh };
    salvarCfg();
  }
  return conta.tokens.acesso;
}
// chamada com tempo máximo e nova tentativa com espera crescente (3 tentativas)
async function chamar(conta, caminho, { bruto = false } = {}) {
  let ultimo;
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(API + caminho, { headers: { Authorization: `Bearer ${await acesso(conta)}`, 'x-format-new': 'true', Accept: bruto ? '*/*' : 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (r.status === 401 && t === 1) { conta.tokens.expira = 0; continue; }
      if (r.status >= 400 && r.status < 500) {
        const j = await r.json().catch(() => ({}));
        throw Object.assign(new Error(j.message || j.error || `o Mercado Livre recusou (${r.status})`), { definitivo: true });
      }
      if (r.status >= 500) throw new Error(`o Mercado Livre respondeu com erro ${r.status}`);
      return bruto ? Buffer.from(await r.arrayBuffer()) : r.json();
    } catch (e) {
      ultimo = e.name === 'TimeoutError' ? new Error('o Mercado Livre não respondeu em 30 s') : e;
      if (ultimo.definitivo) break;
      if (t < 3) await new Promise((ok) => setTimeout(ok, 2000 * t));
    }
  }
  throw ultimo;
}

// a etiqueta em zpl2 pode vir como texto ou como .zip com o .txt dentro
function zplDaResposta(buf) {
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const tmp = path.join(os.tmpdir(), `ml-etq-${process.pid}-${Date.now()}.zip`);
    fs.writeFileSync(tmp, buf);
    try { return execFileSync('/usr/bin/unzip', ['-p', tmp], { timeout: 30000, maxBuffer: 64 * 1024 * 1024 }).toString('utf8'); }
    finally { fs.rmSync(tmp, { force: true }); }
  }
  return buf.toString('utf8');
}

// ---------- rodada ----------
let rodando = false;
async function rodada() {
  if (rodando || !cfg.mlEtiquetas.ligado || !cfg.mlEtiquetas.contas.length) return;
  rodando = true;
  const pend = [];
  try {
    const desde = new Date(Date.now() - 3 * 864e5).toISOString();
    for (const conta of cfg.mlEtiquetas.contas) {
      try {
        const r = await chamar(conta, `/orders/search?seller=${conta.uid}&order.status=paid&order.date_created.from=${encodeURIComponent(desde)}&sort=date_desc&limit=50`);
        const envios = [...new Set((r.results || []).map((o) => o.shipping && o.shipping.id).filter(Boolean))];
        const prontos = [];
        for (const id of envios) {
          if (dados.impressos[id]) continue;
          const s = await chamar(conta, `/shipments/${id}`);
          const tipo = s.logistic_type || (s.logistic && s.logistic.type);
          if (!TIPOS.has(tipo) || s.status !== 'ready_to_ship') continue;
          if (s.substatus === 'invoice_pending') { pend.push({ tipo: 'pedido', texto: `${conta.apelido}: envio ${id} esperando a NF-e para liberar a etiqueta` }); continue; }
          if (s.substatus === 'ready_to_print') prontos.push(id);
        }
        for (let i = 0; i < prontos.length; i += 50) {
          const lote = prontos.slice(i, i + 50);
          const zpl = zplDaResposta(await chamar(conta, `/shipment_labels?shipment_ids=${lote.join(',')}&response_type=zpl2`, { bruto: true }));
          if (!/\^XA/.test(zpl)) throw new Error(`a etiqueta dos envios ${lote.join(', ')} não veio em ZPL`);
          await receberZpl(zpl, { origem: `ML ${conta.apelido}` });
          for (const id of lote) dados.impressos[id] = Date.now();
          evento(`${conta.apelido}: ${lote.length} etiqueta(s) enviada(s) para a térmica`);
        }
      } catch (e) {
        pend.push({ tipo: 'automacao', texto: `${conta.apelido}: ${e.message}` });
        evento(`${conta.apelido}: ${e.message}`);
      }
    }
    for (const [id, quando] of Object.entries(dados.impressos)) if (Date.now() - quando > 15 * 864e5) delete dados.impressos[id];
    dados.pendencias = pend;
    dados.ultima = new Date().toISOString();
    gravar();
  } finally { rodando = false; }
}

function salvarConfig(novo) {
  if (typeof novo.ligado === 'boolean') cfg.mlEtiquetas.ligado = novo.ligado;
  if (novo.remover) removerConta(novo.remover);
  salvarCfg();
  if (cfg.mlEtiquetas.ligado) rodada().catch(() => {});
}
function estado() {
  return {
    ligado: !!cfg.mlEtiquetas.ligado, temApp: !!(cfg.ml && cfg.ml.appId && cfg.ml.segredo),
    contas: cfg.mlEtiquetas.contas.map((c) => ({ uid: c.uid, apelido: c.apelido })),
    ultima: dados.ultima, pendencias: dados.pendencias, eventos: dados.eventos.slice(0, 20),
  };
}
const pendencias = () => (cfg.mlEtiquetas && cfg.mlEtiquetas.ligado ? dados.pendencias : []);

module.exports = { iniciar, urlAutorizacao, adicionarConta, salvarConfig, estado, pendencias, rodada };
