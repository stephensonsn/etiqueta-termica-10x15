// captura.js (página do TikTok): o download de "<data>_Shipping label.txt" não acontece; o conteúdo é
// lido pelo link e entregue à extensão. Se a extensão disser que a ponte não aceitou, baixa como antes.
// Download de outro arquivo qualquer segue normal.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const codigo = fs.readFileSync(path.join(__dirname, '..', 'extensao-chrome', 'captura.js'), 'utf8');
const baixados = []; const mensagens = []; const ouvintes = [];
class EventTarget { dispatchEvent(ev) { if (this.hasAttribute && this.hasAttribute('download')) baixados.push(this.download || this.getAttribute('download')); return true; } }
class HTMLAnchorElement extends EventTarget {
  constructor() { super(); this.attrs = {}; this.href = ''; this.style = {}; }
  set download(v) { this.attrs.download = v; } get download() { return this.attrs.download; }
  hasAttribute(k) { return k in this.attrs; } getAttribute(k) { return this.attrs[k]; } setAttribute(k, v) { this.attrs[k] = v; }
  click() { baixados.push(this.attrs.download); } remove() {}
}
const ctx = {
  location: { origin: 'https://seller-br.tiktok.com' }, EventTarget, HTMLAnchorElement, Map, Promise, Error, setTimeout, clearTimeout,
  document: { createElement: () => new HTMLAnchorElement(), body: { appendChild() {} } },
  fetch: async (url) => ({ ok: true, text: async () => (url.includes('zpl') ? '^XA^FDteste^FS^XZ' : 'nada') }),
  addEventListener: (t, f) => ouvintes.push(f),
  postMessage: (d) => mensagens.push(d),
};
ctx.window = ctx;
vm.runInNewContext(codigo, ctx);
const ancora = (nome, href) => { const a = new HTMLAnchorElement(); a.setAttribute('download', nome); a.href = href; return a; };
const responder = (ids, ok) => ouvintes.forEach((f) => f({ source: vm.runInContext('window', ctx), data: { __etiqueta: 'resposta', ids, ok } }));
const tique = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  // etiqueta: não baixa, entrega o conteúdo
  ctx.EventTarget.prototype.dispatchEvent.call(ancora('11-25_22-59-38_Shipping label.txt', 'https://x/zpl1'), { type: 'click' });
  await tique();
  assert.deepEqual(baixados, [], 'não baixou');
  assert.equal(mensagens.length, 1); assert.equal(mensagens[0].__etiqueta, 'arquivo'); assert.match(mensagens[0].conteudo, /\^XA/);
  responder([mensagens[0].id], true); await tique();
  assert.deepEqual(baixados, [], 'ponte aceitou: continua sem baixar');

  // ponte recusou: baixa como antes
  ancora('11-25_22-59-38_NF-e.txt', 'https://x/zpl2').click();
  await tique();
  responder([mensagens[1].id], false); await tique();
  assert.deepEqual(baixados, ['11-25_22-59-38_NF-e.txt'], 'recusa = baixa como antes');

  // conteúdo sem ZPL: baixa como antes, sem mandar nada
  ancora('11-25_22-59-38_Packing slip.txt', 'https://x/outro').click(); await tique();
  assert.equal(mensagens.length, 2); assert.equal(baixados[1], '11-25_22-59-38_Packing slip.txt');

  // outro download qualquer não é tocado
  ancora('relatorio.xlsx', 'https://x/zpl3').click();
  assert.equal(baixados[2], 'relatorio.xlsx'); assert.equal(mensagens.length, 2);
  console.log('ok: captura.js entrega a etiqueta sem baixar e baixa como antes se a ponte recusar');
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
