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
