// Roda dentro da página do TikTok (mundo da página). Quando o TikTok vai baixar os arquivos de etiqueta
// ("<data>_Shipping label.txt", "_NF-e.txt", "_Packing slip.txt"), lê o conteúdo pelo mesmo link e entrega
// para a extensão mandar direto à ponte local: nada cai em Downloads. Se a ponte não aceitar, baixa
// como antes (o arquivo cai em Downloads e a ponte imprime pela pasta).
(() => {
  'use strict';
  if (window.__etiquetaCaptura) return;
  window.__etiquetaCaptura = true;
  const ARQ = /_(Shipping label|NF-e|Packing slip)( \(\d+\))?\.txt$/i;
  const disparar = EventTarget.prototype.dispatchEvent;
  const clicar = HTMLAnchorElement.prototype.click;
  const pendentes = new Map(); // id -> { nome, href }
  let seq = 0;

  function baixarComoAntes(p) {
    const a = document.createElement('a');
    a.href = p.href; a.download = p.nome; a.style.display = 'none';
    document.body.appendChild(a); clicar.call(a); setTimeout(() => a.remove(), 1000);
  }

  function capturar(a) {
    const nome = a.getAttribute('download') || '';
    if (!ARQ.test(nome) || !a.href) return false;
    const id = ++seq;
    const p = { nome, href: a.href };
    pendentes.set(id, p);
    fetch(a.href, { credentials: 'include' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then((conteudo) => {
        if (!/\^XA/i.test(conteudo)) throw new Error('sem ZPL');
        window.postMessage({ __etiqueta: 'arquivo', id, nome, conteudo }, location.origin);
        // sem resposta da extensão em 20 s (extensão recarregada, ponte fora): baixa como antes
        setTimeout(() => { if (pendentes.has(id)) { pendentes.delete(id); baixarComoAntes(p); } }, 20000);
      })
      .catch(() => { pendentes.delete(id); baixarComoAntes(p); });
    return true;
  }

  EventTarget.prototype.dispatchEvent = function (ev) {
    if (this instanceof HTMLAnchorElement && ev && ev.type === 'click' && this.hasAttribute('download') && capturar(this)) return true;
    return disparar.call(this, ev);
  };
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && capturar(this)) return;
    return clicar.call(this);
  };

  // resposta da extensão: ok = a ponte recebeu; senão baixa como antes
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.__etiqueta !== 'resposta') return;
    for (const id of d.ids || []) {
      const p = pendentes.get(id); if (!p) continue;
      pendentes.delete(id);
      if (!d.ok) baixarComoAntes(p);
    }
  });
})();
