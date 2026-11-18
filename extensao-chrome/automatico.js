// TikTok Shop: impressão automática dos pedidos novos.
// Liga numa aba própria do Seller Center (o estado fica só nesta aba). A cada 5 minutos:
//   1) abre Pedidos > Para enviar (Aguardando envio);
//   2) nos pedidos "Sem NF-e": abre a NF-e, escolhe "Emitir" e emite pelo emissor do TikTok;
//   3) nos pedidos com NF-e emitida: marca e clica em "Criar e imprimir etiqueta";
//      a janela de arquivos é baixada pelo tiktok.js e a ponte local imprime na térmica.
// Segurança: nunca clica no escuro. Se um botão esperado não aparecer, para a rodada e mostra o
// motivo no quadrinho. No máximo 10 pedidos por rodada. Desligado por padrão.
(() => {
  'use strict';
  const URL_PEDIDOS = 'https://seller-br.tiktok.com/order?order_status[]=1&selected_sort=1&tab=to_ship';
  const INTERVALO = 5 * 60 * 1000;
  const MAX_POR_RODADA = 10;
  const CHAVE = 'etiqueta-termica-auto';
  const ligado = () => sessionStorage.getItem(CHAVE) === '1';
  const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const texto = (el) => (el && (el.innerText || el.textContent) || '').trim();
  const visivel = (el) => !!el && el.getClientRects().length > 0;
  // pedidos já enviados para a térmica (guardados nesta aba por 2 dias): nunca imprime duas vezes
  const FEITOS = CHAVE + '-feitos';
  const feitos = () => { try { const m = JSON.parse(localStorage.getItem(FEITOS) || '{}'); const lim = Date.now() - 2 * 864e5; for (const k of Object.keys(m)) if (m[k] < lim) delete m[k]; return m; } catch (_) { return {}; } };
  const marcarFeito = (ids) => { const m = feitos(); for (const id of ids) m[id] = Date.now(); try { localStorage.setItem(FEITOS, JSON.stringify(m)); } catch (_) { /* sem armazenamento */ } };

  // ---------- quadrinho ----------
  const caixa = document.createElement('div');
  caixa.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;width:300px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#0F172A;padding:12px';
  caixa.innerHTML = '<div style="display:flex;align-items:center;gap:8px;justify-content:space-between"><strong>Impressão automática</strong><button type="button" style="border:0;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer"></button></div><div data-estado style="margin-top:6px;color:#64748B"></div><div data-log style="margin-top:6px;max-height:110px;overflow:auto;font-size:12px;color:#334155"></div>';
  const botao = caixa.querySelector('button');
  const estado = caixa.querySelector('[data-estado]');
  const registro = caixa.querySelector('[data-log]');
  function log(msg) {
    const linha = document.createElement('div');
    linha.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' ' + msg;
    registro.prepend(linha);
    while (registro.children.length > 30) registro.lastChild.remove();
    try { const h = JSON.parse(sessionStorage.getItem(CHAVE + '-log') || '[]'); h.unshift(linha.textContent); sessionStorage.setItem(CHAVE + '-log', JSON.stringify(h.slice(0, 30))); } catch (_) { /* sem armazenamento */ }
  }
  function desenhar(msg) {
    botao.textContent = ligado() ? 'Desligar' : 'Ligar';
    botao.style.background = ligado() ? '#FEE2E2' : '#2563EB';
    botao.style.color = ligado() ? '#B91C1C' : '#fff';
    estado.textContent = msg || (ligado() ? 'Ligada nesta aba: confere a cada 5 minutos. Deixe esta aba aberta.' : 'Desligada. Ligue numa aba só para isso.');
  }
  botao.onclick = () => {
    if (ligado()) { sessionStorage.removeItem(CHAVE); desenhar(); log('desligada'); return; }
    sessionStorage.setItem(CHAVE, '1'); desenhar(); log('ligada'); rodada();
  };
  try { for (const l of JSON.parse(sessionStorage.getItem(CHAVE + '-log') || '[]').reverse()) { const d = document.createElement('div'); d.textContent = l; registro.prepend(d); } } catch (_) { /* nada */ }
  document.body.appendChild(caixa);
  desenhar();

  // ---------- utilidades da página ----------
  async function achar(fn, ms = 20000) {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { const r = fn(); if (r) return r; await esperar(400); }
    return null;
  }
  const botaoPorTexto = (re, raiz = document) => [...raiz.querySelectorAll('button')].find((b) => visivel(b) && !b.disabled && re.test(texto(b)));
  // linhas de pedido: o elemento mais próximo do número do pedido (18 dígitos) que tem a caixa de seleção
  function linhasDePedido() {
    const out = [];
    const vistos = new Set();
    for (const el of document.querySelectorAll('a, span, div')) {
      const t = texto(el);
      if (!/^\d{18}$/.test(t) || vistos.has(t)) continue;
      let linha = el;
      for (let i = 0; i < 12 && linha && !linha.querySelector('input[type="checkbox"]'); i++) linha = linha.parentElement;
      if (!linha) continue;
      vistos.add(t);
      out.push({ pedido: t, linha });
    }
    return out;
  }
  const statusNfe = (linha) => {
    const t = texto(linha);
    if (/Sem NF-e/i.test(t)) return 'sem';
    if (/Processando NF-e/i.test(t)) return 'processando';
    if (/estornad/i.test(t)) return 'estornada';
    if (/\b\d+\s*NF-e\b/.test(t)) return 'emitida';
    return '?';
  };

  // ---------- emitir NF-e de um pedido ----------
  async function emitirNfe(item) {
    const link = [...item.linha.querySelectorAll('*')].find((e) => /^Sem NF-e/i.test(texto(e)) && e.children.length <= 1);
    if (!link) throw new Error(`pedido ${item.pedido}: não achei "Sem NF-e"`);
    link.click();
    const gaveta = await achar(() => [...document.querySelectorAll('div')].find((d) => visivel(d) && /Detalhes da NF-e/.test(texto(d)) && /Adicionar NF-e/.test(texto(d))), 15000);
    if (!gaveta) throw new Error(`pedido ${item.pedido}: a janela da NF-e não abriu`);
    const opcao = await achar(() => [...gaveta.querySelectorAll('label, [role="radio"], div')].find((e) => visivel(e) && /^Emitir (uma )?NF-e$/i.test(texto(e))), 8000);
    if (!opcao) throw new Error(`pedido ${item.pedido}: a opção "Emitir uma NF-e" não apareceu (dados fiscais do produto completos?)`);
    opcao.click();
    await esperar(800);
    const emitir = await achar(() => botaoPorTexto(/^Emitir NF-e$/i, gaveta) || botaoPorTexto(/^Emitir NF-e$/i), 8000);
    if (!emitir) throw new Error(`pedido ${item.pedido}: o botão "Emitir NF-e" não apareceu`);
    emitir.click();
    await esperar(2500);
    const confirmar = botaoPorTexto(/^(Confirmar|Emitir)$/i);
    if (confirmar) { confirmar.click(); await esperar(2000); }
    const fechar = [...document.querySelectorAll('button, [aria-label="Close"], [class*="close"]')].find((b) => visivel(b) && /^(×|Fechar|Close)?$/.test(texto(b)) && b.closest('div') && gaveta.contains(b));
    if (fechar) fechar.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await esperar(1000);
    log(`NF-e emitida: pedido ${item.pedido}`);
  }

  // ---------- criar e imprimir etiquetas ----------
  async function criarEtiquetas(itens) {
    for (const it of itens) {
      const cb = it.linha.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked) { (cb.closest('label') || cb).click(); await esperar(300); }
    }
    const criar = await achar(() => botaoPorTexto(/^Criar e imprimir etiqueta/i), 8000);
    if (!criar) throw new Error('o botão "Criar e imprimir etiqueta" não ficou disponível');
    criar.click();
    // primeira vez o TikTok pergunta como imprimir: confirma o padrão já configurado
    const padrao = await achar(() => botaoPorTexto(/Imprimir etiquetas no momento do envio/i), 5000);
    if (padrao) padrao.click();
    // "Etiqueta(s) de envio já impressas": não reimprime sozinho; cancela e registra
    const jaImpressa = await achar(() => botaoPorTexto(/^Continuar imprimindo$/i), 4000);
    if (jaImpressa) {
      const cancelar = botaoPorTexto(/^Cancelar$/i);
      if (cancelar) cancelar.click();
      marcarFeito(itens.map((i) => i.pedido));
      throw new Error('o TikTok avisou que a etiqueta já foi impressa; não reimprimi');
    }
    // a janela "Imprimir resultado" é baixada pelo tiktok.js; aqui só espera ela aparecer
    const pronto = await achar(() => [...document.querySelectorAll('div')].find((d) => visivel(d) && /Imprimir resultado/.test(texto(d)) && /\.txt/.test(texto(d))), 45000);
    marcarFeito(itens.map((i) => i.pedido)); // a etiqueta foi criada: não tenta de novo
    if (!pronto) throw new Error('a janela com os arquivos das etiquetas não apareceu');
    await esperar(4000);
    const fechar = botaoPorTexto(/^Fechar$/i);
    if (fechar) fechar.click();
    log(`etiquetas criadas e enviadas para a térmica: ${itens.map((i) => i.pedido.slice(-6)).join(', ')}`);
  }

  // ---------- rodada ----------
  let rodando = false;
  async function rodada() {
    if (!ligado() || rodando) return;
    if (!location.href.startsWith('https://seller-br.tiktok.com/order') || !/tab=to_ship/.test(location.href)) {
      desenhar('Indo para Pedidos > Para enviar…');
      location.href = URL_PEDIDOS;
      return;
    }
    rodando = true;
    try {
      desenhar('Conferindo pedidos…');
      const carregou = await achar(() => /pedidos? encontrados?|Nenhum pedido/i.test(texto(document.body)), 30000);
      if (!carregou) throw new Error('a lista de pedidos não carregou');
      await esperar(2500);
      let itens = linhasDePedido().slice(0, MAX_POR_RODADA);
      const semNota = itens.filter((i) => statusNfe(i.linha) === 'sem');
      for (const it of semNota) await emitirNfe(it);
      if (semNota.length) { log(`${semNota.length} NF-e em processamento; as etiquetas saem na próxima rodada`); }
      const ja = feitos();
      itens = linhasDePedido().filter((i) => statusNfe(i.linha) === 'emitida' && !ja[i.pedido]).slice(0, MAX_POR_RODADA);
      if (itens.length) await criarEtiquetas(itens);
      if (!semNota.length && !itens.length) log('nenhum pedido novo');
      desenhar(`Última conferência ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Próxima em 5 minutos.`);
    } catch (e) {
      log('PAROU: ' + e.message);
      desenhar('Parou nesta rodada: ' + e.message + '. Tenta de novo em 5 minutos.');
    } finally {
      rodando = false;
      setTimeout(() => { if (ligado()) location.href = URL_PEDIDOS; }, INTERVALO);
    }
  }
  if (ligado()) setTimeout(rodada, 3000);
})();
