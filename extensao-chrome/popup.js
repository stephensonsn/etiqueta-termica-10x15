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
// Menu da ponte: abre o app (ou reaproveita a aba dele já aberta) direto na tela escolhida.
const APP = 'http://127.0.0.1:9100';
async function abrir(rota) {
  const url = APP + rota;
  try {
    const [aba] = await chrome.tabs.query({ url: APP + '/*' });
    if (aba) { await chrome.tabs.update(aba.id, { url, active: true }); await chrome.windows.update(aba.windowId, { focused: true }); return window.close(); }
  } catch (_) { /* sem permissão de abas: abre nova */ }
  chrome.tabs.create({ url });
  window.close();
}
document.querySelectorAll('[data-ir]').forEach((a) => { a.onclick = () => abrir(a.dataset.ir); });
document.getElementById('painel').onclick = () => abrir('/');
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
  est.textContent = lig ? 'Ligada: emite a nota e imprime os pedidos novos, na aba fixada da automação.' : 'Desligada: não emite nota nem imprime.';
  bt.textContent = lig ? 'Desligar' : 'Ligar';
  bt.classList.add(lig ? 'desl' : 'prim');
  bt.onclick = async () => {
    if (lig) { await chrome.storage.local.remove('ttAuto'); return desenharTikTok(); }
    // o background abre a aba própria da automação (fixada, em segundo plano); nenhuma outra aba muda
    await chrome.storage.local.set({ ttAuto: { dono: 'icone', quando: Date.now() } });
    desenharTikTok();
  };
}
try { chrome.storage.onChanged.addListener((m, a) => { if (a === 'local' && m.ttAuto) desenharTikTok(); }); } catch (_) { /* nada */ }
desenharTikTok();
