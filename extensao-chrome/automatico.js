// TikTok Shop: impressão automática dos pedidos novos.
// Roda SÓ na aba própria da automação: a extensão abre Pedidos numa aba fixada, em segundo plano, e
// só ela troca de página. A aba onde a pessoa trabalha (produtos, pedidos à mão) nunca é levada para
// Pedidos (26/11/2026: a aba de gerenciar produtos ia para Pedidos a cada minuto). A cada 1 minuto
// (15 s enquanto a NF-e está saindo, para imprimir assim que ela fica pronta):
//   1) abre Pedidos > Para enviar (Aguardando envio);
//   2) nos pedidos "Sem NF-e": abre a NF-e, escolhe "Emitir" e emite pelo emissor do TikTok;
//   3) nos pedidos com NF-e emitida: marca e clica em "Criar e imprimir etiqueta";
//      a janela de arquivos é baixada pelo tiktok.js e a ponte local imprime na térmica.
// Segurança: nunca clica no escuro. Se um botão esperado não aparecer, para a rodada e mostra o
// motivo no quadrinho. No máximo 10 pedidos por rodada. Desligado por padrão.
(() => {
  'use strict';
  const URL_PEDIDOS = 'https://seller-br.tiktok.com/order?order_status[]=1&selected_sort=1&tab=to_ship';
  const URL_COLETA = 'https://seller-br.tiktok.com/order?order_status[]=2&selected_sort=1&tab=to_ship'; // Aguardando coleta
  const INTERVALO = 60 * 1000;        // pedido novo: confere a cada 1 minuto
  const RAPIDO = 15 * 1000;           // NF-e pedida ou "Processando NF-e": confere a cada 15 s e imprime assim que sair
  const RAPIDO_MAX = 16;              // no máximo 4 minutos no ritmo rápido; depois volta para 1 minuto
  const CHAVE = 'etiqueta-termica-auto';
  const CH_RAPIDO = CHAVE + '-rapido';
  const MAX_POR_RODADA = 10;
  // Liga/desliga vale para o Chrome todo (chrome.storage), não só para esta aba: desligar em qualquer
  // aba ou no quadrinho para a automação em todas. Só UMA aba roda (a "dona", que ligou por último).
  const GLOBAL = 'ttAuto';
  let dono = null; // id da aba que está rodando, ou null = desligada
  const meuId = (() => { try { let v = sessionStorage.getItem(CHAVE + '-id'); if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem(CHAVE + '-id', v); } return v; } catch (_) { return 'x'; } })();
  // esta é a aba própria da automação? Quem diz é o background (ele abriu a aba e guarda o id)
  let souAuto = false;
  const pedir = (msg) => new Promise((ok) => { try { chrome.runtime.sendMessage(msg, (r) => { void (chrome.runtime && chrome.runtime.lastError); ok(r); }); } catch (_) { ok(undefined); } });
  const ligado = () => souAuto && dono !== null && dono === meuId;
  const ligadoOutra = () => dono !== null && !ligado();
  const gravarDono = (v) => { try { return v ? chrome.storage.local.set({ [GLOBAL]: { dono: v, quando: Date.now() } }) : chrome.storage.local.remove(GLOBAL); } catch (_) { return Promise.resolve(); } };
  // pulso: a aba dona regrava a hora a cada 30 s. Se a dona foi fechada (ou o Chrome reiniciou), a
  // marca fica velha; passados 3 min sem pulso, qualquer aba do TikTok aberta assume sozinha.
  // Antes disso o quadrinho mostrava "Ligada em outra aba" para sempre, sem aba nenhuma rodando.
  const PULSO = 30 * 1000;
  const ORFA = 3 * 60 * 1000;
  const PELO_ICONE = 'icone'; // o ícone da extensão liga sem ser aba: grava esta marca e uma aba do TikTok assume
  const donaSumiu = (reg, agora = Date.now()) => !!(reg && reg.dono) && (reg.dono === PELO_ICONE || agora - (Number(reg.quando) || 0) > ORFA);
  try { sessionStorage.removeItem(CHAVE); } catch (_) { /* marca antiga, por aba */ }
  // espera: na aba da automação (em segundo plano) o relógio da página é freado pelo Chrome; quem conta
  // o tempo é o background. Sem resposta dele, usa o relógio da página mesmo.
  const esperar = async (ms) => { if (souAuto && (await pedir({ tipo: 'dormir', ms })) === true) return; await new Promise((ok) => setTimeout(ok, ms)); };
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
  // Conferência: etiqueta criada pela automação tem que aparecer na ponte (rastreio impresso).
  // Se em 3 minutos não apareceu (TikTok lento, arquivo não baixou), reimprime pela lista
  // "Aguardando coleta" (até 3 vezes). Guardado por 2 dias.
  const CONFERIR = CHAVE + '-conferir';
  const lerConferir = () => { try { return JSON.parse(localStorage.getItem(CONFERIR) || '{}'); } catch (_) { return {}; } };
  const gravarConferir = (m) => { try { localStorage.setItem(CONFERIR, JSON.stringify(m)); } catch (_) { /* sem armazenamento */ } };
  const aConferir = (ids) => { const m = lerConferir(); for (const id of ids) if (!m[id]) m[id] = { quando: Date.now(), tentativas: 0 }; gravarConferir(m); };
  const impressosNaPonte = () => new Promise((ok) => { try { chrome.runtime.sendMessage({ tipo: 'impressos' }, (r) => ok(r && r.ok ? new Set(r.rastreios) : null)); } catch (_) { ok(null); } });
  async function rastreiosDe(ids) {
    const r = await fetch('/api/fulfillment/order/get?aid=4068&locale=pt-BR', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ main_order_id: ids }) });
    const j = await r.json();
    const m = {};
    for (const o of (j && j.data && j.data.main_order) || []) { const t = ((o.delivery_module || [])[0] || {}).tracking_no; if (t) m[String(o.main_order_id)] = t; }
    return m;
  }
  // pedidos criados que ainda não saíram na térmica (null = não deu para conferir agora)
  async function faltandoImprimir(minIdadeMs) {
    const m = lerConferir();
    const lim = Date.now() - 2 * 864e5;
    for (const k of Object.keys(m)) if (m[k].quando < lim) delete m[k];
    const ids = Object.keys(m).filter((id) => Date.now() - m[id].quando >= minIdadeMs);
    if (!ids.length) { gravarConferir(m); return []; }
    const ponte = await impressosNaPonte();
    if (!ponte) return null;
    let rast; try { rast = await rastreiosDe(ids); } catch (_) { return null; }
    const falta = [];
    for (const id of ids) {
      if (rast[id] && ponte.has(rast[id])) { delete m[id]; continue; } // saiu na térmica
      if (m[id].tentativas >= 3) { log(`Pedido …${id.slice(-6)}: a etiqueta não saiu depois de 3 tentativas. Imprima à mão.`); delete m[id]; continue; }
      falta.push(id);
    }
    gravarConferir(m);
    return falta;
  }
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
    const lig = dono !== null;
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
      b.onclick = () => { const mm = travados(); delete mm[id]; gravarTravados(mm); desenharTravados(); log(`Pedido …${id.slice(-6)}: tentando de novo`); avisarTravados(); if (ligado()) rodada(); };
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
  // Pedido impresso: some do histórico o que já se resolveu (avisos daquele pedido e as paradas
  // passageiras, como "Parei", "tentando de novo", "esta assumiu"). Fica só "Etiqueta impressa".
  const PASSAGEIRO = /Parei: |esta assumiu|tentando de novo|imprimindo de novo|Reimprimindo|janela com os arquivos|não ficou disponível|o TikTok recusou a nota agora/;
  function semResolvidos(linhas, msg) {
    if (!/^(Etiqueta impressa|Impresso de novo)/.test(msg)) return linhas;
    const ids = [...msg.matchAll(/…(\d{6})/g)].map((m) => m[1]);
    return linhas.filter((l) => !PASSAGEIRO.test(l) && !ids.some((id) => l.includes('…' + id)));
  }
  let ultimaLinha = '';
  function log(msg) {
    if (msg === ultimaLinha) return; // a mesma frase seguida não repete
    ultimaLinha = msg;
    for (const d of [...registro.children]) if (!semResolvidos([d.textContent], msg).length) d.remove();
    try { sessionStorage.setItem(CHAVE + '-log', JSON.stringify(semResolvidos(JSON.parse(sessionStorage.getItem(CHAVE + '-log') || '[]'), msg))); } catch (_) { /* sem armazenamento */ }
    const linha = document.createElement('div');
    linha.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' ' + msg;
    registro.prepend(linha);
    while (registro.children.length > 30) registro.lastChild.remove();
    try { const h = JSON.parse(sessionStorage.getItem(CHAVE + '-log') || '[]'); h.unshift(linha.textContent); sessionStorage.setItem(CHAVE + '-log', JSON.stringify(h.slice(0, 30))); } catch (_) { /* sem armazenamento */ }
  }
  function desenhar(msg) {
    const lig = dono !== null;
    botao.textContent = lig ? 'Desligar' : 'Ligar';
    botao.style.background = lig ? '#FEE2E2' : '#2563EB';
    botao.style.color = lig ? '#B91C1C' : '#fff';
    estado.textContent = msg || (ligado() ? 'Esta é a aba da automação. Pode deixá-la fixada; use outras abas para trabalhar.'
      : ligadoOutra() ? 'Ligada. Roda na aba fixada da automação; esta aba fica livre para você.'
        : 'Desligada: não emite nota nem imprime.');
    mostrar();
  }
  botao.onclick = async () => {
    if (dono !== null) { dono = null; await gravarDono(null); desenhar(); log('Desligada'); return; }
    // fora da aba da automação: só marca ligada; o background abre a aba própria e ela assume
    if (!souAuto) { dono = PELO_ICONE; await gravarDono(PELO_ICONE); desenhar(); log('Ligada (roda na aba fixada da automação)'); return; }
    dono = meuId; await gravarDono(meuId); desenhar(); log('Ligada'); rodada();
  };
  try { const h = JSON.parse(sessionStorage.getItem(CHAVE + '-log') || '[]').filter((l) => !/nenhum pedido novo/.test(l)); sessionStorage.setItem(CHAVE + '-log', JSON.stringify(h)); } catch (_) { /* nada */ }
  try { for (const l of JSON.parse(sessionStorage.getItem(CHAVE + '-log') || '[]').reverse()) { const d = document.createElement('div'); d.textContent = l; registro.prepend(d); } } catch (_) { /* nada */ }
  document.body.appendChild(caixa);
  document.body.appendChild(pilula);
  desenhar();
  desenharTravados();

  // ---------- endereço do destinatário ----------
  // Depois de criar as etiquetas, lê no próprio TikTok o endereço em campos (rua, número, complemento,
  // bairro, cidade, UF, CEP) com o rastreio da iMile e manda só isso para a ponte local, que escreve
  // rua e número antes do complemento na etiqueta. Telefone e e-mail não saem daqui.
  async function capturarEnderecos(ids) {
    const falta = new Set(ids);
    const fim = Date.now() + 45000;
    while (falta.size && Date.now() < fim) {
      try {
        const r = await fetch('/api/fulfillment/order/get?aid=4068&locale=pt-BR', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ main_order_id: [...falta] }) });
        const j = await r.json();
        const lista = [];
        for (const o of (j && j.data && j.data.main_order) || []) {
          const rastreio = ((o.delivery_module || [])[0] || {}).tracking_no;
          if (!rastreio) continue;
          const c = Object.fromEntries((((o.buyer_info_module || {}).shipping_address || {}).items || []).map((i) => [i.key, i.value]));
          lista.push({ rastreio, nome: (o.buyer_info_module || {}).cpf_name || c.name, nick: (o.buyer_info_module || {}).actual_buyer_nickname, usuario: (o.buyer_info_module || {}).buyer_nickname, rua: c.street_name, numero: c.street_number, complemento: c.address_detail, bairro: c.neighborhood, cidade: c.geo_l2, uf: c.geo_l1, cep: c.zipcode });
          falta.delete(String(o.main_order_id));
        }
        if (lista.length) chrome.runtime.sendMessage({ tipo: 'enderecos', lista });
      } catch (_) { /* tenta de novo */ }
      if (falta.size) await esperar(2500);
    }
    if (falta.size) log(`Endereço de ${falta.size} pedido(s) sai como o TikTok manda`);
  }

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
  // lista carregada de verdade: o contador "N pedidos encontrados" apareceu e as linhas na tela
  // batem com ele. Lista vazia só vale se continuar vazia depois de mais 8 s (o TikTok lento mostra
  // a tela sem linhas enquanto carrega e a rodada dizia "nenhum pedido novo" com pedido esperando).
  const contador = () => { const t = texto(document.body); const m = t.match(/(\d+)\s*pedidos? encontrados?/i); return m ? Number(m[1]) : /Nenhum pedido/i.test(t) ? 0 : null; };
  async function listaCarregada() {
    const ok = await achar(() => { const n = contador(); if (n === null) return false; return n === 0 || linhasDePedido().length >= Math.min(n, 20); }, 60000);
    if (!ok) return false;
    if (contador() === 0 && !linhasDePedido().length) {
      await esperar(8000);
      const n = contador();
      if (n === null) return false;
      if (n > 0 && !(await achar(() => linhasDePedido().length >= Math.min(n, 20), 30000))) return false;
    }
    await esperar(1500);
    return true;
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
  // Emissão pela API do próprio Seller Center (a mesma que o botão "Emitir NF-e" chama, mapeada
  // no código público da página): todos os pedidos numa chamada só, em segundos. Devolve
  // { ok:[ids], cadastro:{id:msg}, outro:{id:msg} } ou null quando a API não respondeu como
  // esperado (aí a rodada usa o caminho por cliques).
  async function emitirNfeApi(ids) {
    try {
      const q = '?aid=4068&locale=pt-BR';
      const r1 = await fetch('/api/fulfillment/order/get' + q, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ main_order_id: ids }) });
      const j1 = await r1.json();
      if (!j1 || j1.code !== 0) return null;
      const lista = [];
      for (const o of (j1.data && j1.data.main_order) || []) {
        const id = String(o.main_order_id);
        const uni = ((o.fulfill_unit_id_mapper || [])[0] || {}).fulfill_unit_id;
        if (ids.includes(id) && uni) lista.push({ fulfill_unit_id: String(uni), order_ids: [id] });
      }
      if (!lista.length) return null;
      const r2 = await fetch('/api/fulfillment/invoice/create_by_platform' + q, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform_invoice_list: lista }) });
      const j2 = await r2.json();
      if (!j2 || j2.code !== 0) { /* recusa da API: segue pelos cliques, sem avisar */ void 0; return null; }
      const res = { ok: [], cadastro: {}, outro: {} };
      const falhas = {};
      for (const f of (j2.data && j2.data.platform_invoice_list) || []) {
        const fr = f.fail_reason;
        if (!fr || (!fr.reason_code && !fr.reason_message)) continue;
        for (const id of f.order_ids || []) falhas[String(id)] = `${fr.reason_message || ''} (${fr.reason_code || ''})`.trim();
      }
      for (const { order_ids: [id] } of lista) {
        const m = falhas[id];
        if (!m) res.ok.push(id);
        else if (ERRO_CADASTRO.test(m)) res.cadastro[id] = m;
        else res.outro[id] = m;
      }
      return res;
    } catch (e) { /* falha da API: segue pelos cliques, sem avisar */ void 0; return null; }
  }

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
    log(`Nota fiscal pedida: pedido …${item.pedido.slice(-6)}`);
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
    aConferir(itens.map((i) => i.pedido)); // a conferência reimprime se o arquivo não chegar na térmica
    capturarEnderecos(itens.map((i) => i.pedido)); // em paralelo: a ponte espera o endereço até 20 s
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
    let pronto = await achar(janelaArquivos, 90000); // TikTok lento: espera até 1,5 min
    if (!pronto) {
      const imprimir = botaoPorTexto(/^Imprimir etiqueta de envio$/i);
      if (imprimir) { imprimir.click(); pronto = await achar(janelaArquivos, 60000); }
    }
    marcarFeito(itens.map((i) => i.pedido)); // a etiqueta foi criada: não cria de novo (a conferência reimprime se faltar)
    if (!pronto) throw new Error('a janela com os arquivos das etiquetas não apareceu; a conferência reimprime em 3 minutos');
    await esperar(4000);
    const fechar = botaoPorTexto(/^Fechar$/i);
    if (fechar) fechar.click();
    await esperar(800);
    if (botaoPorTexto(/^Imprimir etiqueta de envio$/i)) await fecharGaveta(); // fecha "Resultado de envio"
    log(`Etiqueta impressa: ${itens.map((i) => 'pedido …' + i.pedido.slice(-6)).join(', ')}`);
  }

  // ---------- reimprimir o que não chegou na térmica (lista "Aguardando coleta") ----------
  const REIMPRIMIR = CHAVE + '-reimprimir';
  async function reimprimir(ids) {
    if (!(await listaCarregada())) throw new Error('a lista "Aguardando coleta" não carregou');
    const linhas = linhasDePedido().filter((i) => ids.includes(i.pedido));
    const m = lerConferir();
    for (const id of ids) if (m[id]) m[id].tentativas = (m[id].tentativas || 0) + 1;
    gravarConferir(m);
    if (!linhas.length) { log('Não achei os pedidos em "Aguardando coleta" para imprimir de novo'); return; }
    for (const it of linhas) { const cb = it.linha.querySelector('input[type="checkbox"]'); if (cb && !cb.checked) { (cb.closest('label') || cb).click(); await esperar(300); } }
    const doc = await achar(() => botaoPorTexto(/^Imprimir documentos?$/i), 8000);
    if (!doc) throw new Error('o botão "Imprimir documento" não apareceu');
    doc.click();
    // janela "Imprimir documento" (etiqueta de envio + NF-e, ZPL): botão Imprimir
    const imp = await achar(() => { const d = [...document.querySelectorAll('[role="dialog"], [class*="modal"]')].find((x) => visivel(x) && /Imprimir documento/.test(texto(x))); return d && botaoPorTexto(/^Imprimir$/i, d); }, 15000);
    if (!imp) throw new Error('a janela "Imprimir documento" não abriu');
    imp.click();
    // já impressa no TikTok, mas a ponte confirmou que NÃO saiu na térmica: continua
    const cont = await achar(() => botaoPorTexto(/^Continuar imprimindo$/i), 15000);
    if (cont) cont.click();
    const janela = await achar(() => [...document.querySelectorAll('div')].find((d) => visivel(d) && /Imprimir resultado/.test(texto(d)) && /\.txt/.test(texto(d))), 90000);
    if (!janela) throw new Error('a janela com os arquivos não apareceu na reimpressão');
    await esperar(4000); // o tiktok.js baixa os arquivos; a ponte imprime
    const fechar = botaoPorTexto(/^Fechar$/i); if (fechar) fechar.click();
    log(`Impresso de novo (não tinha saído na térmica): ${linhas.map((i) => 'pedido …' + i.pedido.slice(-6)).join(', ')}`);
  }

  // ---------- rodada ----------
  let rodando = false;
  let emitiuAgora = false;
  async function rodada() {
    if (!ligado() || rodando) return;
    // reimpressão pendente: esta página é a lista "Aguardando coleta"
    let pend = null; try { pend = JSON.parse(sessionStorage.getItem(REIMPRIMIR) || 'null'); } catch (_) { /* nada */ }
    if (pend && pend.length) {
      if (!/order_status(%5B%5D|\[\])=2/.test(location.href)) { location.href = URL_COLETA; return; }
      rodando = true;
      try { sessionStorage.removeItem(REIMPRIMIR); desenhar('Reimprimindo o que não chegou na térmica…'); await reimprimir(pend); } catch (e) { log(e.message); }
      finally { rodando = false; esperar(3000).then(() => { if (ligado()) location.href = URL_PEDIDOS; }); }
      return;
    }
    if (!location.href.startsWith('https://seller-br.tiktok.com/order') || !/tab=to_ship/.test(location.href) || /order_status(%5B%5D|\[\])=2/.test(location.href)) {
      desenhar('Indo para Pedidos > Para enviar…');
      location.href = URL_PEDIDOS;
      return;
    }
    rodando = true;
    try {
      desenhar('Conferindo pedidos…');
      // 0) etiqueta criada há 3 min ou mais e que não saiu na térmica: vai reimprimir
      const falta = await faltandoImprimir(3 * 60 * 1000);
      if (falta && falta.length) {
        log(`A etiqueta não saiu na térmica; imprimindo de novo: ${falta.map((i) => 'pedido …' + i.slice(-6)).join(', ')}`);
        try { sessionStorage.setItem(REIMPRIMIR, JSON.stringify(falta.slice(0, MAX_POR_RODADA))); } catch (_) { /* nada */ }
        location.href = URL_COLETA;
        return;
      }
      if (!(await listaCarregada())) throw new Error('a lista de pedidos não carregou');
      // 1) primeiro imprime o que já tem NF-e: um pedido com problema nunca segura os outros
      const ja = feitos();
      const prontos = linhasDePedido().filter((i) => statusNfe(i.linha) === 'emitida' && !ja[i.pedido]).slice(0, MAX_POR_RODADA);
      if (!ligado()) throw new Error('desligada no meio da rodada; nada foi feito');
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
      // primeiro pela API (rápido, todos de uma vez); o que ela não resolver vai pelos cliques
      let viaCliques = semNota;
      if (semNota.length && ligado()) {
        const api = await emitirNfeApi(semNota.map((i) => i.pedido));
        if (api) {
          emitidas += api.ok.length;
          if (api.ok.length) log(`Nota fiscal pedida: ${api.ok.map((i) => 'pedido …' + i.slice(-6)).join(', ')}`);
          for (const [id, m] of Object.entries(api.cadastro)) { trav[id] = { quando: Date.now(), motivo: m }; log(`Pedido …${id.slice(-6)}: falta dado fiscal no cadastro do produto. Corrija no TikTok e clique "Corrigi, tentar de novo".`); }
          for (const [id, m] of Object.entries(api.outro)) { avisos.push(m); log(`Pedido …${id.slice(-6)}: o TikTok recusou a nota agora; tento de novo em 1 minuto`); }
          const resolvidos = new Set([...api.ok, ...Object.keys(api.cadastro), ...Object.keys(api.outro)]);
          viaCliques = semNota.filter((i) => !resolvidos.has(i.pedido));
        }
      }
      for (const it of viaCliques) {
        if (!ligado()) { log('Desligada antes de terminar; o resto fica para quando ligar'); break; }
        try { await emitirNfe(it); emitidas++; } catch (e) {
          if (e.cadastro) {
            trav[it.pedido] = { quando: Date.now(), motivo: e.message };
            log(e.message + '. Corrija o cadastro no TikTok.');
          } else { avisos.push(e.message); log(e.message); }
        }
      }
      gravarTravados(trav);
      desenharTravados();
      // NF-e acabou de ser pedida ou ainda está processando: próxima conferência em 15 s
      const processando = linhasDePedido().filter((i) => statusNfe(i.linha) === 'processando').length;
      let n = 0; try { n = Number(sessionStorage.getItem(CH_RAPIDO) || 0); } catch (_) { /* nada */ }
      emitiuAgora = (emitidas > 0 || processando > 0) && n < RAPIDO_MAX;
      try { sessionStorage.setItem(CH_RAPIDO, emitidas > 0 ? '1' : emitiuAgora ? String(n + 1) : '0'); } catch (_) { /* nada */ }
      // nada novo não vira linha no histórico (só a frase de estado abaixo): o histórico é só do que aconteceu
      avisarTravados(avisos.length >= 3 ? avisos : null); // lentidão isolada não acende o vermelho
      desenhar(emitiuAgora ? 'Esperando a nota fiscal sair para imprimir.' : `Tudo em dia. Conferido às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`);
    } catch (e) {
      log('Parei: ' + e.message);
      avisarTravados([e.message]);
      desenhar('Parou nesta rodada: ' + e.message + '. Tenta de novo em 1 minuto.');
    } finally {
      rodando = false;
      esperar(emitiuAgora ? RAPIDO : INTERVALO).then(() => { if (ligado()) location.href = URL_PEDIDOS; });
    }
  }
  // estado global: carrega e acompanha (desligar em outra aba ou no ícone para esta na hora)
  try {
    chrome.storage.onChanged.addListener((mud, area) => {
      if (area !== 'local' || !mud[GLOBAL]) return;
      const antes = ligado();
      dono = (mud[GLOBAL].newValue || {}).dono || null;
      if (antes && !ligado()) log(dono ? 'Ligada em outra aba; esta parou' : 'Desligada');
      desenhar();
      if (dono === PELO_ICONE) conferirDona(); // ligada pelo ícone da extensão: uma aba do TikTok assume
    });
    Promise.all([pedir({ tipo: 'souAuto' }), chrome.storage.local.get(GLOBAL)]).then(([r0, r]) => {
      souAuto = !!(r0 && r0.sou);
      dono = (r[GLOBAL] || {}).dono || null;
      // versão antiga: a dona era esta aba comum; passa para a aba própria na hora
      if (!souAuto && dono === meuId) { dono = PELO_ICONE; gravarDono(PELO_ICONE); }
      desenhar();
      if (ligado()) { gravarDono(meuId); esperar(3000).then(rodada); } else conferirDona();
    });
    setInterval(() => { if (ligado()) gravarDono(meuId); else if (dono !== null) conferirDona(); }, PULSO);
  } catch (_) { /* extensão recarregada: fica desligada */ }
  // a dona parou de dar sinal: esta aba assume (espera um tempo aleatório e confere de novo para
  // duas abas abertas não assumirem juntas; se outra assumiu antes, o pulso dela já está novo)
  async function conferirDona() {
    try {
      if (!souAuto) return; // só a aba própria da automação assume
      if (!donaSumiu((await chrome.storage.local.get(GLOBAL))[GLOBAL])) return;
      await esperar(1000 + Math.floor(Math.random() * 4000));
      const reg = (await chrome.storage.local.get(GLOBAL))[GLOBAL];
      if (!donaSumiu(reg) || ligado()) return;
      dono = meuId; await gravarDono(meuId);
      log(reg.dono === PELO_ICONE ? 'Ligada' : 'A aba que estava ligada foi fechada; esta assumiu');
      desenhar(); rodada();
    } catch (_) { /* extensão recarregada */ }
  }
  // testes automáticos (teste/ambiente-extensao.js): expõe as funções puras; no Chrome não existe __TESTE__
  if (globalThis.__TESTE__) globalThis.__teste = { semResolvidos, PELO_ICONE, donaSumiu, ORFA, meuId, listaCarregada, contador, linhasDePedido, statusNfe, emitirNfeApi, faltandoImprimir, aConferir, lerConferir, travados, feitos, URL_PEDIDOS, URL_COLETA };
})();
