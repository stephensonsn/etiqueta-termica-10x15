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
  // pedidos cuja NF-e não emitiu (cadastro fiscal incompleto): não tenta de novo sozinho.
  // Só volta a tentar quando a pessoa clica "Corrigi, tentar de novo" no quadrinho.
  // Se a NF-e for emitida à mão (ou o pedido sair da lista), a trava some sozinha.
  const TRAVADOS = CHAVE + '-travados';
  const travados = () => { try { return JSON.parse(localStorage.getItem(TRAVADOS) || '{}'); } catch (_) { return {}; } };
  const gravarTravados = (m) => { try { localStorage.setItem(TRAVADOS, JSON.stringify(m)); } catch (_) { /* sem armazenamento */ } };
  const marcarFeito = (ids) => { const m = feitos(); for (const id of ids) m[id] = Date.now(); try { localStorage.setItem(FEITOS, JSON.stringify(m)); } catch (_) { /* sem armazenamento */ } };

  // ---------- quadrinho ----------
  const caixa = document.createElement('div');
  caixa.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;width:300px;background:#fff;border:1px solid #E2E8F0;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#0F172A;padding:12px';
  caixa.innerHTML = '<div style="display:flex;align-items:center;gap:8px;justify-content:space-between"><strong>Impressão automática</strong><span style="display:flex;gap:6px;align-items:center"><button type="button" data-ligar style="border:0;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer"></button><button type="button" data-fechar title="Recolher" aria-label="Recolher" style="border:0;background:transparent;color:#64748B;font-size:20px;line-height:1;width:28px;height:28px;border-radius:6px;cursor:pointer">×</button></span></div><div data-estado style="margin-top:6px;color:#64748B"></div><div data-travados style="margin-top:8px"></div><div data-log style="margin-top:6px;max-height:110px;overflow:auto;font-size:12px;color:#334155"></div>';
  const botao = caixa.querySelector('[data-ligar]');
  // recolhido: vira uma pílula pequena com a situação e o botão de ligar/desligar (lembrado nesta aba)
  const MIN = CHAVE + '-recolhido';
  const pilula = document.createElement('div');
  pilula.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;display:none;align-items:center;gap:8px;background:#fff;border:1px solid #E2E8F0;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.12);font:600 12px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:#0F172A;padding:6px 6px 6px 12px';
  pilula.innerHTML = '<span data-ponto style="width:8px;height:8px;border-radius:50%"></span><button type="button" data-abrir title="Abrir" style="border:0;background:transparent;font:inherit;color:inherit;cursor:pointer;padding:0">Impressão automática</button><button type="button" data-ligar2 style="border:0;border-radius:999px;padding:5px 10px;font:inherit;cursor:pointer"></button>';
  const recolhido = () => { try { return localStorage.getItem(MIN) === '1'; } catch (_) { return false; } };
  function mostrar() {
    caixa.style.display = recolhido() ? 'none' : '';
    pilula.style.display = recolhido() ? 'flex' : 'none';
    const lig = ligado();
    const temTrava = Object.keys(travados()).length > 0;
    pilula.querySelector('[data-ponto]').style.background = temTrava ? '#DC2626' : lig ? '#16A34A' : '#94A3B8';
    const b2 = pilula.querySelector('[data-ligar2]');
    b2.textContent = lig ? 'Desligar' : 'Ligar';
    b2.style.background = lig ? '#FEE2E2' : '#2563EB';
    b2.style.color = lig ? '#B91C1C' : '#fff';
  }
  const recolher = (sim) => { try { localStorage.setItem(MIN, sim ? '1' : '0'); } catch (_) { /* nada */ } mostrar(); };
  caixa.querySelector('[data-fechar]').onclick = () => recolher(true);
  pilula.querySelector('[data-abrir]').onclick = () => recolher(false);
  pilula.querySelector('[data-ligar2]').onclick = () => botao.onclick();
  const estado = caixa.querySelector('[data-estado]');
  const registro = caixa.querySelector('[data-log]');
  const areaTravados = caixa.querySelector('[data-travados]');
  function desenharTravados() {
    const m = travados();
    const ids = Object.keys(m);
    areaTravados.innerHTML = '';
    try { mostrar(); } catch (_) { /* ainda montando */ }
    if (!ids.length) return;
    const box = document.createElement('div');
    box.style.cssText = 'border:1px solid #FECACA;background:#FEF2F2;border-radius:8px;padding:8px;color:#991B1B';
    const tit = document.createElement('div');
    tit.style.cssText = 'font-weight:600;margin-bottom:4px';
    tit.textContent = `Corrija o cadastro fiscal (${ids.length} pedido${ids.length > 1 ? 's' : ''})`;
    box.appendChild(tit);
    for (const id of ids) {
      const linha = document.createElement('div');
      linha.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;font-size:12px';
      const t = document.createElement('span');
      t.textContent = 'Pedido …' + id.slice(-6);
      t.title = m[id].motivo || '';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Corrigi, tentar de novo';
      b.style.cssText = 'border:0;border-radius:6px;padding:4px 8px;background:#fff;color:#B91C1C;font-weight:600;cursor:pointer;border:1px solid #FCA5A5';
      b.onclick = () => { const mm = travados(); delete mm[id]; gravarTravados(mm); desenharTravados(); log(`pedido ${id.slice(-6)}: vai tentar emitir de novo`); avisarTravados(); if (ligado()) rodada(); };
      linha.append(t, b);
      box.appendChild(linha);
    }
    areaTravados.appendChild(box);
  }
  function avisarTravados(extra) {
    const m = travados();
    const msgs = Object.keys(m).map((id) => `pedido ${id}: corrija o cadastro fiscal do produto e clique "Corrigi, tentar de novo" no quadrinho do TikTok`);
    if (extra) msgs.push(...extra);
    try { chrome.runtime.sendMessage({ tipo: 'pendencia', fonte: 'TikTok', texto: msgs.length ? msgs.join(' | ') : null }); } catch (_) { /* extensão recarregada */ }
  }
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
    mostrar();
  }
  botao.onclick = () => {
    if (ligado()) { sessionStorage.removeItem(CHAVE); desenhar(); log('desligada'); return; }
    sessionStorage.setItem(CHAVE, '1'); desenhar(); log('ligada'); rodada();
  };
  try { for (const l of JSON.parse(sessionStorage.getItem(CHAVE + '-log') || '[]').reverse()) { const d = document.createElement('div'); d.textContent = l; registro.prepend(d); } } catch (_) { /* nada */ }
  document.body.appendChild(caixa);
  document.body.appendChild(pilula);
  desenhar();
  desenharTravados();

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

  // fecha gaveta/janela aberta (botão de fechar ou Esc)
  async function fecharGaveta() {
    const x = [...document.querySelectorAll('[aria-label="Close"], [class*="close-icon"], [class*="drawer-close"], [class*="modal-close"]')].find(visivel);
    if (x) x.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await esperar(800);
  }

  // ---------- emitir NF-e de um pedido ----------
  // mensagens rápidas (toast) do TikTok: some em poucos segundos, então lê enquanto espera
  const avisosNaTela = () => [...document.querySelectorAll('[class*="message"], [class*="toast"], [class*="notification"], [role="alert"]')].filter(visivel).map(texto).filter(Boolean);
  const ERRO_CADASTRO = /33009007|informa[çc][õo]es (fiscais|obrigat[óo]rias)/i;
  // erro de cadastro trava o pedido; qualquer outro erro (lentidão, falha de rede) tenta na próxima rodada
  const erro = (msg, cadastro = false) => Object.assign(new Error(msg), { cadastro });
  async function emitirNfe(item) {
    const link = [...item.linha.querySelectorAll('*')].find((e) => /^Sem NF-e/i.test(texto(e)) && e.children.length <= 1);
    if (!link) throw erro(`pedido ${item.pedido}: não achei "Sem NF-e"`);
    link.click();
    // a gaveta "Detalhes da NF-e" carrega em partes: espera o botão "Emitir NF-e" aparecer (até 30 s)
    const emitir = await achar(() => /Adicionar NF-e/.test(texto(document.body)) && botaoPorTexto(/^Emitir NF-e$/i), 30000);
    if (!emitir) { await fecharGaveta(); throw erro(`pedido ${item.pedido}: a janela da NF-e não carregou; tento na próxima rodada`); }
    const opcao = [...document.querySelectorAll('label, [role="radio"]')].find((e) => visivel(e) && /^Emitir (uma )?NF-e$/i.test(texto(e)));
    if (opcao && !opcao.querySelector('input:checked')) { opcao.click(); await esperar(600); }
    const antes = new Set(avisosNaTela()); // ignora avisos que já estavam na tela
    emitir.click();
    // resultado: erro de cadastro (33009007), outro erro, ou a NF-e entra em processamento
    let resultado = null;
    const fim = Date.now() + 15000;
    while (Date.now() < fim && !resultado) {
      await esperar(250);
      const confirmar = botaoPorTexto(/^(Confirmar|Emitir)$/i);
      if (confirmar) { confirmar.click(); continue; }
      for (const a of avisosNaTela().filter((x) => !antes.has(x))) {
        if (ERRO_CADASTRO.test(a)) { resultado = { cadastro: a }; break; }
        if (/n[ãa]o foi poss[íi]vel|erro|falh/i.test(a)) { resultado = { outro: a }; break; }
        if (/sucesso|emitid|processando/i.test(a)) { resultado = { ok: a }; break; }
      }
      // o botão vira um "carregando" sem texto enquanto envia: só conta como fechada sem "Adicionar NF-e" na tela
      if (!resultado && !/Adicionar NF-e/.test(texto(document.body))) resultado = { ok: 'gaveta fechou' };
    }
    if (botaoPorTexto(/^Emitir NF-e$/i)) await fecharGaveta();
    await esperar(800);
    if (resultado && resultado.cadastro) throw erro(`pedido ${item.pedido}: faltam dados fiscais do produto no cadastro do TikTok (erro 33009007)`, true);
    if (resultado && resultado.outro) throw erro(`pedido ${item.pedido}: o TikTok recusou agora (${resultado.outro.slice(0, 120)}); tento na próxima rodada`);
    if (!resultado) throw erro(`pedido ${item.pedido}: o TikTok não respondeu ao emitir; confiro na próxima rodada`);
    log(`NF-e pedida: pedido ${item.pedido}`);
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
    // às vezes o TikTok mostra antes a gaveta "Resultado de envio" (etiqueta criada, falta imprimir)
    const janelaArquivos = () => [...document.querySelectorAll('div')].find((d) => visivel(d) && /Imprimir resultado/.test(texto(d)) && /\.txt/.test(texto(d)));
    // a janela "Imprimir resultado" é baixada pelo tiktok.js; aqui só espera ela aparecer.
    // Se só ficou a gaveta "Resultado de envio" (etiqueta criada, sem a janela), pede a impressão nela.
    let pronto = await achar(janelaArquivos, 30000);
    if (!pronto) {
      const imprimir = botaoPorTexto(/^Imprimir etiqueta de envio$/i);
      if (imprimir) { imprimir.click(); pronto = await achar(janelaArquivos, 30000); }
    }
    marcarFeito(itens.map((i) => i.pedido)); // a etiqueta foi criada: não tenta de novo
    if (!pronto) throw new Error('a janela com os arquivos das etiquetas não apareceu');
    await esperar(4000);
    const fechar = botaoPorTexto(/^Fechar$/i);
    if (fechar) fechar.click();
    await esperar(800);
    if (botaoPorTexto(/^Imprimir etiqueta de envio$/i)) await fecharGaveta(); // fecha "Resultado de envio"
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
      // 1) primeiro imprime o que já tem NF-e: um pedido com problema nunca segura os outros
      const ja = feitos();
      const prontos = linhasDePedido().filter((i) => statusNfe(i.linha) === 'emitida' && !ja[i.pedido]).slice(0, MAX_POR_RODADA);
      if (prontos.length) await criarEtiquetas(prontos);
      // 2) depois tenta emitir a NF-e dos pedidos "Sem NF-e", um por um; o que falhar vira pendência
      //    pedido travado por cadastro não é tentado de novo até a pessoa avisar que corrigiu
      const trav = travados();
      const linhas = linhasDePedido();
      for (const id of Object.keys(trav)) {
        const l = linhas.find((i) => i.pedido === id);
        if (!l || statusNfe(l.linha) !== 'sem') delete trav[id]; // NF-e emitida à mão ou pedido saiu da lista
      }
      const semNota = linhas.filter((i) => statusNfe(i.linha) === 'sem' && !trav[i.pedido]).slice(0, MAX_POR_RODADA);
      let emitidas = 0;
      const avisos = [];
      for (const it of semNota) {
        try { await emitirNfe(it); emitidas++; } catch (e) {
          if (e.cadastro) {
            trav[it.pedido] = { quando: Date.now(), motivo: e.message };
            log('PENDENTE: ' + e.message + '. Não tento de novo até corrigir o cadastro.');
          } else { avisos.push(e.message); log('AVISO: ' + e.message); }
        }
      }
      gravarTravados(trav);
      desenharTravados();
      if (emitidas) log(`${emitidas} NF-e em processamento; as etiquetas saem na próxima rodada`);
      if (!semNota.length && !prontos.length) log(Object.keys(trav).length ? 'nenhum pedido novo; há pedido esperando correção do cadastro' : 'nenhum pedido novo');
      avisarTravados(avisos.length >= 3 ? avisos : null); // lentidão isolada não acende o vermelho
      desenhar(`Última conferência ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Próxima em 5 minutos.`);
    } catch (e) {
      log('PAROU: ' + e.message);
      avisarTravados([e.message]);
      desenhar('Parou nesta rodada: ' + e.message + '. Tenta de novo em 5 minutos.');
    } finally {
      rodando = false;
      setTimeout(() => { if (ligado()) location.href = URL_PEDIDOS; }, INTERVALO);
    }
  }
  if (ligado()) setTimeout(rodada, 3000);
})();
