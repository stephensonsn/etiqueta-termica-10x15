// NF-e pela API do Seller Center e conferência com a ponte (reimpressão do que não saiu).
// Erros de origem: cadastro fiscal (33009007) sem aviso claro; etiqueta criada que não chegou na
// térmica porque o TikTok demorou mais de 30 s para mostrar a janela de arquivos.
'use strict';
const assert = require('assert');
const { criar } = require('./ambiente-extensao');

const pedido = (id, uni, rastreio) => ({ main_order_id: id, fulfill_unit_id_mapper: [{ fulfill_unit_id: uni }], delivery_module: [{ tracking_no: rastreio }] });
const PEDIDOS = [pedido('111', 'u1', '3320100000001'), pedido('222', 'u2', '3320100000002'), pedido('333', 'u3', '3320100000003')];

(async () => {
  // ---------- emissão pela API ----------
  // sucesso para todos: uma chamada só, com fulfill_unit_id de cada pedido
  let a = criar();
  a.respostaFetch = async (url) => (/order\/get/.test(url) ? { code: 0, data: { main_order: PEDIDOS } } : { code: 0, data: { platform_invoice_list: [] } });
  let r = await a.f.emitirNfeApi(['111', '222', '333']);
  assert.deepEqual(r.ok, ['111', '222', '333']);
  const emissao = a.chamadas.fetch.find((c) => /create_by_platform/.test(c.url));
  assert.equal(a.chamadas.fetch.filter((c) => /create_by_platform/.test(c.url)).length, 1, 'todos numa chamada só');
  assert.deepEqual(emissao.corpo.platform_invoice_list.map((x) => x.fulfill_unit_id), ['u1', 'u2', 'u3']);
  assert.deepEqual(emissao.corpo.platform_invoice_list[0].order_ids, ['111']);

  // um pedido com cadastro fiscal incompleto (33009007) e outro com erro qualquer
  a = criar();
  a.respostaFetch = async (url) => (/order\/get/.test(url) ? { code: 0, data: { main_order: PEDIDOS } } : { code: 0, data: { platform_invoice_list: [
    { fulfill_unit_id: 'u2', order_ids: ['222'], fail_reason: { reason_code: 33009007, reason_message: 'Não foi possível emitir a NF-e porque você não forneceu informações obrigatórias' } },
    { fulfill_unit_id: 'u3', order_ids: ['333'], fail_reason: { reason_code: 12345, reason_message: 'sistema ocupado' } },
  ] } });
  r = await a.f.emitirNfeApi(['111', '222', '333']);
  assert.deepEqual(r.ok, ['111']);
  assert(r.cadastro['222'] && /33009007/.test(r.cadastro['222']), 'cadastro fiscal vira pendência');
  assert(r.outro['333'], 'erro passageiro vira aviso (tenta de novo)');

  // API recusou (code != 0) ou caiu: devolve null e a rodada usa os cliques
  a = criar();
  a.respostaFetch = async (url) => (/order\/get/.test(url) ? { code: 0, data: { main_order: PEDIDOS } } : { code: 98001, message: 'sem permissão' });
  assert.equal(await a.f.emitirNfeApi(['111']), null);
  a = criar();
  a.respostaFetch = async () => { throw new Error('rede caiu'); };
  assert.equal(await a.f.emitirNfeApi(['111']), null);
  a = criar();
  a.respostaFetch = async () => ({ code: 0, data: { main_order: [] } });
  assert.equal(await a.f.emitirNfeApi(['111']), null, 'sem fulfill_unit_id não emite às cegas');

  // ---------- conferência com a ponte ----------
  a = criar();
  a.respostaFetch = async () => ({ code: 0, data: { main_order: PEDIDOS } });
  let naPonte = ['3320100000001'];
  a.respostaMensagem = (m) => (m.tipo === 'impressos' ? { ok: true, rastreios: naPonte } : null);
  a.f.aConferir(['111', '222']);
  assert.deepEqual(await a.f.faltandoImprimir(3 * 60 * 1000), [], 'antes de 3 min não confere');
  a.avancar(3 * 60 * 1000);
  assert.deepEqual(await a.f.faltandoImprimir(3 * 60 * 1000), ['222'], 'o que saiu some; o que não saiu vai reimprimir');
  assert(!a.f.lerConferir()['111'], 'impresso sai da lista de conferência');

  // ponte fora do ar: não decide nada (não reimprime às cegas)
  a.respostaMensagem = () => null;
  assert.equal(await a.f.faltandoImprimir(3 * 60 * 1000), null);

  // 3 tentativas sem sair: desiste e avisa para imprimir à mão
  a.respostaMensagem = (m) => (m.tipo === 'impressos' ? { ok: true, rastreios: [] } : null);
  const m = a.f.lerConferir(); m['222'].tentativas = 3; a.ctx.localStorage.setItem('etiqueta-termica-auto-conferir', JSON.stringify(m));
  assert.deepEqual(await a.f.faltandoImprimir(3 * 60 * 1000), []);
  assert(!a.f.lerConferir()['222'], 'depois de 3 tentativas sai da conferência');

  // chegou depois: rastreio passa a constar na ponte e a conferência fecha
  a = criar();
  a.respostaFetch = async () => ({ code: 0, data: { main_order: PEDIDOS } });
  naPonte = [];
  a.respostaMensagem = (m) => (m.tipo === 'impressos' ? { ok: true, rastreios: naPonte } : null);
  a.f.aConferir(['333']);
  a.avancar(4 * 60 * 1000);
  assert.deepEqual(await a.f.faltandoImprimir(3 * 60 * 1000), ['333']);
  naPonte = ['3320100000003'];
  assert.deepEqual(await a.f.faltandoImprimir(3 * 60 * 1000), []);

  console.log('ok: NF-e pela API (lote, 33009007, recusa volta aos cliques) e conferência com a ponte');
  process.exit(0);
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
