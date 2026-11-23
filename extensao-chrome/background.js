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

chrome.alarms.create('pendencias', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'pendencias') atualizar(); });
chrome.runtime.onStartup.addListener(atualizar);
chrome.runtime.onInstalled.addListener(atualizar);
atualizar();
