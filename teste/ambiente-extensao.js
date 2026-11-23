// Ambiente falso para testar a automação do TikTok (extensao-chrome/automatico.js) sem navegador:
// DOM mínimo controlável (texto da página e linhas de pedido), relógio virtual (espera de 60 s
// roda na hora), fetch e mensagens da extensão simulados, localStorage/sessionStorage em memória.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// objeto que aceita qualquer leitura, chamada e escrita (painel do quadrinho)
function falso() {
  const f = function () { return falso(); };
  return new Proxy(f, {
    get: (_, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined;
      if (k === Symbol.iterator) return function* () {};
      return falso();
    },
    set: () => true, apply: () => falso(), construct: () => falso(),
  });
}
const armazenamento = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m }; };

// elemento falso com pai, filhos e texto
function el(tag, texto = '', filhos = []) {
  const e = { tagName: tag, filhos, parentElement: null, _texto: texto, type: tag === 'input' ? 'checkbox' : '', checked: false };
  for (const f of filhos) f.parentElement = e;
  Object.defineProperty(e, 'innerText', { get: () => [e._texto, ...e.filhos.map((f) => f.innerText)].filter(Boolean).join('\n') });
  Object.defineProperty(e, 'textContent', { get: () => e.innerText });
  e.children = filhos;
  e.todos = () => filhos.flatMap((f) => [f, ...f.todos()]);
  e.querySelector = (sel) => (sel.startsWith('input') ? e.todos().find((x) => x.tagName === 'input') || null : null);
  e.querySelectorAll = () => e.todos();
  e.getClientRects = () => [1];
  e.closest = () => null;
  e.click = () => { e.checked = !e.checked; };
  return e;
}
// linha de pedido como o TikTok desenha: caixa de seleção + número do pedido + status da NF-e
const linhaPedido = (pedido, status) => el('div', '', [el('input'), el('span', pedido), el('span', 'Aguardando envio'), el('span', status)]);

function criar(opcoes = {}) {
  let agora = 1_800_000_000_000;
  const inicio = agora;
  // o teste define a tela em função do tempo (ms desde o começo): { texto, linhas }
  const tela = { cenario: () => ({ texto: '', linhas: [] }) };
  const atual = () => tela.cenario(agora - inicio);
  const corpo = {
    appendChild() {}, get innerText() { const t = atual(); return [t.texto, ...t.linhas.map((l) => l.innerText)].join('\n'); },
  };
  Object.defineProperty(corpo, 'textContent', { get: () => corpo.innerText });
  const documento = {
    body: corpo,
    createElement: () => falso(),
    querySelectorAll: () => atual().linhas.flatMap((l) => [l, ...l.todos()]),
    addEventListener() {}, dispatchEvent() {},
  };
  const DataFalsa = class extends Date { constructor(...a) { super(...(a.length ? a : [agora])); } static now() { return agora; } };
  const chamadas = { fetch: [], mensagens: [] };
  const armazem = typeof opcoes.armazem === 'function' ? opcoes.armazem(agora) : (opcoes.armazem || {});
  const ctl = {
    tela, chamadas, linhaPedido,
    respostaFetch: async () => ({ code: 0, data: {} }),
    respostaMensagem: () => null,
  };
  const ctx = {
    __TESTE__: true,
    document: documento,
    location: { href: 'https://seller-br.tiktok.com/order?order_status[]=1&selected_sort=1&tab=to_ship' },
    sessionStorage: armazenamento(), localStorage: armazenamento(),
    chrome: {
      // chrome.storage.local em memória (o teste pode começar com algo gravado: opcoes.armazem)
      storage: { local: {
        get: (k) => Promise.resolve(k in armazem ? { [k]: JSON.parse(JSON.stringify(armazem[k])) } : {}),
        set: (o) => { Object.assign(armazem, JSON.parse(JSON.stringify(o))); return Promise.resolve(); },
        remove: (k) => { delete armazem[k]; return Promise.resolve(); },
      }, onChanged: { addListener() {} } },
      runtime: { sendMessage: (msg, cb) => { chamadas.mensagens.push(msg); if (cb) cb(ctl.respostaMensagem(msg)); } },
    },
    // relógio virtual: cada espera avança o relógio e roda logo em seguida
    setTimeout: (fn, ms = 0) => { setImmediate(() => { agora += ms; fn(); }); return 0; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: async (url, opt = {}) => { const corpoReq = opt.body ? JSON.parse(opt.body) : null; chamadas.fetch.push({ url, corpo: corpoReq }); const j = await ctl.respostaFetch(url, corpoReq); return { status: 200, json: async () => j }; },
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    KeyboardEvent: function () {},
    console, Promise, JSON, Math, Object, Array, Set, Map, Number, String, RegExp, Error, Date: DataFalsa,
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'extensao-chrome', 'automatico.js'), 'utf8');
  vm.runInNewContext(codigo, ctx, { filename: 'automatico.js' });
  if (!ctx.__teste) throw new Error('automatico.js não expôs as funções de teste');
  ctl.f = ctx.__teste;
  ctl.ctx = ctx;
  ctl.agora = () => agora;
  ctl.decorrido = () => agora - inicio;
  ctl.avancar = (ms) => { agora += ms; };
  ctl.armazem = armazem;
  return ctl;
}

module.exports = { criar, el, linhaPedido, falso };
