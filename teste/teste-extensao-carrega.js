// Carrega os scripts da extensão num ambiente falso e confere que não quebram ao abrir.
// `node --check` só vê sintaxe; erro de execução (ex.: usar constante antes de declarar)
// derruba o script inteiro na página e a automação some sem aviso.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// objeto que aceita qualquer leitura, chamada e escrita
function falso() {
  const f = function () { return falso(); };
  return new Proxy(f, {
    get: (_, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined; // não é promessa
      if (k === Symbol.iterator) return function* () {};
      return falso();
    },
    set: () => true,
    apply: () => falso(),
    construct: () => falso(),
  });
}
const armazenamento = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };

let falhou = false;
for (const nome of ['tiktok.js', 'automatico.js']) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'extensao-chrome', nome), 'utf8');
  const ctx = {
    document: falso(), location: { href: 'https://seller-br.tiktok.com/order?tab=to_ship' },
    sessionStorage: armazenamento(), localStorage: armazenamento(),
    chrome: { storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() }, onChanged: { addListener() {} } }, runtime: { sendMessage() {} } },
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
    fetch: () => Promise.resolve(falso()), console, Promise, JSON, Date, Math, Object, Array, Set, Map, Number, String, RegExp, Error,
  };
  ctx.window = ctx;
  try { vm.runInNewContext(codigo, ctx, { filename: nome }); console.log('ok: ' + nome + ' carrega'); } catch (e) { falhou = true; console.error('FALHOU ' + nome + ': ' + e.message); }
}
process.exit(falhou ? 1 : 0);
