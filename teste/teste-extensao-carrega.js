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
// manifesto: todo arquivo citado existe e carrega; versão no formato x.y.z
const PASTA = path.join(__dirname, '..', 'extensao-chrome');
const man = JSON.parse(fs.readFileSync(path.join(PASTA, 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(man.version)) { console.error('FALHOU versão do manifest: ' + man.version); process.exit(1); }
const citados = [...new Set([...man.content_scripts.flatMap((c) => c.js), man.background.service_worker, 'popup.js'])];
for (const f of [...citados, man.action.default_popup]) if (!fs.existsSync(path.join(PASTA, f))) { console.error('FALHOU: manifest cita ' + f + ' que não existe'); process.exit(1); }
if (!man.content_scripts.some((c) => c.matches.includes('https://seller-br.tiktok.com/*'))) { console.error('FALHOU: extensão não roda no TikTok Seller'); process.exit(1); }
if (!(man.host_permissions || []).includes('http://127.0.0.1:9100/*')) { console.error('FALHOU: extensão sem acesso à ponte'); process.exit(1); }
for (const nome of citados) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'extensao-chrome', nome), 'utf8');
  const ctx = {
    document: falso(), location: { href: 'https://seller-br.tiktok.com/order?tab=to_ship' },
    sessionStorage: armazenamento(), localStorage: armazenamento(),
    chrome: falso(),
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
    fetch: () => Promise.resolve(falso()), console, Promise, JSON, Date, Math, Object, Array, Set, Map, Number, String, RegExp, Error,
  };
  ctx.window = ctx;
  try { vm.runInNewContext(codigo, ctx, { filename: nome }); console.log('ok: ' + nome + ' carrega (extensão ' + man.version + ')'); } catch (e) { falhou = true; console.error('FALHOU ' + nome + ': ' + e.message); }
}
process.exit(falhou ? 1 : 0);
