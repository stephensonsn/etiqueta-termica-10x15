// TikTok Shop (Seller Center Brasil): com a impressão automática ligada nesta aba, quando a janela "Imprimir resultado" aparece com os arquivos
// de etiqueta em ZPL (.txt), clica sozinho em "Baixar todos os arquivos". O arquivo cai em Downloads
// e a ponte local (Etiqueta Térmica 10x15) imprime na térmica: uma etiqueta por venda, com a DANFE.
// Não envia nada para fora do computador e não mexe em pedido: só faz o clique de baixar.
(() => {
  'use strict';
  // o TikTok reaproveita a mesma janela: o que já foi baixado é lembrado pelos nomes dos arquivos
  const jaBaixados = new Set();
  const assinatura = (d) => ((d.innerText || '').match(/[\w-]+_(Shipping label|NF-e|Packing slip)\.txt/gi) || []).join('|');

  function janelaDeResultado() {
    // a janela tem o título "Imprimir resultado" e a lista de arquivos .txt gerados
    for (const d of document.querySelectorAll('[role="dialog"], .arco-modal, [class*="modal"]')) {
      const t = d.innerText || '';
      if (/Imprimir resultado/i.test(t) && /\.txt/i.test(t) && /(Shipping label|NF-e|Packing slip)/i.test(t)) return d;
    }
    return null;
  }

  function botaoBaixarTodos(d) {
    return [...d.querySelectorAll('button')].find((b) => /Baixar todos os arquivos/i.test(b.innerText || ''));
  }

  // só baixa quando a impressão automática está ligada NESTA aba (desligada = não imprime nada)
  let dono = null;
  const meuId = () => { try { return sessionStorage.getItem('etiqueta-termica-auto-id'); } catch (_) { return null; } };
  try {
    chrome.storage.local.get('ttAuto').then((r) => { dono = (r.ttAuto || {}).dono || null; });
    chrome.storage.onChanged.addListener((m, area) => { if (area === 'local' && m.ttAuto) dono = (m.ttAuto.newValue || {}).dono || null; });
  } catch (_) { /* extensão recarregada */ }
  const ligadaAqui = () => dono !== null && dono === meuId();

  function verificar() {
    if (!ligadaAqui()) return;
    const d = janelaDeResultado();
    if (!d) return;
    const nomes = assinatura(d);
    if (!nomes || jaBaixados.has(nomes)) return;
    const b = botaoBaixarTodos(d);
    if (!b || b.disabled) return;
    jaBaixados.add(nomes);
    b.click();
    // aviso discreto dentro da própria janela
    const aviso = document.createElement('div');
    aviso.textContent = 'Enviado para a impressora térmica (Etiqueta Térmica 10x15).';
    aviso.style.cssText = 'margin:8px 0;padding:8px 12px;border-radius:8px;background:#DCFCE7;color:#166534;font:600 13px/1.4 -apple-system,sans-serif';
    b.parentElement && b.parentElement.insertAdjacentElement('afterend', aviso);
  }

  new MutationObserver(() => verificar()).observe(document.documentElement, { childList: true, subtree: true });
  verificar();
})();
