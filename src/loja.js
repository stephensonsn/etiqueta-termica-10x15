// Integração com a loja virtual (WordPress + WooCommerce): produtos, código de barras e estoque.
//
// A fonte da verdade do estoque é o site. Esta ponte:
//  - importa os produtos (e as variações, como cores) com SKU, código de barras e estoque;
//  - no bipe do leitor de código de barras, lê o estoque atual no site, soma ou subtrai e grava de volta;
//  - guarda o código de barras no campo próprio do WooCommerce ("GTIN, UPC, EAN ou ISBN");
//  - se o site estiver fora do ar, guarda o movimento e reenvia sozinho depois (cada movimento uma vez só).
//
// Sem chave de acesso, só lê o catálogo público (sem quantidade em estoque).
// As chaves ficam só no config.json deste computador (fora do git).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ean = require('./ean13');

let cfg, log, RAIZ;
const ARQ = () => path.join(RAIZ, 'logs', 'loja.json'); // dados da loja (sem dados de clientes)
let dados = { produtos: [], movimentos: [], pendentes: [], atualizado: '', erro: '' };

function iniciar(contexto) {
  ({ cfg, log, RAIZ } = contexto);
  if (!cfg.loja) cfg.loja = { url: '', chave: '', segredo: '' };
  try { dados = { ...dados, ...JSON.parse(fs.readFileSync(ARQ(), 'utf8')) }; } catch (_) { /* primeira vez */ }
  setInterval(() => { reenviarPendentes().catch(() => {}); }, 60000);
}
function gravar() { try { fs.writeFileSync(ARQ(), JSON.stringify(dados)); } catch (e) { log(`loja: não gravou ${e.message}`); } }

const temChave = () => !!(cfg.loja.url && cfg.loja.chave && cfg.loja.segredo);
const base = () => cfg.loja.url.replace(/\/+$/, '');

// Chamada à API com tempo máximo e nova tentativa com espera crescente (3 tentativas).
async function chamar(metodo, caminho, corpo, { publico = false } = {}) {
  const url = base() + caminho;
  const cab = { 'Content-Type': 'application/json', 'User-Agent': 'etiqueta-termica-10x15' };
  if (!publico) cab.Authorization = 'Basic ' + Buffer.from(`${cfg.loja.chave}:${cfg.loja.segredo}`).toString('base64');
  let ultimo;
  for (let t = 1; t <= 3; t++) {
    const ctl = new AbortController();
    const relogio = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch(url, { method: metodo, headers: cab, body: corpo ? JSON.stringify(corpo) : undefined, signal: ctl.signal });
      const txt = await r.text();
      let j; try { j = JSON.parse(txt); } catch (_) { j = txt; }
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error('a loja recusou a chave de acesso (confira a chave, o segredo e a permissão de leitura e escrita)'), { definitivo: true });
      if (r.status === 404) throw Object.assign(new Error(`não encontrado na loja: ${caminho.split('?')[0]}`), { definitivo: true });
      if (r.status >= 400 && r.status < 500) throw Object.assign(new Error((j && j.message) || `a loja recusou (${r.status})`), { definitivo: true });
      if (r.status >= 500) throw new Error(`a loja respondeu com erro ${r.status}`);
      return { dados: j, total: Number(r.headers.get('x-wp-totalpages') || 1) };
    } catch (e) {
      ultimo = e.name === 'AbortError' ? new Error('a loja não respondeu em 20 s') : e;
      if (ultimo.definitivo) break;
      if (t < 3) await new Promise((ok) => setTimeout(ok, 1500 * t));
    } finally { clearTimeout(relogio); }
  }
  throw ultimo;
}

// ---------- produtos ----------
function corDe(attrs) {
  const a = (attrs || []).find((x) => /cor|color/i.test(x.name || '')) || (attrs || [])[0];
  return a ? (a.option || (a.options || [])[0] || '') : '';
}

async function sincronizar() {
  if (!cfg.loja.url) throw new Error('informe o endereço da loja');
  const lista = [];
  if (temChave()) {
    for (let pg = 1; pg <= 20; pg++) {
      const { dados: ps, total } = await chamar('GET', `/wp-json/wc/v3/products?per_page=100&page=${pg}&status=any`);
      for (const p of ps) {
        if (p.type === 'variable') {
          const { dados: vs } = await chamar('GET', `/wp-json/wc/v3/products/${p.id}/variations?per_page=100`);
          for (const v of vs) {
            lista.push({ chave: `${p.id}:${v.id}`, id: p.id, varId: v.id, nome: p.name, cor: corDe(v.attributes), sku: v.sku || '', barcode: v.global_unique_id || '', estoque: v.manage_stock ? v.stock_quantity : null, preco: v.price || '' });
          }
        } else {
          lista.push({ chave: String(p.id), id: p.id, varId: 0, nome: p.name, cor: corDe(p.attributes), sku: p.sku || '', barcode: p.global_unique_id || '', estoque: p.manage_stock ? p.stock_quantity : null, preco: p.price || '' });
        }
      }
      if (pg >= total) break;
    }
  } else {
    // sem chave: catálogo público (não traz quantidade nem código de barras)
    const { dados: ps } = await chamar('GET', '/wp-json/wc/store/v1/products?per_page=100', null, { publico: true });
    for (const p of ps) lista.push({ chave: String(p.id), id: p.id, varId: 0, nome: p.name, cor: '', sku: p.sku || '', barcode: '', estoque: null, preco: '' });
  }
  // mantém códigos de barras que só existem aqui (gerados antes de existir a chave) e, se já houver
  // chave, grava esses códigos no site
  const antigos = new Map(dados.produtos.map((p) => [p.chave, p]));
  for (const p of lista) {
    const a = antigos.get(p.chave);
    if (p.barcode || !a?.barcode) continue;
    p.barcode = a.barcode; p.soAqui = true;
    if (temChave()) {
      try { await chamar('PUT', caminhoDe(p), { global_unique_id: p.barcode }); p.soAqui = false; }
      catch (e) { log(`loja: código ${p.barcode} de ${p.nome} não foi para o site (${e.message})`); }
    }
  }
  dados.produtos = lista;
  dados.atualizado = new Date().toISOString();
  dados.erro = '';
  gravar();
  log(`loja: ${lista.length} produto(s) sincronizado(s) ${temChave() ? 'com estoque' : 'pelo catálogo público (sem chave)'}`);
  return lista.length;
}

const normal = (s) => String(s || '').trim().toUpperCase();
function acharPorCodigo(codigo) {
  const c = normal(codigo);
  return dados.produtos.find((p) => normal(p.barcode) === c) || dados.produtos.find((p) => normal(p.sku) === c);
}

const caminhoDe = (p) => (p.varId ? `/wp-json/wc/v3/products/${p.id}/variations/${p.varId}` : `/wp-json/wc/v3/products/${p.id}`);

// lê o estoque atual no site e grava o novo (lido na hora para não apagar vendas feitas no site)
async function aplicarNoSite(p, delta) {
  const { dados: atual } = await chamar('GET', caminhoDe(p));
  const antes = atual.manage_stock ? Number(atual.stock_quantity || 0) : 0;
  const depois = antes + delta;
  if (depois < 0) throw Object.assign(new Error(`estoque no site é ${antes}; não dá para tirar ${-delta}`), { definitivo: true });
  await chamar('PUT', caminhoDe(p), { manage_stock: true, stock_quantity: depois });
  return { antes, depois };
}

// Bipe do leitor: consulta, entrada (+) ou saída (-)
async function bipar({ codigo, modo = 'consulta', qtd = 1 }) {
  const p = acharPorCodigo(codigo);
  if (!p) return { achou: false, codigo };
  qtd = Math.max(1, Math.min(9999, Math.floor(Number(qtd) || 1)));
  if (modo === 'consulta') return { achou: true, produto: p };
  if (!temChave()) throw new Error('para mexer no estoque, ligue a loja com a chave de acesso');
  const delta = modo === 'saida' ? -qtd : qtd;
  const mov = { idMov: crypto.randomUUID(), hora: new Date().toISOString(), codigo: normal(codigo), chave: p.chave, nome: p.nome, cor: p.cor, delta };
  try {
    const r = await aplicarNoSite(p, delta);
    p.estoque = r.depois;
    Object.assign(mov, { de: r.antes, para: r.depois, situacao: 'gravado' });
  } catch (e) {
    if (e.definitivo) throw e;
    // site fora do ar: guarda e reenvia depois
    mov.situacao = 'pendente';
    dados.pendentes.push(mov);
    log(`loja: movimento guardado para reenviar (${e.message})`);
  }
  dados.movimentos.unshift(mov);
  dados.movimentos = dados.movimentos.slice(0, 500);
  gravar();
  if (mov.situacao === 'gravado') aoMudarEstoque(p);
  return { achou: true, produto: p, movimento: mov };
}

// Movimento por chave do produto (usado pelas vendas do Mercado Livre). Saída que deixaria o
// estoque negativo para em zero e fica registrada, em vez de travar a baixa do pedido.
async function movimentar({ chave, delta, origem = '' }) {
  const p = dados.produtos.find((x) => x.chave === chave);
  if (!p) throw new Error('produto não encontrado na loja');
  if (!temChave()) throw new Error('loja sem chave de acesso');
  const mov = { idMov: crypto.randomUUID(), hora: new Date().toISOString(), codigo: origem, chave: p.chave, nome: p.nome, cor: p.cor, delta };
  try {
    let r;
    try { r = await aplicarNoSite(p, delta); }
    catch (e) {
      if (!(e.definitivo && delta < 0 && /não dá para tirar/.test(e.message))) throw e;
      const { dados: atual } = await chamar('GET', caminhoDe(p));
      const antes = atual.manage_stock ? Number(atual.stock_quantity || 0) : 0;
      await chamar('PUT', caminhoDe(p), { manage_stock: true, stock_quantity: 0 });
      r = { antes, depois: 0 };
      mov.aviso = `vendeu ${-delta}, havia ${antes} no site`;
    }
    p.estoque = r.depois;
    Object.assign(mov, { de: r.antes, para: r.depois, situacao: mov.aviso ? `gravado (${mov.aviso})` : 'gravado' });
  } catch (e) {
    if (e.definitivo) throw e;
    mov.situacao = 'pendente';
    dados.pendentes.push(mov);
  }
  dados.movimentos.unshift(mov);
  dados.movimentos = dados.movimentos.slice(0, 500);
  gravar();
  aoMudarEstoque(p);
  return { produto: p, movimento: mov };
}

const ouvintes = [];
function quandoMudarEstoque(fn) { ouvintes.push(fn); }
function aoMudarEstoque(p) { for (const fn of ouvintes) Promise.resolve().then(() => fn(p)).catch((e) => log(`loja: aviso de estoque falhou: ${e.message}`)); }
const produtoPorChave = (chave) => dados.produtos.find((x) => x.chave === chave);

let reenviando = false;
async function reenviarPendentes() {
  if (reenviando || !dados.pendentes.length || !temChave()) return;
  reenviando = true;
  try {
    for (const mov of [...dados.pendentes]) {
      const p = dados.produtos.find((x) => x.chave === mov.chave);
      if (!p) continue;
      try {
        const r = await aplicarNoSite(p, mov.delta);
        p.estoque = r.depois;
        Object.assign(mov, { de: r.antes, para: r.depois, situacao: 'gravado' });
        const m = dados.movimentos.find((x) => x.idMov === mov.idMov);
        if (m) Object.assign(m, mov);
        dados.pendentes = dados.pendentes.filter((x) => x.idMov !== mov.idMov);
        log(`loja: movimento pendente gravado (${mov.nome} ${mov.delta > 0 ? '+' : ''}${mov.delta})`);
        aoMudarEstoque(p);
      } catch (e) {
        if (e.definitivo) { mov.situacao = `recusado: ${e.message}`; dados.pendentes = dados.pendentes.filter((x) => x.idMov !== mov.idMov); }
        else break; // site ainda fora: tenta de novo no próximo minuto
      }
    }
  } finally { reenviando = false; gravar(); }
}

// grava o código de barras no campo GTIN/EAN do produto no site
async function definirCodigo({ chave, barcode }) {
  const p = dados.produtos.find((x) => x.chave === chave);
  if (!p) throw new Error('produto não encontrado; sincronize a loja');
  const codigo = String(barcode || '').trim();
  if (!/^[0-9A-Za-z-]{4,20}$/.test(codigo)) throw new Error('código de barras inválido (4 a 20 letras ou números)');
  if (/^\d{13}$/.test(codigo) && ean.problema(codigo)) throw new Error(`EAN-13 com ${ean.problema(codigo)}`);
  const outro = dados.produtos.find((x) => x.chave !== chave && normal(x.barcode) === normal(codigo));
  if (outro) throw new Error(`esse código já é do produto ${outro.nome}${outro.cor ? ' ' + outro.cor : ''}`);
  p.soAqui = !temChave();
  if (temChave()) await chamar('PUT', caminhoDe(p), { global_unique_id: codigo });
  p.barcode = codigo;
  gravar();
  return p;
}

// Gera EAN-13 interno (200 + sequência + verificador) para os produtos sem EAN-13 válido.
// Idempotente: quem já tem EAN-13 válido não muda; rodar de novo só pega quem ainda falta.
async function gerarEan13({ chaves } = {}) {
  const alvo = dados.produtos.filter((p) => (!chaves || chaves.includes(p.chave)) && !ean.valido(p.barcode));
  const gerados = [];
  for (const p of alvo) {
    const codigo = ean.proximoInterno(dados.produtos.map((x) => x.barcode));
    const antes = p.barcode;
    p.barcode = codigo; p.soAqui = true;
    gravar(); // grava a cada um: se cair no meio, o próximo não repete número
    if (temChave()) {
      try { await chamar('PUT', caminhoDe(p), { global_unique_id: codigo }); p.soAqui = false; }
      catch (e) { log(`loja: EAN ${codigo} de ${p.nome} ficou só neste computador (${e.message})`); }
    }
    gerados.push({ chave: p.chave, nome: p.nome, cor: p.cor, de: antes || '', para: codigo });
  }
  gravar();
  if (gerados.length) log(`loja: ${gerados.length} EAN-13 interno(s) gerado(s)${temChave() ? '' : ' (ficam neste computador até ligar a chave da loja)'}`);
  return { gerados, ...estadoLoja() };
}

function salvarConfig({ url, chave, segredo }) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (u && !/^https:\/\/[a-z0-9.-]+(\/[^\s]*)?$/i.test(u)) throw new Error('endereço da loja inválido (use https://...)');
  cfg.loja.url = u;
  if (chave !== undefined && chave !== '') cfg.loja.chave = String(chave).trim();
  if (segredo !== undefined && segredo !== '') cfg.loja.segredo = String(segredo).trim();
  if (chave === null) { cfg.loja.chave = ''; cfg.loja.segredo = ''; }
  return true;
}

function estadoLoja() {
  return {
    url: cfg.loja.url, temChave: temChave(),
    produtos: dados.produtos, movimentos: dados.movimentos.slice(0, 40), pendentes: dados.pendentes.length,
    atualizado: dados.atualizado, erro: dados.erro,
  };
}

module.exports = { movimentar, quandoMudarEstoque, produtoPorChave, iniciar, sincronizar, bipar, definirCodigo, gerarEan13, salvarConfig, estadoLoja, reenviarPendentes };
