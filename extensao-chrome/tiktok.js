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

  // Endereço em campos (rua, número, complemento, bairro, cidade, UF, CEP) dos pedidos desta tela, com o
  // rastreio, para a ponte escrever rua e número antes do complemento. Vale também para impressão feita
  // à mão. Telefone e e-mail não saem daqui.
  const enderecoEnviado = new Set();
  async function mandarEnderecos() {
    const ids = new Set();
    const m = location.href.match(/order_no=(\d{18})/); if (m) ids.add(m[1]);
    for (const el of document.querySelectorAll('a, span, div')) { const t = (el.innerText || el.textContent || '').trim(); if (/^\d{18}$/.test(t)) ids.add(t); }
    const lista = [...ids].filter((id) => !enderecoEnviado.has(id)).slice(0, 50);
    if (!lista.length) return;
    for (let tentativa = 0; tentativa < 12 && lista.length; tentativa++) {
      try {
        const r = await fetch('/api/fulfillment/order/get?aid=4068&locale=pt-BR', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ main_order_id: lista }) });
        const j = await r.json();
        const saida = [];
        for (const o of (j && j.data && j.data.main_order) || []) {
          const rastreio = ((o.delivery_module || [])[0] || {}).tracking_no;
          if (!rastreio) continue;
          const c = Object.fromEntries((((o.buyer_info_module || {}).shipping_address || {}).items || []).map((i) => [i.key, i.value]));
          saida.push({ rastreio, rua: c.street_name, numero: c.street_number, complemento: c.address_detail, bairro: c.neighborhood, cidade: c.geo_l2, uf: c.geo_l1, cep: c.zipcode });
          enderecoEnviado.add(String(o.main_order_id));
          lista.splice(lista.indexOf(String(o.main_order_id)), 1);
        }
        if (saida.length) chrome.runtime.sendMessage({ tipo: 'enderecos', lista: saida });
      } catch (_) { /* tenta de novo */ }
      if (lista.length) await new Promise((ok) => setTimeout(ok, 2500));
    }
  }
  let janelaVista = false;

  function verificar() {
    const aberta = !!janelaDeResultado();
    if (aberta && !janelaVista) mandarEnderecos(); // etiqueta criada (automática ou à mão): manda os endereços
    janelaVista = aberta;
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
