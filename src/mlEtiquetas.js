// Mercado Livre: impressão automática das etiquetas prontas, em várias contas.
//
// Usa o mesmo aplicativo do Mercado Livre da integração de estoque (ID e segredo em cfg.ml), mas
// guarda as contas à parte (cfg.mlEtiquetas.contas), uma por vendedor. Ligado, a cada 5 minutos:
//   - lê as vendas pagas dos últimos 3 dias de cada conta;
//   - para cada envio de agência/coleta (drop_off, xd_drop_off, cross_docking) com
//     status ready_to_ship e substatus ready_to_print, baixa a etiqueta em ZPL
//     (GET /shipment_labels?response_type=zpl2) e manda para a fila da ponte, que monta a
//     etiqueta casada com a DANFE/DACE e imprime;
//   - envio esperando nota (invoice_pending): pede a NF-e ao Faturador do Mercado Livre
//     (POST /users/{conta}/invoices/orders com as vendas do envio). Na rodada seguinte a etiqueta
//     fica pronta e imprime. Erro de cadastro (dado fiscal do anúncio, do comprador etc.) trava o
//     envio até a pessoa clicar "Corrigi, tentar de novo" no painel; erro passageiro tenta de novo;
//   - erro de conta vira pendência.
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
let dados = { impressos: {}, pendencias: [], ultima: '', eventos: [], nfePedida: {}, travados: {} };
const ARQ = () => path.join(RAIZ, 'logs', 'ml-etiquetas.json');

function iniciar(ctx) {
  ({ cfg, log, RAIZ, receberZpl } = ctx);
  if (ctx.salvarConfig) salvarCfg = ctx.salvarConfig;
  if (!cfg.mlEtiquetas) cfg.mlEtiquetas = { ligado: false, contas: [] };
  try { dados = { ...dados, ...JSON.parse(fs.readFileSync(ARQ(), 'utf8')) }; } catch (_) { /* primeira vez */ }
  dados.nfePedida = dados.nfePedida || {}; dados.travados = dados.travados || {};
  if (cfg.mlEtiquetas.emitirNfe === undefined) cfg.mlEtiquetas.emitirNfe = true;
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
// O login é o mesmo da integração de estoque (ml.js): botão Conectar, PKCE e retorno automático para a ponte.
const ml = require('./ml');
const trocarToken = (params) => ml.pedirToken(params);
const urlAutorizacao = () => ml.urlAutorizacao('etiquetas');
// conta que acabou de voltar do login: adiciona (ou renova) pelo user_id
async function adicionarComTokens(t) {
  const eu = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${t.acesso}` }, signal: AbortSignal.timeout(20000) }).then((r) => r.json()).catch(() => ({}));
  const conta = { uid: t.usuario, apelido: eu.nickname || String(t.usuario), tokens: t };
  cfg.mlEtiquetas.contas = cfg.mlEtiquetas.contas.filter((c) => c.uid !== conta.uid).concat(conta);
  salvarCfg();
  evento(`conta ${conta.apelido} conectada para impressão automática`);
  return conta;
}
// alternativa: colar o endereço com "?code=" e "?state=" (quando o retorno automático não abriu)
async function adicionarConta(colado) {
  const txt = String(colado || '').trim();
  const code = decodeURIComponent((txt.match(/[?&]code=([^&\s#]+)/) || [])[1] || '');
  const state = decodeURIComponent((txt.match(/[?&]state=([^&\s#]+)/) || [])[1] || '');
  if (!code) throw new Error('não achei o código: cole o endereço inteiro da barra do navegador, que tem "?code="');
  const r = await ml.concluirRetorno(code, state);
  return r.destino === 'etiquetas' ? adicionarComTokens(r.tokens) : r.tokens;
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
async function chamar(conta, caminho, { bruto = false, metodo = 'GET', corpo, tentativas = 3 } = {}) {
  let ultimo;
  for (let t = 1; t <= tentativas; t++) {
    try {
      const headers = { Authorization: `Bearer ${await acesso(conta)}`, 'x-format-new': 'true', Accept: bruto ? '*/*' : 'application/json' };
      if (corpo) headers['Content-Type'] = 'application/json';
      const r = await fetch(API + caminho, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(30000) });
      if (r.status === 401 && t === 1) { conta.tokens.expira = 0; continue; }
      if (r.status >= 400 && r.status < 500) {
        const j = await r.json().catch(() => ({}));
        throw Object.assign(new Error(j.message || j.error || `o Mercado Livre recusou (${r.status})`), { definitivo: true, status: r.status, codigo: j.error_code });
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

// ---------- NF-e pelo Faturador do Mercado Livre ----------
// Uma nota por envio, com todas as vendas dele (carrinho). Devolve 'pedida' ou lança erro
// marcado com cadastro=true quando é dado que a pessoa precisa corrigir.
async function emitirNfe(conta, envio, vendas) {
  try {
    const r = await chamar(conta, `/users/${conta.uid}/invoices/orders`, { metodo: 'POST', corpo: { orders: vendas }, tentativas: 1 });
    if (r && r.error_code) throw Object.assign(new Error(r.message || 'erro na emissão'), { definitivo: true, status: 400, codigo: r.error_code });
    return r && r.status;
  } catch (e) {
    if (!e.definitivo) throw e; // rede ou erro do Mercado Livre: tenta na próxima rodada
    if (e.status === 401 || e.status === 403) throw Object.assign(new Error(`sem permissão para emitir NF-e pela API (${e.message}); confira as permissões do aplicativo`), { conta: true });
    let motivo = e.message;
    if (e.codigo) {
      try { const d = await chamar(conta, `/users/invoices/errors/MLB/${encodeURIComponent(e.codigo)}`, { tentativas: 1 }); if (d && d.display_message) motivo = d.display_message; } catch (_) { /* fica a mensagem original */ }
    }
    throw Object.assign(new Error(`envio ${envio}: ${motivo}${e.codigo ? ` (erro ${e.codigo})` : ''}`), { cadastro: true });
  }
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
        const vendasDoEnvio = new Map();
        for (const o of r.results || []) {
          const id = o.shipping && o.shipping.id;
          if (id) vendasDoEnvio.set(id, (vendasDoEnvio.get(id) || []).concat(o.id));
        }
        const envios = [...vendasDoEnvio.keys()];
        const prontos = [];
        for (const id of envios) {
          if (dados.impressos[id]) continue;
          const s = await chamar(conta, `/shipments/${id}`);
          const tipo = s.logistic_type || (s.logistic && s.logistic.type);
          if (!TIPOS.has(tipo) || s.status !== 'ready_to_ship') continue;
          if (s.substatus === 'invoice_pending') {
            const trava = dados.travados[id];
            if (trava) { pend.push({ tipo: 'pedido', texto: `${conta.apelido}: ${trava.motivo}. Corrija e clique "Corrigi, tentar de novo" no painel`, envio: String(id) }); continue; }
            if (!cfg.mlEtiquetas.emitirNfe) { pend.push({ tipo: 'pedido', texto: `${conta.apelido}: envio ${id} esperando a NF-e para liberar a etiqueta` }); continue; }
            // já pedida há pouco: dá tempo para a SEFAZ autorizar (não pede duas vezes)
            if (dados.nfePedida[id] && Date.now() - dados.nfePedida[id] < 30 * 60000) continue;
            try {
              const st = await emitirNfe(conta, id, vendasDoEnvio.get(id));
              dados.nfePedida[id] = Date.now();
              evento(`${conta.apelido}: NF-e do envio ${id} pedida ao Faturador (${st || 'em processamento'}); a etiqueta sai quando liberar`);
            } catch (e) {
              if (e.cadastro) {
                dados.travados[id] = { motivo: e.message, quando: Date.now(), conta: conta.apelido };
                pend.push({ tipo: 'pedido', texto: `${conta.apelido}: ${e.message}. Corrija e clique "Corrigi, tentar de novo" no painel`, envio: String(id) });
                evento(`${conta.apelido}: ${e.message} (não tento de novo até corrigir)`);
              } else if (e.conta) throw e;
              else evento(`${conta.apelido}: NF-e do envio ${id} não saiu agora (${e.message}); tento na próxima rodada`);
            }
            continue;
          }
          delete dados.travados[id]; // a nota saiu (emitida aqui ou à mão): some a trava
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
    for (const [id, quando] of Object.entries(dados.nfePedida)) if (Date.now() - quando > 7 * 864e5) delete dados.nfePedida[id];
    for (const [id, t] of Object.entries(dados.travados)) if (Date.now() - t.quando > 15 * 864e5) delete dados.travados[id];
    dados.pendencias = pend;
    dados.ultima = new Date().toISOString();
    gravar();
  } finally { rodando = false; }
}

function salvarConfig(novo) {
  if (typeof novo.ligado === 'boolean') cfg.mlEtiquetas.ligado = novo.ligado;
  if (novo.remover) removerConta(novo.remover);
  if (typeof novo.emitirNfe === 'boolean') cfg.mlEtiquetas.emitirNfe = novo.emitirNfe;
  if (novo.liberar && /^\d{6,20}$/.test(String(novo.liberar))) { delete dados.travados[novo.liberar]; delete dados.nfePedida[novo.liberar]; evento(`envio ${novo.liberar}: liberado para tentar a NF-e de novo`); }
  salvarCfg();
  if (cfg.mlEtiquetas.ligado) rodada().catch(() => {});
}
function estado() {
  return {
    ligado: !!cfg.mlEtiquetas.ligado, emitirNfe: cfg.mlEtiquetas.emitirNfe !== false,
    travados: Object.entries(dados.travados).map(([envio, t]) => ({ envio, motivo: t.motivo, conta: t.conta })), temApp: !!(cfg.ml && cfg.ml.appId && cfg.ml.segredo),
    contas: cfg.mlEtiquetas.contas.map((c) => ({ uid: c.uid, apelido: c.apelido })),
    ultima: dados.ultima, pendencias: dados.pendencias, eventos: dados.eventos.slice(0, 20),
  };
}
const pendencias = () => (cfg.mlEtiquetas && cfg.mlEtiquetas.ligado ? dados.pendencias : []);

module.exports = { iniciar, urlAutorizacao, adicionarConta, adicionarComTokens, salvarConfig, estado, pendencias, rodada };
