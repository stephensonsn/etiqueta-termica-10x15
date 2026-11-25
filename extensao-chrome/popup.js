'use strict';
const NOMES = { impressora: 'Impressora / ponte', etiqueta: 'Etiqueta com erro', pedido: 'Pedido parado', automacao: 'Automação parou' };
async function desenhar() {
  const { pendencias = [], conferido } = await chrome.storage.local.get(['pendencias', 'conferido']);
  const lista = document.getElementById('lista');
  lista.replaceChildren(...pendencias.map((p) => {
    const li = document.createElement('li');
    const b = document.createElement('b'); b.textContent = NOMES[p.tipo] || p.tipo;
    li.append(b, document.createTextNode(p.texto));
    return li;
  }));
  document.getElementById('vazio').hidden = pendencias.length > 0;
  const selo = document.getElementById('selo');
  selo.textContent = pendencias.length ? `${pendencias.length} pendência(s)` : 'Tudo certo';
  selo.className = 'selo ' + (pendencias.length ? 'erro' : 'ok');
  if (conferido) selo.title = 'Conferido às ' + new Date(conferido).toLocaleTimeString('pt-BR');
}
document.getElementById('painel').onclick = () => chrome.tabs.create({ url: 'http://127.0.0.1:9100/painel' });
document.getElementById('conferir').onclick = async () => {
  try {
    const r = await fetch('http://127.0.0.1:9100/api/pendencias', { cache: 'no-store' });
    const p = (await r.json()).pendencias || [];
    await chrome.storage.local.set({ pendencias: p, conferido: Date.now() });
  } catch (_) { await chrome.storage.local.set({ pendencias: [{ tipo: 'impressora', texto: 'A ponte da impressora não está respondendo neste computador' }], conferido: Date.now() }); }
  desenhar();
};
desenhar();

// ---------- Impressão automática do TikTok: ligar/desligar daqui também ----------
// O quadrinho com Ligar/Desligar só aparece no TikTok se a extensão tiver acesso ao site. O Chrome
// pode deixar esse acesso "ao clicar" (25/11/2026: o quadrinho sumiu e não havia como ligar/desligar).
const TIKTOK = 'https://seller-br.tiktok.com/*';
const URL_PEDIDOS = 'https://seller-br.tiktok.com/order?order_status[]=1&selected_sort=1&tab=to_ship';
async function desenharTikTok() {
  const sec = document.getElementById('tiktok');
  const est = document.getElementById('ttEstado');
  const bt = document.getElementById('ttBotao');
  let acesso = true;
  try { acesso = await chrome.permissions.contains({ origins: [TIKTOK] }); } catch (_) { /* Chrome antigo */ }
  sec.classList.toggle('sem-acesso', !acesso);
  bt.className = '';
  if (!acesso) {
    est.textContent = 'A extensão está sem acesso ao TikTok Shop, por isso o quadrinho sumiu.';
    bt.textContent = 'Permitir';
    bt.classList.add('prim');
    bt.onclick = async () => {
      let ok = false;
      try { ok = await chrome.permissions.request({ origins: [TIKTOK] }); } catch (_) { /* recusado */ }
      if (ok) { try { for (const t of await chrome.tabs.query({ url: TIKTOK })) chrome.tabs.reload(t.id); } catch (_) { /* nada */ } }
      desenharTikTok();
    };
    return;
  }
  const { ttAuto } = await chrome.storage.local.get('ttAuto');
  const lig = !!(ttAuto && ttAuto.dono);
  est.textContent = lig ? 'Ligada: emite a nota e imprime os pedidos novos.' : 'Desligada: não emite nota nem imprime.';
  bt.textContent = lig ? 'Desligar' : 'Ligar';
  bt.classList.add(lig ? 'desl' : 'prim');
  bt.onclick = async () => {
    if (lig) { await chrome.storage.local.remove('ttAuto'); return desenharTikTok(); }
    // uma aba do TikTok aberta assume; sem nenhuma aberta, abre Pedidos > Para enviar
    await chrome.storage.local.set({ ttAuto: { dono: 'icone', quando: Date.now() } });
    let abertas = [];
    try { abertas = await chrome.tabs.query({ url: TIKTOK }); } catch (_) { /* nada */ }
    if (!abertas.length) chrome.tabs.create({ url: URL_PEDIDOS });
    desenharTikTok();
  };
}
try { chrome.storage.onChanged.addListener((m, a) => { if (a === 'local' && m.ttAuto) desenharTikTok(); }); } catch (_) { /* nada */ }
desenharTikTok();
