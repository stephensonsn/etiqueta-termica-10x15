// Ícone com pendências: consulta a ponte local a cada minuto e mostra quantas há, em vermelho.
// Pendência = impressora/ponte com problema, etiqueta com erro na fila, pedido parado (sem NF-e)
// ou automação que parou (Mercado Livre na ponte; TikTok avisa por mensagem desta extensão).
'use strict';
const PONTE = 'http://127.0.0.1:9100';

async function atualizar() {
  let lista;
  try {
    const r = await fetch(`${PONTE}/api/pendencias`, { cache: 'no-store' });
    lista = (await r.json()).pendencias || [];
  } catch (_) {
    lista = [{ tipo: 'impressora', texto: 'A ponte da impressora não está respondendo neste computador' }];
  }
  await chrome.storage.local.set({ pendencias: lista, conferido: Date.now() });
  await chrome.action.setBadgeBackgroundColor({ color: lista.length ? '#DC2626' : '#16A34A' });
  await chrome.action.setBadgeText({ text: lista.length ? String(Math.min(lista.length, 99)) : '' });
  await chrome.action.setTitle({ title: lista.length ? `Etiqueta Térmica: ${lista.length} pendência(s)` : 'Etiqueta Térmica: tudo certo' });
}

// endereços dos pedidos do TikTok (rua, número, complemento...) para a ponte escrever na ordem certa
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.tipo !== 'enderecos' || !Array.isArray(msg.lista)) return;
  fetch(`${PONTE}/api/tiktok/enderecos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lista: msg.lista.slice(0, 50) }) }).catch(() => {});
});

// arquivos de etiqueta do TikTok lidos da página (sem baixar): a ponte imprime; ok=false faz a página baixar
chrome.runtime.onMessage.addListener((msg, _de, responder) => {
  if (!msg || msg.tipo !== 'arquivos' || !Array.isArray(msg.arquivos)) return;
  fetch(`${PONTE}/api/tiktok/arquivos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arquivos: msg.arquivos.slice(0, 20) }) })
    .then((r) => r.json().then((j) => responder({ ok: r.ok && !j.erro, ...j })))
    .catch(() => responder({ ok: false }));
  return true; // resposta assíncrona
});

// a automação pergunta quais rastreios do TikTok já saíram na térmica (para reimprimir o que faltou)
chrome.runtime.onMessage.addListener((msg, _de, responder) => {
  if (!msg || msg.tipo !== 'impressos') return;
  fetch(`${PONTE}/api/tiktok/impressos`, { cache: 'no-store' }).then((r) => r.json()).then((j) => responder({ ok: true, rastreios: j.rastreios || [] }))
    .catch(() => responder({ ok: false, rastreios: [] }));
  return true; // resposta assíncrona
});

// a automação do TikTok (página) avisa quando para ou volta a funcionar
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.tipo !== 'pendencia') return;
  fetch(`${PONTE}/api/pendencias/extensao`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fonte: msg.fonte, texto: msg.texto || null }) })
    .catch(() => {}).finally(atualizar);
});

// ---------- aba própria da automação do TikTok ----------
// A automação troca de página (Pedidos, Aguardando coleta) a cada minuto. Para nunca levar a aba
// onde a pessoa trabalha (produtos, pedidos à mão), ela roda só numa aba aberta aqui: fixada e em
// segundo plano. O id fica no storage.session (some quando o Chrome fecha; id velho não vale).
const URL_PEDIDOS = 'https://seller-br.tiktok.com/order?order_status[]=1&selected_sort=1&tab=to_ship';
async function abaAuto() {
  const { ttAba } = await chrome.storage.session.get('ttAba');
  if (!ttAba) return null;
  try { const t = await chrome.tabs.get(ttAba); return t && t.id; } catch (_) { return null; }
}
let abrindo = null;
function garantirAbaAuto() {
  if (abrindo) return abrindo;
  abrindo = (async () => {
    const { ttAuto } = await chrome.storage.local.get('ttAuto');
    if (!ttAuto || !ttAuto.dono || await abaAuto()) return;
    const t = await chrome.tabs.create({ url: URL_PEDIDOS, active: false, pinned: true });
    await chrome.storage.session.set({ ttAba: t.id });
    await chrome.storage.local.set({ ttAuto: { dono: 'icone', quando: Date.now() } }); // a aba nova assume já
  })().catch(() => {}).finally(() => { abrindo = null; });
  return abrindo;
}
chrome.runtime.onMessage.addListener((msg, de, responder) => {
  if (!msg || msg.tipo !== 'souAuto') return;
  abaAuto().then((id) => responder({ sou: !!id && !!de.tab && de.tab.id === id }));
  return true;
});
// relógio para a aba da automação: em segundo plano o Chrome freia o relógio da página
chrome.runtime.onMessage.addListener((msg, _de, responder) => {
  if (!msg || msg.tipo !== 'dormir') return;
  setTimeout(() => responder(true), Math.max(0, Math.min(Number(msg.ms) || 0, 120000)));
  return true;
});
chrome.storage.onChanged.addListener((m, area) => { if (area === 'local' && m.ttAuto && m.ttAuto.newValue && m.ttAuto.newValue.dono) garantirAbaAuto(); });

chrome.alarms.create('pendencias', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'pendencias') { atualizar(); garantirAbaAuto(); } });
chrome.runtime.onStartup.addListener(() => { atualizar(); garantirAbaAuto(); });
chrome.runtime.onInstalled.addListener(atualizar);
atualizar();
