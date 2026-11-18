// Integração com o Mercado Livre: anúncios ligados aos produtos da loja e estoque único.
//
//  - A conta é autorizada uma vez por um aplicativo do próprio vendedor (developers.mercadolivre.com.br).
//    O endereço de retorno é o próprio site da loja: depois de autorizar, a pessoa copia o endereço
//    da barra do navegador (tem "?code=...") e cola no painel. Nada precisa ficar exposto na internet.
//  - Cada anúncio é vinculado a um produto da loja e diz quantas unidades consome (kit de 12 = 12).
//  - Venda paga no Mercado Livre baixa o estoque do produto no site (uma vez por pedido).
//  - Quando o estoque do site muda, os anúncios vinculados recebem a quantidade disponível
//    (estoque dividido pelas unidades do kit), para nenhum canal vender o que acabou.
//  - As duas sincronizações começam desligadas; ficam ligadas só quando a pessoa liga no painel.
'use strict';
const fs = require('fs');
const path = require('path');

let cfg, log, RAIZ, loja;
const ARQ = () => path.join(RAIZ, 'logs', 'ml.json');
let dados = { anuncios: [], vinculos: {}, pedidosVistos: {}, ultimaConsulta: '', atualizado: '', erro: '', eventos: [] };
const API = 'https://api.mercadolibre.com';

function iniciar(contexto) {
  ({ cfg, log, RAIZ, loja } = contexto);
  if (!cfg.ml) cfg.ml = { appId: '', segredo: '', retorno: 'https://trendtoy.com.br/', tokens: null, baixarVendas: false, enviarEstoque: false };
  try { dados = { ...dados, ...JSON.parse(fs.readFileSync(ARQ(), 'utf8')) }; } catch (_) { /* primeira vez */ }
  loja.quandoMudarEstoque((p) => enviarEstoqueDoProduto(p.chave));
  setInterval(() => { consultarPedidos().catch((e) => evento(`pedidos: ${e.message}`)); }, 120000);
}
function gravar() { try { fs.writeFileSync(ARQ(), JSON.stringify(dados)); } catch (e) { log(`ml: não gravou ${e.message}`); } }
function evento(txt) {
  dados.eventos.unshift({ hora: new Date().toISOString(), txt });
  dados.eventos = dados.eventos.slice(0, 80);
  log(`ml: ${txt}`);
  gravar();
}
let salvarCfg = () => {};
function aoSalvarConfig(fn) { salvarCfg = fn; }

// ---------- autorização ----------
const conectado = () => !!(cfg.ml.tokens && cfg.ml.tokens.refresh);
function urlAutorizacao() {
  if (!cfg.ml.appId) throw new Error('informe o ID do aplicativo');
  return `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${encodeURIComponent(cfg.ml.appId)}&redirect_uri=${encodeURIComponent(cfg.ml.retorno)}`;
}
async function token(params) {
  const corpo = new URLSearchParams({ client_id: cfg.ml.appId, client_secret: cfg.ml.segredo, ...params });
  const r = await fetch(`${API}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: corpo, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error_description || `o Mercado Livre recusou a autorização (${r.status})`);
  cfg.ml.tokens = { acesso: j.access_token, refresh: j.refresh_token || cfg.ml.tokens?.refresh, expira: Date.now() + (j.expires_in || 21600) * 1000, usuario: j.user_id };
  salvarCfg();
  return cfg.ml.tokens;
}
async function concluirAutorizacao(colado) {
  const txt = String(colado || '').trim();
  const code = (txt.match(/[?&]code=([^&\s#]+)/) || [])[1] || (/^TG-/.test(txt) ? txt : '');
  if (!code) throw new Error('não achei o código: cole o endereço inteiro da barra do navegador, que tem "?code="');
  const t = await token({ grant_type: 'authorization_code', code: decodeURIComponent(code), redirect_uri: cfg.ml.retorno });
  evento(`conta ${t.usuario} autorizada`);
  return t;
}
async function acesso() {
  if (!conectado()) throw new Error('conta do Mercado Livre não autorizada');
  if (Date.now() > cfg.ml.tokens.expira - 5 * 60000) await token({ grant_type: 'refresh_token', refresh_token: cfg.ml.tokens.refresh });
  return cfg.ml.tokens.acesso;
}

// chamada com tempo máximo e nova tentativa com espera crescente (3 tentativas)
async function chamar(metodo, caminho, corpo) {
  let ultimo;
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(API + caminho, {
        method: metodo,
        headers: { Authorization: `Bearer ${await acesso()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 && t === 1) { cfg.ml.tokens.expira = 0; continue; } // token vencido: renova e tenta de novo
      if (r.status >= 400 && r.status < 500) throw Object.assign(new Error(j.message || `o Mercado Livre recusou (${r.status})`), { definitivo: true });
      if (r.status >= 500) throw new Error(`o Mercado Livre respondeu com erro ${r.status}`);
      return j;
    } catch (e) {
      ultimo = e.name === 'TimeoutError' ? new Error('o Mercado Livre não respondeu em 20 s') : e;
      if (ultimo.definitivo) break;
      if (t < 3) await new Promise((ok) => setTimeout(ok, 2000 * t));
    }
  }
  throw ultimo;
}

// ---------- anúncios ----------
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function unidadesDoTitulo(titulo) {
  const t = sem(titulo);
  const m = t.match(/\b(?:kit|atacado|caixa|pacote|combo)\s*(?:com\s*)?(\d{1,3})\b/) || t.match(/\b(\d{1,3})\s*(?:pecas|unidades|un)\b/);
  return m ? Math.max(1, Number(m[1])) : 1;
}
// sugestão de vínculo: produto da loja com mais palavras em comum com o título (cor pesa mais)
function sugerir(anuncio, produtos) {
  const palavras = new Set(sem(anuncio.titulo).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  let melhor = null, nota = 0;
  for (const p of produtos) {
    const ws = sem(`${p.nome} ${p.cor}`).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    let n = ws.filter((w) => palavras.has(w)).length;
    if (p.cor && palavras.has(sem(p.cor))) n += 2;
    if (n > nota) { nota = n; melhor = p; }
  }
  return nota >= 2 ? melhor : null;
}

async function sincronizarAnuncios() {
  const uid = (await acesso(), cfg.ml.tokens.usuario);
  const ids = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const r = await chamar('GET', `/users/${uid}/items/search?status=active&limit=100&offset=${offset}`);
    ids.push(...(r.results || []));
    if (!r.paging || offset + 100 >= r.paging.total) break;
  }
  const lista = [];
  for (let i = 0; i < ids.length; i += 20) {
    const r = await chamar('GET', `/items?ids=${ids.slice(i, i + 20).join(',')}&attributes=id,title,available_quantity,status,variations,permalink`);
    for (const x of r) {
      const it = x.body || {};
      if (it.variations && it.variations.length) {
        for (const v of it.variations) {
          const cor = (v.attribute_combinations || []).map((a) => a.value_name).join(' ');
          lista.push({ chave: `${it.id}:${v.id}`, item: it.id, varId: v.id, titulo: `${it.title}${cor ? ' · ' + cor : ''}`, quantidade: v.available_quantity, link: it.permalink });
        }
      } else lista.push({ chave: it.id, item: it.id, varId: 0, titulo: it.title, quantidade: it.available_quantity, link: it.permalink });
    }
  }
  dados.anuncios = lista;
  dados.atualizado = new Date().toISOString();
  gravar();
  evento(`${lista.length} anúncio(s) ativo(s) lidos da conta ${uid}`);
  return lista.length;
}

function estadoMl() {
  const produtos = loja.estadoLoja().produtos;
  return {
    appId: cfg.ml.appId, temSegredo: !!cfg.ml.segredo, retorno: cfg.ml.retorno, conectado: conectado(), usuario: cfg.ml.tokens?.usuario || null,
    baixarVendas: !!cfg.ml.baixarVendas, enviarEstoque: !!cfg.ml.enviarEstoque,
    anuncios: dados.anuncios.map((a) => {
      const v = dados.vinculos[a.chave];
      const sug = v ? null : sugerir(a, produtos);
      return { ...a, vinculo: v || null, sugestao: sug ? { chave: sug.chave, nome: `${sug.nome}${sug.cor ? ' ' + sug.cor : ''}`, unidades: unidadesDoTitulo(a.titulo) } : null };
    }),
    atualizado: dados.atualizado, ultimaConsulta: dados.ultimaConsulta, eventos: dados.eventos.slice(0, 30),
  };
}

function vincular({ anuncio, chave, unidades }) {
  if (!dados.anuncios.some((a) => a.chave === anuncio)) throw new Error('anúncio não encontrado; atualize a lista');
  if (!chave) { delete dados.vinculos[anuncio]; gravar(); return true; }
  if (!loja.produtoPorChave(chave)) throw new Error('produto da loja não encontrado; sincronize a loja');
  const u = Math.max(1, Math.min(999, Math.floor(Number(unidades) || 1)));
  dados.vinculos[anuncio] = { chave, unidades: u };
  gravar();
  return true;
}

// ---------- estoque da loja -> anúncios ----------
async function enviarEstoqueDoProduto(chaveProduto) {
  if (!cfg.ml.enviarEstoque || !conectado()) return;
  const p = loja.produtoPorChave(chaveProduto);
  if (!p || typeof p.estoque !== 'number') return; // estoque não controlado no site: não mexe no anúncio
  for (const [anuncio, v] of Object.entries(dados.vinculos)) {
    if (v.chave !== chaveProduto) continue;
    const a = dados.anuncios.find((x) => x.chave === anuncio);
    if (!a) continue;
    const qtd = Math.max(0, Math.floor(p.estoque / v.unidades));
    if (a.quantidade === qtd) continue;
    try {
      // anúncio sem estoque é pausado pelo próprio Mercado Livre e volta sozinho quando há estoque
      if (a.varId) await chamar('PUT', `/items/${a.item}/variations/${a.varId}`, { available_quantity: qtd });
      else await chamar('PUT', `/items/${a.item}`, { available_quantity: qtd });
      evento(`${a.item}: quantidade ${a.quantidade ?? '?'} para ${qtd} (${p.nome}${p.cor ? ' ' + p.cor : ''}: ${p.estoque} no site, ${v.unidades} por venda)`);
      a.quantidade = qtd;
    } catch (e) { evento(`${a.item}: não atualizou a quantidade (${e.message})`); }
  }
  gravar();
}
async function enviarTodos() {
  const chaves = [...new Set(Object.values(dados.vinculos).map((v) => v.chave))];
  for (const c of chaves) await enviarEstoqueDoProduto(c);
  return chaves.length;
}

// ---------- vendas -> estoque da loja ----------
let consultando = false;
async function consultarPedidos() {
  if (consultando || !cfg.ml.baixarVendas || !conectado()) return;
  consultando = true;
  try {
    const uid = cfg.ml.tokens.usuario;
    // começa da última consulta (na primeira vez, do momento em que foi ligado: não baixa vendas antigas)
    const desde = dados.ultimaConsulta || new Date().toISOString();
    const agora = new Date().toISOString();
    const r = await chamar('GET', `/orders/search?seller=${uid}&order.status=paid&order.date_last_updated.from=${encodeURIComponent(desde)}&sort=date_asc&limit=50`);
    for (const o of r.results || []) {
      if (dados.pedidosVistos[o.id]) continue; // cada pedido baixa uma vez só
      for (const it of o.order_items || []) {
        const chaveAnuncio = it.item.variation_id ? `${it.item.id}:${it.item.variation_id}` : it.item.id;
        const v = dados.vinculos[chaveAnuncio] || dados.vinculos[it.item.id];
        if (!v) { evento(`pedido ${o.id}: anúncio ${it.item.id} sem vínculo; estoque não baixado`); continue; }
        const qtd = it.quantity * v.unidades;
        try {
          const m = await loja.movimentar({ chave: v.chave, delta: -qtd, origem: `ML ${o.id}` });
          evento(`pedido ${o.id}: baixou ${qtd} de ${m.produto.nome}${m.produto.cor ? ' ' + m.produto.cor : ''} (${m.movimento.situacao})`);
        } catch (e) { evento(`pedido ${o.id}: não baixou o estoque (${e.message})`); }
      }
      dados.pedidosVistos[o.id] = agora;
    }
    // limpa a memória de pedidos com mais de 60 dias
    for (const [id, quando] of Object.entries(dados.pedidosVistos)) if (Date.now() - new Date(quando).getTime() > 60 * 86400000) delete dados.pedidosVistos[id];
    dados.ultimaConsulta = agora;
    gravar();
  } finally { consultando = false; }
}

function salvarConfig(novo) {
  if (typeof novo.appId === 'string' && novo.appId.trim()) cfg.ml.appId = novo.appId.trim();
  if (typeof novo.segredo === 'string' && novo.segredo.trim()) cfg.ml.segredo = novo.segredo.trim();
  if (typeof novo.retorno === 'string' && /^https:\/\/[^\s]+$/.test(novo.retorno.trim())) cfg.ml.retorno = novo.retorno.trim();
  if (typeof novo.baixarVendas === 'boolean') {
    if (novo.baixarVendas && !cfg.ml.baixarVendas) dados.ultimaConsulta = new Date().toISOString(); // só vendas daqui para frente
    cfg.ml.baixarVendas = novo.baixarVendas;
  }
  if (typeof novo.enviarEstoque === 'boolean') cfg.ml.enviarEstoque = novo.enviarEstoque;
  if (novo.desconectar) { cfg.ml.tokens = null; cfg.ml.baixarVendas = false; cfg.ml.enviarEstoque = false; }
  gravar();
  salvarCfg();
}

module.exports = { iniciar, aoSalvarConfig, urlAutorizacao, concluirAutorizacao, sincronizarAnuncios, vincular, enviarTodos, consultarPedidos, salvarConfig, estadoMl, unidadesDoTitulo, sugerir };
