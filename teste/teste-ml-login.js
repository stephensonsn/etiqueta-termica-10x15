// Teste do login do Mercado Livre em um clique, com a API do ML simulada (nada sai da máquina).
// Confere: destino etiquetas × loja, PKCE S256, state de uso único, recusa de state falso e erro do ML.
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-ml-'));
fs.mkdirSync(path.join(RAIZ, 'logs'));
const chamadas = [];
globalThis.fetch = async (url, o = {}) => {
  chamadas.push({ url, corpo: String(o.body || '') });
  if (url.endsWith('/oauth/token')) {
    const ok = new URLSearchParams(String(o.body)).get('code') === 'TG-abc-1';
    return { ok, status: ok ? 200 : 400, json: async () => (ok ? { access_token: 'A', refresh_token: 'R', expires_in: 21600, user_id: 777 } : { error: 'invalid_grant' }) };
  }
  if (url.endsWith('/users/me')) return { ok: true, json: async () => ({ nickname: 'LOJA-TESTE' }) };
  return { ok: true, status: 200, json: async () => ({ results: [] }) };
};
const cfg = { porta: 9100, ml: { appId: '123', segredo: 's', retorno: 'https://x/ret.html', pkce: true } };
const ml = require('../src/ml.js');
ml.iniciar({ cfg, log: () => {}, RAIZ, loja: { quandoMudarEstoque() {}, estadoLoja: () => ({ produtos: [] }) } });
ml.aoSalvarConfig(() => {});
const mle = require('../src/mlEtiquetas.js');
mle.iniciar({ cfg, log: () => {}, RAIZ, receberZpl: () => {}, salvarConfig: () => {} });

(async () => {
  const u = new URL(mle.urlAutorizacao());
  const st = u.searchParams.get('state');
  assert(st.startsWith('9100.'));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  const r = await ml.concluirRetorno('TG-abc-1', st);
  assert.equal(r.destino, 'etiquetas');
  const corpo = new URLSearchParams(chamadas.find((c) => c.url.endsWith('/oauth/token')).corpo);
  assert.equal(crypto.createHash('sha256').update(corpo.get('code_verifier')).digest('base64url'), u.searchParams.get('code_challenge'));
  const c = await mle.adicionarComTokens(r.tokens);
  assert.equal(c.apelido, 'LOJA-TESTE');
  assert.equal(cfg.mlEtiquetas.contas.length, 1);
  assert(!cfg.ml.tokens, 'conta de etiqueta não pode virar a conta da loja');
  await assert.rejects(() => ml.concluirRetorno('TG-abc-1', st), /não veio de um login/); // uso único
  await assert.rejects(() => ml.concluirRetorno('TG-abc-1', '9100.falso'), /não veio de um login/);
  const r2 = await ml.concluirRetorno('TG-abc-1', new URL(ml.urlAutorizacao()).searchParams.get('state'));
  assert.equal(r2.destino, 'loja');
  assert.equal(cfg.ml.tokens.usuario, 777);
  await assert.rejects(() => ml.concluirRetorno('TG-ruim', new URL(ml.urlAutorizacao('etiquetas')).searchParams.get('state')), /venceu|recusou/);
  fs.rmSync(RAIZ, { recursive: true, force: true });
  console.log('ok: login em um clique (etiquetas e loja), PKCE, state único e erro do ML');
  process.exit(0);
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
