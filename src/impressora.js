// Pedidos de impressão, envio para a térmica (fila CUPS em modo bruto) e log em arquivo.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { execFile, execFileSync, spawn } = require('child_process');
const { montar, separarEnvios, paraPng, paraTspl, paraTsplCompacto, paraTsplZlib, etiquetaRegua, PREAMBULO } = require('./etiqueta');

const RAIZ = path.join(__dirname, '..'); // código (conectores, driver, config.exemplo)
// dados (config, logs, prévias, recebidos): a instalação usa a própria pasta; os testes passam
// ETIQUETA_DADOS com uma pasta temporária e nunca tocam a config real
const DADOS = process.env.ETIQUETA_DADOS ? path.resolve(process.env.ETIQUETA_DADOS) : RAIZ;
// saída falsa para testes: os bytes vão para arquivos nesta pasta em vez da impressora
const SAIDA_TESTE = process.env.ETIQUETA_SAIDA_TESTE ? path.resolve(process.env.ETIQUETA_SAIDA_TESTE) : '';
const ARQ_CFG = path.join(DADOS, 'config.json');
if (!fs.existsSync(ARQ_CFG)) fs.copyFileSync(path.join(RAIZ, 'config.exemplo.json'), ARQ_CFG); // primeira execução
const cfg = JSON.parse(fs.readFileSync(ARQ_CFG, 'utf8'));
if (Number(process.env.ETIQUETA_PORTA)) cfg.porta = Number(process.env.ETIQUETA_PORTA); // testes: porta própria (não grava)
if (!cfg.conexao) cfg.conexao = { tipo: 'usb', dispositivo: '', host: '', portaRede: 9100 };
for (const d of ['logs', 'recebidos', 'previa']) fs.mkdirSync(path.join(DADOS, d), { recursive: true });
// Histórico da fila (o que chegou e o que imprimiu) fica em disco por cfg.historicoDias (padrão 2),
// com a prévia de cada etiqueta, para reimprimir mesmo depois de a ponte reiniciar.
if (!Number.isInteger(cfg.historicoDias)) cfg.historicoDias = 2;

const ultimasLinhas = [];
// Registro: sempre fica na memória (o painel mostra as últimas linhas). Só vai para arquivo
// se "guardar histórico" estiver ligado; desligado, só erros e a partida vão para o registro do serviço.
function log(msg) {
  const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString(); // hora local
  const linha = `${agora.replace('T', ' ').slice(0, 19)} ${msg}`;
  if (cfg.guardarHistorico) fs.appendFileSync(path.join(DADOS, 'logs', `etiqueta-${agora.slice(0, 10)}.log`), linha + '\n');
  if (cfg.guardarHistorico || /^(ERRO|falha|ponte ativa)/.test(msg)) process.stdout.write(linha + '\n');
  ultimasLinhas.push(linha);
  if (ultimasLinhas.length > 60) ultimasLinhas.shift();
}

const LIMITES = {
  deslocXmm: [-20, 20], deslocYmm: [-30, 30], densidade: [0, 15], velocidade: [2, 8],
  gapMm: [0, 10], offsetMm: [0, 10], faixaLinhas: [0, 1198],
};
// Aplica mudanças vindas do painel, validando cada campo, e grava o config.json.
function salvarConfig(novo) {
  if (['direto', 'conferir'].includes(novo.imprimir)) cfg.imprimir = novo.imprimir;
  if (['junto', 'cheio'].includes(novo.modo)) cfg.modo = novo.modo;
  if (typeof novo.vigiarDownloads === 'boolean') cfg.vigiarDownloads = novo.vigiarDownloads;
  if (typeof novo.guardarHistorico === 'boolean') cfg.guardarHistorico = novo.guardarHistorico;
  if (novo.historicoDias !== undefined) {
    const d = Number(novo.historicoDias);
    if (!Number.isInteger(d) || d < 1 || d > 30) throw new Error('o histórico de impressão guarda de 1 a 30 dias');
    cfg.historicoDias = d;
    setTimeout(() => { podarHistorico(); gravarHistorico(true); }, 0);
  }
  if (typeof novo.configurado === 'boolean') cfg.configurado = novo.configurado;
  if (typeof novo.limparDownloads === 'boolean') cfg.limparDownloads = novo.limparDownloads;
  if (novo.calib && typeof novo.calib === 'object') {
    for (const [k, [min, max]] of Object.entries(LIMITES)) {
      const v = Number(novo.calib[k]);
      if (novo.calib[k] !== undefined && Number.isFinite(v)) cfg.calib[k] = Math.min(max, Math.max(min, v));
    }
    if (typeof novo.calib.crlfInicial === 'boolean') cfg.calib.crlfInicial = novo.calib.crlfInicial;
  }
  if (novo.conexao && typeof novo.conexao === 'object') {
    const n = novo.conexao;
    if (n.tipo === 'usb') {
      cxCache.quando = 0;
      if (n.uri) {
        // impressora no cabo sem fila no macOS: o conector USB fala direto com ela, sem criar fila
        // (fila crua aparecia na janela de imprimir e o PDF ia para ela sem converter)
        const achada = listarConexoes().usb.find((u) => u.semFila && u.uri === n.uri && ehTermica(u));
        if (!achada) throw new Error('impressora não encontrada no cabo USB');
        n.fila = '';
      }
      if (n.fila && !listarConexoes().usb.some((u) => u.fila === n.fila)) throw new Error('fila USB não encontrada no macOS');
      if (n.fila !== undefined) cfg.fila = n.fila;
      cfg.conexao.tipo = 'usb';
    } else if (n.tipo === 'bluetooth') {
      if (!/^\/dev\/cu\.[\w.-]+$/.test(n.dispositivo || '') || !fs.existsSync(n.dispositivo)) throw new Error('porta Bluetooth não encontrada; pareie a impressora nos Ajustes do Sistema');
      cfg.conexao.tipo = 'bluetooth'; cfg.conexao.dispositivo = n.dispositivo;
    } else if (n.tipo === 'rede') {
      const porta = Number(n.portaRede || 9100);
      if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/.test(n.host || '') || !(porta > 0 && porta < 65536)) throw new Error('endereço de rede inválido');
      cfg.conexao.tipo = 'rede'; cfg.conexao.host = n.host; cfg.conexao.portaRede = porta;
    } else if (n.tipo === 'ble') {
      cfg.conexao.tipo = 'ble';
      // nome da impressora para o conector Bluetooth do Mac ligar sozinho
      if (typeof n.bleNome === 'string' && /^[\w .:()+-]{1,60}$/.test(n.bleNome)) cfg.conexao.bleNome = n.bleNome;
    } else throw new Error('tipo de conexão desconhecido');
    filaCache.quando = 0;
  }
  fs.writeFileSync(ARQ_CFG, JSON.stringify(cfg, null, 2));
  log(`config salva: conexao=${JSON.stringify(cfg.conexao)}`);
  log(`config salva: imprimir=${cfg.imprimir} modo=${cfg.modo} calib=${JSON.stringify(cfg.calib)}`);
  return { ...cfg, loja: cfg.loja ? { url: cfg.loja.url, temChave: !!(cfg.loja.chave && cfg.loja.segredo) } : undefined, ml: cfg.ml ? { appId: cfg.ml.appId, conectado: !!(cfg.ml.tokens && cfg.ml.tokens.refresh) } : undefined, mlEtiquetas: cfg.mlEtiquetas ? { ligado: !!cfg.mlEtiquetas.ligado, contas: (cfg.mlEtiquetas.contas || []).map((c) => c.apelido) } : undefined }; // nunca devolve a chave da loja
}

function rodar(cmd, args, tempoMs) {
  return new Promise((ok, erro) => {
    execFile(cmd, args, { timeout: tempoMs, env: { ...process.env, LANG: 'C', LC_ALL: 'C' } }, (e, saida, err) =>
      e ? erro(new Error((err || e.message).trim())) : ok(saida.trim()));
  });
}
// Entrega para a fila do macOS e só dá como enviado quando o trabalho sai da fila.
// Se a impressora estiver desligada ou sem cabo, cancela o trabalho (para não imprimir
// tudo de uma vez mais tarde) e devolve erro.
async function lp(arquivo, tempoMs, fila = cfg.fila) {
  const saida = await rodar('/usr/bin/lp', ['-d', fila, '-o', 'raw', arquivo], 10000);
  const trabalho = (saida.match(new RegExp(`${fila}-\\d+`)) || [])[0];
  if (!trabalho) return saida;
  const limite = Date.now() + Math.max(15000, tempoMs);
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 300));
    const pendentes = await rodar('/usr/bin/lpstat', ['-o', fila], 5000).catch(() => trabalho);
    if (!pendentes.includes(trabalho)) return `trabalho ${trabalho} impresso`;
  }
  await rodar('/usr/bin/cancel', [trabalho], 5000).catch(() => {});
  throw new Error('a impressora não respondeu pelo cabo USB (desligada ou sem cabo)');
}

// Envio USB direto (conector-usb, nativo em Swift/IOKit), sempre aberto (--servidor).
// A fila do macOS gasta ~7 s fixos por trabalho esperando a impressora "confirmar o fim"; o driver do
// fabricante (decompilado com REA + Ghidra) só escreve uma etiqueta atrás da outra. Aqui: um processo
// fica com o cabo aberto e recebe quadros [tamanho][dados]; cada etiqueta sai ~0,2 ms depois da
// anterior ser aceita (a USB segura sozinha quando o buffer da impressora enche). Antes de cada
// etiqueta ele confere o estado (sem papel / erro / fora de linha) e recusa sem mandar.
const CONECTOR_USB = path.join(RAIZ, 'conector-usb', 'conector-usb');
const usbDireto = { proc: null, pronto: null, esperando: [], resto: '' };
function abrirUsbDireto() {
  if (usbDireto.proc) return usbDireto.pronto;
  const proc = spawn(CONECTOR_USB, ['--servidor'], { stdio: ['pipe', 'pipe', 'pipe'] });
  usbDireto.proc = proc; usbDireto.resto = '';
  usbDireto.pronto = new Promise((ok, erro) => {
    const t = setTimeout(() => erro(new Error('o conector USB não abriu em 5 s')), 5000);
    usbDireto.aoPronto = () => { clearTimeout(t); ok(); };
    usbDireto.aoFalhar = (e) => { clearTimeout(t); erro(e); };
  });
  usbDireto.pronto.catch(() => {});
  let errTxt = '';
  proc.stderr.on('data', (d) => { errTxt += d; });
  proc.stdout.on('data', (d) => {
    usbDireto.resto += d;
    let i;
    while ((i = usbDireto.resto.indexOf('\n')) >= 0) {
      const linha = usbDireto.resto.slice(0, i).trim(); usbDireto.resto = usbDireto.resto.slice(i + 1);
      if (linha === 'pronto') { usbDireto.aoPronto(); continue; }
      const w = usbDireto.esperando.shift();
      if (!w) continue;
      clearTimeout(w.relogio);
      if (linha.startsWith('ok ')) w.ok(`direto pelo cabo: ${linha.slice(3)} bytes`);
      else w.erro(Object.assign(new Error(linha.replace(/^erro (estado )?/, '')), { estado: linha.startsWith('erro estado') }));
    }
  });
  proc.on('exit', (c) => {
    const e = new Error((errTxt.trim() || `conector USB saiu (código ${c})`));
    usbDireto.proc = null;
    usbDireto.aoFalhar(e);
    for (const w of usbDireto.esperando.splice(0)) { clearTimeout(w.relogio); w.erro(e); }
  });
  proc.stdin.on('error', () => {});
  return usbDireto.pronto;
}
async function escreverUsbDireto(bytes, tempoMs) {
  await abrirUsbDireto();
  return new Promise((ok, erro) => {
    const w = { ok, erro };
    // passou do tempo: fecha o conector (o próximo envio abre de novo) e devolve erro
    w.relogio = setTimeout(() => { const i = usbDireto.esperando.indexOf(w); if (i >= 0) usbDireto.esperando.splice(i, 1); try { usbDireto.proc && usbDireto.proc.kill(); } catch (_) {} erro(new Error('o envio pelo cabo passou do tempo')); }, tempoMs);
    usbDireto.esperando.push(w);
    const cab = Buffer.alloc(4); cab.writeUInt32BE(bytes.length);
    usbDireto.proc.stdin.write(Buffer.concat([cab, bytes]));
  });
}

// A térmica no cabo: a da fila escolhida ou, sem fila (modo direto), qualquer uma ligada no USB.
// Nunca uma impressora de escritório (jato de tinta/laser): ela não entende TSPL e imprimiria páginas de lixo.
const ESCRITORIO = /\b(brother|hp|hewlett|epson|canon|samsung|lexmark|ricoh|kyocera|xerox|oki|sharp|konica|minolta|pantum|dell|fuji)\b|^(dcp|mfc|hl|deskjet|officejet|laserjet|envy|pixma|ecotank|l\d{3,4})[-_ ]/i;
const ehTermica = (u) => !ESCRITORIO.test(`${u.nome || ''} ${decodeURIComponent(u.uri || '')}`);
const usbEscolhida = (lista) => lista.find((u) => u.ligada && ehTermica(u) && (cfg.fila ? u.fila === cfg.fila : true));

// Impressoras que o Mac enxerga agora, por tipo de conexão.
let cxCache = { quando: 0, valor: null };
function listarConexoes() {
  if (cxCache.valor && Date.now() - cxCache.quando < 3000) return cxCache.valor;
  cxCache = { quando: Date.now(), valor: listarConexoesAgora() };
  return cxCache.valor;
}
function listarConexoesAgora() {
  const env = { ...process.env, LANG: 'C', LC_ALL: 'C' };
  let usb = [];
  try {
    usb = execFileSync('/usr/bin/lpstat', ['-v'], { timeout: 4000, env }).toString().split('\n')
      .map((l) => l.match(/(\S+): (usb:\/\/\S+)\s*$/)).filter(Boolean) // independe do idioma do sistema
      .map((m) => ({ fila: m[1], nome: decodeURIComponent(m[2].replace(/^usb:\/\/+/, '').split('?')[0]), uri: m[2] }));
    // o que está de fato no cabo agora (a fila continua existindo com a impressora desligada)
    const noCabo = execFileSync('/usr/sbin/lpinfo', ['--include-schemes', 'usb', '-v'], { timeout: 5000, env }).toString();
    const serie = (u) => (u.match(/serial=([^&\s]+)/) || [])[1];
    for (const u of usb) {
      u.serie = serie(u.uri) || '';
      u.ligada = serie(u.uri) ? noCabo.includes(`serial=${serie(u.uri)}`) : noCabo.includes(encodeURI(u.nome)) || noCabo.includes(u.nome);
      delete u.uri;
    }
    // impressora no cabo que o macOS ainda não conhece: a ponte cria a fila sozinha, sem driver do fabricante
    for (const l of noCabo.split('\n')) {
      const m = l.match(/(usb:\/\/\S+)/);
      if (!m) continue;
      const s2 = serie(m[1]);
      if (usb.some((u) => u.ligada && (!s2 || u.serie === s2))) continue;
      usb.push({ fila: '', nome: decodeURIComponent(m[1].replace(/^usb:\/\/+/, '').split('?')[0]).split('/').pop(), ligada: true, semFila: true, uri: m[1] });
    }
  } catch (_) { /* sem CUPS */ }
  let bluetooth = [];
  try {
    bluetooth = fs.readdirSync('/dev').filter((n) => n.startsWith('cu.') && !/Bluetooth-Incoming-Port|debug-console|wlan|usbmodem|usbserial/i.test(n))
      .map((n) => ({ dispositivo: `/dev/${n}`, nome: n.slice(3) }));
  } catch (_) { /* sem /dev */ }
  return { usb: usb.filter(ehTermica), bluetooth }; // impressora de escritório não aparece nem é usada
}

// Escreve numa porta serial Bluetooth (criada pelo macOS quando a impressora é pareada).
function escreverSerial(dispositivo, bytes, tempoMs) {
  return new Promise((ok, erro) => {
    const t = setTimeout(() => { try { s.destroy(); } catch (_) {} erro(new Error('a impressora não respondeu pelo Bluetooth')); }, tempoMs);
    const s = fs.createWriteStream(dispositivo, { flags: 'w' });
    s.on('error', (e) => { clearTimeout(t); erro(new Error(`Bluetooth: ${e.message}`)); });
    s.end(bytes, () => { clearTimeout(t); ok('porta Bluetooth'); });
  });
}

// Manda direto para uma impressora de rede (porta bruta, normalmente 9100).
function escreverRede(host, porta, bytes, tempoMs) {
  return new Promise((ok, erro) => {
    const c = net.connect({ host, port: porta });
    c.setTimeout(tempoMs, () => { c.destroy(); erro(new Error(`sem resposta de ${host}:${porta}`)); });
    c.on('error', (e) => erro(new Error(`rede: ${e.message}`)));
    c.on('connect', () => c.end(bytes));
    c.on('close', (falhou) => { if (!falhou) ok(`${host}:${porta}`); });
  });
}

// Bluetooth de baixo consumo: quem fala com a impressora é o painel aberto no Chrome (Web Bluetooth).
// A ponte deixa o trabalho numa fila; o painel busca, envia e confirma.
const filaBle = [];
// O que o conector Bluetooth informou sobre a impressora (resposta dela ao comando de estado).
let bleInfo = { quando: 0 };
function bleInformar(info) { bleInfo = { ...info, quando: Date.now() }; }
// Traduz o byte de estado do TSPL em uma frase; devolve '' quando está pronta.
function problemaDaImpressora(e) {
  if (e === undefined || e === null) return '';
  const partes = [];
  if (e & 0x01) partes.push('tampa aberta');
  if (e & 0x02) partes.push('papel travado');
  if (e & 0x04) partes.push('sem papel');
  if (e & 0x08) partes.push('sem fita');
  if (e & 0x10) partes.push('pausada (aperte o botão da impressora)');
  if (e & 0x80) partes.push('em erro (desligue e ligue a impressora)');
  return partes.join(', ');
}
// Estado do Bluetooth em uma frase e se dá para imprimir.
function situacaoBle() {
  const novo = Date.now() - bleInfo.quando < 8000;
  if (novo && bleInfo.conectada) {
    // O OIA-8370-B não responde à consulta de estado pelo Bluetooth; ao ligar, solta um byte avulso
    // (0xf0) que não é estado. Só vale um byte de estado plausível (bits 6 e 7 zerados), recebido há
    // pouco. A ligação morta quem detecta é o conector (sinal de vida a cada 5 s), não a falta de estado.
    const e = bleInfo.estado;
    const estadoValido = bleInfo.respondeAgora && Number.isInteger(e) && (e & 0xC0) === 0;
    const prob = estadoValido ? problemaDaImpressora(e) : '';
    if (prob) return { ok: false, texto: `Impressora ${prob}` };
    if (estadoValido) return { ok: true, texto: (e & 0x20) ? 'Imprimindo' : 'Impressora pronta (Bluetooth)' };
    return { ok: true, texto: 'Bluetooth conectado' };
  }
  if (novo && !bleInfo.conectada) return { ok: false, texto: `Procurando ${bleInfo.nome || 'a impressora'} por Bluetooth` };
  // sem conector nativo: vale o painel aberto no Chrome
  return bleVivoPainel() ? { ok: true, texto: 'Bluetooth conectado pelo Chrome' } : { ok: false, texto: 'Bluetooth sem conexão com a impressora' };
}
let bleVisto = 0, bleSeq = 0;
// O painel está vivo se consultou há pouco OU se está no meio do envio de uma etiqueta
// (enquanto envia ele não consulta; era isso que derrubava a segunda etiqueta de um lote).
const bleVivoPainel = () => Date.now() - bleVisto < 6000 || filaBle.some((x) => x.entregue);
const bleVivo = () => situacaoBle().ok;
function bleProximo() {
  bleVisto = Date.now();
  const t = filaBle.find((x) => !x.entregue);
  if (!t) return null;
  t.entregue = true;
  return { id: t.id, dados: t.bytes.toString('base64') };
}
function bleFeito(id, ok, erro) {
  const i = filaBle.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [t] = filaBle.splice(i, 1);
  clearTimeout(t.relogio);
  ok ? t.ok('Bluetooth') : t.erro(new Error(erro || 'falha no Bluetooth'));
}
function escreverBle(bytes, tempoMs) {
  return new Promise((ok, erro) => {
    const sit = situacaoBle();
    if (!sit.ok) return erro(new Error(sit.texto));
    const t = { id: ++bleSeq, bytes, ok, erro, entregue: false };
    t.relogio = setTimeout(() => { const i = filaBle.indexOf(t); if (i >= 0) filaBle.splice(i, 1); erro(new Error('o painel não confirmou o envio por Bluetooth')); }, tempoMs);
    filaBle.push(t);
  });
}

// A etiqueta vai SEMPRE pela conexão escolhida no painel (cabo, Bluetooth ou rede). Se ela não
// estiver disponível, a etiqueta fica na fila e é reenviada quando voltar; não troca de conexão sozinha.
function conexoesDisponiveis() {
  const cx = cfg.conexao;
  const achadas = listarConexoes();
  const usb = usbEscolhida(achadas.usb);
  const todas = {
    usb: usb ? { tipo: 'usb', fila: usb.fila } : null,
    ble: bleVivo() ? { tipo: 'ble' } : null,
    bluetooth: cx.dispositivo && fs.existsSync(cx.dispositivo) ? { tipo: 'bluetooth', dispositivo: cx.dispositivo } : null,
    rede: cx.tipo === 'rede' && cx.host ? { tipo: 'rede', host: cx.host, portaRede: cx.portaRede } : null,
  };
  // troca sozinha entre cabo e Bluetooth: com o cabo ligado vai pelo USB (mais rápido); sem cabo,
  // pelo Bluetooth. Rede só quando escolhida no painel.
  if (cx.tipo === 'rede') return todas.rede ? [todas.rede] : [];
  return [todas.usb, todas.ble, todas.bluetooth].filter(Boolean);
}
// a fila do macOS pausa sozinha quando uma impressão falha (ex.: cabo tirado no meio);
// com a impressora de volta no cabo, a ponte reativa a fila antes de mandar
function reativarFila(fila) {
  try {
    const env = { ...process.env, LANG: 'C', LC_ALL: 'C' };
    const txt = execFileSync('/usr/bin/lpstat', ['-p', fila], { timeout: 4000, env }).toString();
    if (/disabled/i.test(txt)) {
      execFileSync('/usr/sbin/cupsenable', [fila], { timeout: 5000 });
      log(`fila ${fila} estava pausada no macOS: reativada`);
    }
  } catch (e) { log(`não deu para reativar a fila ${fila}: ${e.message}`); }
}

// Manda a etiqueta pela melhor conexão disponível, com nova tentativa e espera crescente.
// "gerar(tipo)" devolve os bytes no formato certo para cada conexão.
// Troca de rolo (ex.: de etiqueta de envio 100x150 para etiqueta de produto 34x23): o sensor de
// papel continua ajustado para o rolo anterior, a impressora perde a separação entre etiquetas,
// a impressão vai "subindo" a cada linha e às vezes ela trava parecendo conectada. Quando o
// tamanho do trabalho muda, a ponte manda o comando de calibração (GAPDETECT) antes de imprimir.
function comCalibracao(bytes) {
  const ini = bytes.toString('latin1', 0, Math.min(bytes.length, 4096));
  const m = ini.match(/SIZE ([\d.]+) mm,\s*([\d.]+) mm/);
  if (!m) return bytes;
  const papel = `${m[1]}x${m[2]}`;
  if (cfg.ultimoPapel === papel) return bytes;
  const gap = ini.match(/GAP [^\r\n]*\r\n/);
  const pos = gap ? gap.index + gap[0].length : ini.indexOf('\r\n', m.index) + 2;
  log(`rolo mudou (${cfg.ultimoPapel || 'desconhecido'} -> ${papel} mm): recalibrando o sensor de papel antes de imprimir`);
  cfg.ultimoPapel = papel;
  try { fs.writeFileSync(ARQ_CFG, JSON.stringify(cfg, null, 2)); } catch (_) { /* fica na memória */ }
  return Buffer.concat([bytes.subarray(0, pos), Buffer.from('GAPDETECT\r\n', 'latin1'), bytes.subarray(pos)]);
}

async function enviar(gerar, rotulo) {
  if (SAIDA_TESTE) { // teste: grava o que iria para a impressora e não manda nada
    const bytes = comCalibracao(gerar('usb'));
    fs.mkdirSync(SAIDA_TESTE, { recursive: true });
    fs.writeFileSync(path.join(SAIDA_TESTE, `${Date.now()}-${rotulo}.tspl`), bytes);
    log(`enviado ${rotulo} por teste (${bytes.length} bytes)`);
    return;
  }
  let ultimo = new Error(situacaoPreferida().texto || 'impressora não conectada');
  for (let t = 1; t <= cfg.tentativas; t++) {
    const opcoes = conexoesDisponiveis();
    for (const cx of opcoes) {
      const bytes = comCalibracao(gerar(cx.tipo));
      const tempo = Math.min(10000 + Math.ceil(bytes.length / 1024) * 50, 60000); // base + por KB, com teto
      const arq = path.join(DADOS, 'recebidos', `${rotulo}.tspl`);
      try {
        let r;
        if (cx.tipo === 'ble') r = await escreverBle(bytes, 30000 + Math.ceil(bytes.length / 1024) * 1500);
        else if (cx.tipo === 'bluetooth') r = await escreverSerial(cx.dispositivo, bytes, tempo);
        else if (cx.tipo === 'rede') r = await escreverRede(cx.host, cx.portaRede, bytes, tempo);
        else {
          try {
            if (cfg.usbDireto === false || !fs.existsSync(CONECTOR_USB)) throw new Error('sem conector USB direto');
            r = await escreverUsbDireto(bytes, tempo);
          } catch (eDireto) {
            if (eDireto.estado) throw eDireto; // sem papel / erro / fora de linha: não manda por outro caminho
            if (!cx.fila) throw eDireto; // sem fila no macOS: o cabo direto é o único caminho
            if (fs.existsSync(CONECTOR_USB) && cfg.usbDireto !== false) log(`envio direto pelo cabo falhou (${eDireto.message}); indo pela fila do macOS`);
            fs.writeFileSync(arq, bytes);
            try { reativarFila(cx.fila); r = await lp(arq, tempo, cx.fila); } finally { fs.rmSync(arq, { force: true }); }
          }
        }
        log(`enviado ${rotulo} por ${cx.tipo} (${bytes.length} bytes, tentativa ${t}): ${r}`);
        return;
      } catch (e) {
        ultimo = e;
        log(`falha ao enviar ${rotulo} por ${cx.tipo} (tentativa ${t}/${cfg.tentativas}): ${e.message}`);
      }
    }
    if (t < cfg.tentativas) await new Promise((r) => setTimeout(r, 1500 * t));
  }
  throw ultimo;
}

// Situação da fila no macOS (guardada por 3 s para não chamar o lpstat a cada consulta do painel).
let filaCache = { quando: 0, valor: { ok: false, texto: 'Sem leitura' } };
function situacaoFila() { return situacaoPreferida(); }
function situacaoPreferida() {
  if (Date.now() - filaCache.quando < 3000) return filaCache.valor;
  let valor;
  if (cfg.conexao.tipo === 'bluetooth') {
    valor = fs.existsSync(cfg.conexao.dispositivo) ? { ok: true, texto: 'Bluetooth pareado' } : { ok: false, texto: 'Impressora Bluetooth não pareada' };
    filaCache = { quando: Date.now(), valor };
    return valor;
  }
  // cabo e Bluetooth trocam sozinhos: sem a impressora no cabo, vale a situação do Bluetooth
  const noCabo = !!usbEscolhida(listarConexoes().usb);
  if (cfg.conexao.tipo === 'ble' && !noCabo) return situacaoBle(); // sem cache: muda a cada segundo
  if (cfg.conexao.tipo === 'usb' && !noCabo && bleVivo()) return situacaoBle();
  if (cfg.conexao.tipo === 'rede') {
    valor = { ok: true, texto: `Rede ${cfg.conexao.host}:${cfg.conexao.portaRede}` };
    filaCache = { quando: Date.now(), valor };
    return valor;
  }
  if (!usbEscolhida(listarConexoes().usb)) {
    valor = { ok: false, texto: 'Impressora desligada ou sem cabo' };
    filaCache = { quando: Date.now(), valor };
    return valor;
  }
  if (!cfg.fila) {
    valor = { ok: true, texto: 'Impressora pronta (cabo direto)' };
    filaCache = { quando: Date.now(), valor };
    return valor;
  }
  try {
    const env = { ...process.env, LANG: 'C', LC_ALL: 'C' };
    const txt = execFileSync('/usr/bin/lpstat', ['-p', cfg.fila], { timeout: 4000, env }).toString();
    const parados = execFileSync('/usr/bin/lpstat', ['-o', cfg.fila], { timeout: 4000, env }).toString().trim().split('\n').filter(Boolean).length;
    if (/disabled|desativad/i.test(txt)) valor = { ok: true, texto: 'Fila pausada no macOS (reativa sozinha ao imprimir)' };
    else if (/offline|not connected|unable|waiting for printer|desconectad|aguardando a impressora/i.test(txt)) valor = { ok: false, texto: 'Impressora desligada ou sem cabo' };
    else valor = { ok: true, texto: parados ? `Imprimindo (${parados} na fila)` : 'Impressora pronta' };
  } catch (e) {
    valor = { ok: false, texto: 'Fila não encontrada no macOS' };
  }
  filaCache = { quando: Date.now(), valor };
  return valor;
}

// Parte preta da imagem (0 a 1). Etiqueta quase em branco indica falha na montagem.
function cobertura(img) {
  let n = 0;
  for (let i = 0; i < img.bits.length; i++) n += img.bits[i];
  return n / img.bits.length;
}

// ---------- pedidos (o que chegou e o estado de cada etiqueta) ----------
const pedidos = []; // mais novo primeiro
const imagens = new Map(); // jid -> imagem em memória
const recentes = new Map(); // evita o mesmo envio duas vezes em sequência (clique duplo)
const porNumero = new Map(); // número do envio -> por onde e quando chegou
let seq = 0;

function carimbo() {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

// ---------- histórico em disco (logs/historico-fila.json + previa/<jid>.png) ----------
const ARQ_HIST = path.join(DADOS, 'logs', 'historico-fila.json');
const MAX_HIST = 5000; // trava de segurança além dos dias
let gravado = '';
function podarHistorico() {
  const limite = Date.now() - cfg.historicoDias * 864e5;
  for (let i = pedidos.length - 1; i >= 0; i--) {
    const p = pedidos[i];
    // fila viva (aguardando/imprimindo/falhou com nova tentativa) nunca some por idade
    const viva = p.estado === 'aguardando' || p.estado === 'enviando';
    if ((new Date(p.hora).getTime() < limite && !viva) || i >= MAX_HIST) {
      pedidos.splice(i, 1); imagens.delete(p.jid);
      fs.rmSync(path.join(DADOS, 'previa', `${p.jid}.png`), { force: true });
    }
  }
  // memória: só as 40 mais recentes ficam com a imagem carregada; o resto lê da prévia ao reimprimir
  for (const p of pedidos.slice(40)) imagens.delete(p.jid);
}
function gravarHistorico(forcar = false) {
  try {
    const txt = JSON.stringify(pedidos);
    if (!forcar && txt === gravado) return;
    const tmp = `${ARQ_HIST}.tmp`;
    fs.writeFileSync(tmp, txt); fs.renameSync(tmp, ARQ_HIST); // troca atômica: nunca fica meio arquivo
    gravado = txt;
  } catch (e) { log(`ERRO ao gravar o histórico da fila: ${e.message}`); }
}
(function carregarHistorico() {
  let lidos = [];
  try { lidos = JSON.parse(fs.readFileSync(ARQ_HIST, 'utf8')); } catch (_) { /* primeira vez ou arquivo ruim: começa vazio */ }
  if (!Array.isArray(lidos)) lidos = [];
  for (const p of lidos) {
    if (!p || typeof p.jid !== 'string' || !/^[0-9]+-[0-9]+$/.test(p.jid)) continue;
    if (!fs.existsSync(path.join(DADOS, 'previa', `${p.jid}.png`))) continue; // sem a imagem não dá para reimprimir
    // interrompida no meio pela reinicialização: não reenvia sozinha (evita etiqueta dobrada)
    if (!Array.isArray(p.eventos)) p.eventos = [{ quando: p.hora, tipo: 'chegou', detalhe: p.origem || '' }]; // histórico de antes da linha do tempo
    if (p.estado === 'enviando') { p.estado = 'erro'; p.erro = 'a ponte reiniciou durante a impressão; confira o papel e reimprima se faltou'; p.eventos.push({ quando: new Date().toISOString(), tipo: 'falhou', detalhe: p.erro }); }
    p.repetir = false;
    pedidos.push(p);
  }
  pedidos.sort((a, b) => (a.hora < b.hora ? 1 : -1));
  podarHistorico();
  // prévias sem pedido (sobras de versões antigas) saem
  const vivos = new Set(pedidos.map((p) => `${p.jid}.png`));
  for (const f of fs.readdirSync(path.join(DADOS, 'previa'))) if (!vivos.has(f)) fs.rmSync(path.join(DADOS, 'previa', f), { force: true });
  gravarHistorico(true);
  setInterval(() => gravarHistorico(), 3000).unref();
  setInterval(podarHistorico, 3600000).unref();
  process.on('exit', () => gravarHistorico());
})();

// imagem para reimprimir: da memória ou da prévia em disco (PNG 1 bit, sem perda)
function imagemDo(jid) {
  if (imagens.has(jid)) return imagens.get(jid);
  const arq = path.join(DADOS, 'previa', `${jid}.png`);
  if (!fs.existsSync(arq)) return null;
  const { PNG } = require('pngjs');
  const png = PNG.sync.read(fs.readFileSync(arq));
  const bits = new Uint8Array(png.width * png.height);
  for (let i = 0; i < bits.length; i++) bits[i] = png.data[i * 4] < 128 ? 1 : 0;
  return { l: png.width, a: png.height, bits };
}

// linha do tempo de cada etiqueta (o app mostra no detalhe da fila); até 30 eventos por etiqueta
function evento(p, tipo, detalhe = '') {
  if (!Array.isArray(p.eventos)) p.eventos = [];
  p.eventos.push({ quando: new Date().toISOString(), tipo, detalhe: String(detalhe).slice(0, 200) });
  if (p.eventos.length > 30) p.eventos.splice(1, p.eventos.length - 30);
}

function registrar(id, tipo, origem, img) {
  const jid = `${carimbo()}-${++seq}`;
  const p = { jid, id, tipo, origem, hora: new Date().toISOString(), estado: 'aguardando', erro: '', impressoes: 0 };
  evento(p, 'chegou', origem);
  fs.writeFileSync(path.join(DADOS, 'previa', `${jid}.png`), paraPng(img));
  pedidos.unshift(p);
  imagens.set(jid, img);
  podarHistorico();
  gravarHistorico();
  return p;
}

async function imprimirPedido(jid) {
  const p = pedidos.find((x) => x.jid === jid);
  const img = p && imagemDo(jid);
  if (!p || !img) throw new Error('etiqueta não encontrada no histórico (passou do prazo de guarda?)');
  if (p.tipo === 'erro') throw new Error('esta etiqueta não foi montada: imprima de novo pelo Mercado Livre ou pela Shopee (a ponte já aceita a nova tentativa)');
  p.estado = 'enviando';
  try {
    // trava aprendida com drivers TSPL prontos: não gastar etiqueta em branco
    if (cobertura(img) < 0.01) throw new Error('etiqueta saiu quase em branco na montagem; não foi enviada');
    // Bluetooth: compacta (faixas com tinta). A comprimida (BITMAP modo 3) fica só com cfg.compressao=true:
    // a OIA-8370-B imprimiu um teste pequeno, mas descartou etiquetas inteiras em 18/11/2026
    // cabo USB também vai compacta: a OIA-8370-B recebe ~17 KB/s mesmo no cabo (19/11/2026: 120 KB = 7 s
    // por etiqueta); a compacta manda só as faixas com tinta e a etiqueta seguinte sai logo depois
    await enviar((tipo) => semOffsetSeContinua(tipo === 'ble' && cfg.compressao === true ? paraTsplZlib(img, cfg.calib) : cfg.usbCheia === true && tipo !== 'ble' ? paraTspl(img, cfg.calib) : paraTsplCompacto(img, cfg.calib)), `${p.jid}-${p.id || 'teste'}-${p.tipo}`.replace(/[^\w.+-]+/g, '_'));
    p.estado = 'impresso'; p.erro = ''; p.impressoes++;
    evento(p, 'impressa', p.impressoes > 1 ? `${p.impressoes}ª vez` : '');
    if (p.rastreio) marcarImpressoTikTok(p.rastreio);
    apagarSeImprimiu(p.arquivo);
    // fica no histórico (cfg.historicoDias) para reimprimir depois de um papel travado
  } catch (e) {
    p.estado = 'erro'; p.erro = e.message;
    evento(p, 'falhou', e.message);
    if (cfg.imprimir === 'direto') p.repetir = true;
    throw e;
  }
  return p;
}

function descartarPedido(jid) {
  const p = pedidos.find((x) => x.jid === jid);
  if (p && (p.estado === 'aguardando' || p.estado === 'erro')) { p.estado = 'descartado'; p.repetir = false; evento(p, 'descartada'); }
  return p;
}

// Rastreios do TikTok que já saíram na térmica (3 dias, em disco): a extensão confere e reimprime o
// que foi criado no TikTok mas não chegou aqui (TikTok lento, arquivo que não baixou).
const ARQ_IMPRESSOS_TT = path.join(DADOS, 'logs', 'tiktok-impressos.json');
let impressosTikTok = {};
try { impressosTikTok = JSON.parse(fs.readFileSync(ARQ_IMPRESSOS_TT, 'utf8')); } catch (_) { /* primeira vez */ }
function marcarImpressoTikTok(rastreio) {
  if (!rastreio) return;
  const lim = Date.now() - 3 * 864e5;
  for (const k of Object.keys(impressosTikTok)) if (impressosTikTok[k] < lim) delete impressosTikTok[k];
  impressosTikTok[rastreio] = Date.now();
  try { fs.writeFileSync(ARQ_IMPRESSOS_TT, JSON.stringify(impressosTikTok)); } catch (_) { /* fica na memória */ }
}
const rastreiosImpressosTikTok = () => Object.keys(impressosTikTok);

// Uma fila de impressão para tudo (Mercado Livre, Shopee, TikTok, Downloads): as etiquetas saem na
// ordem em que ficaram prontas, uma atrás da outra, enquanto as seguintes ainda estão sendo montadas.
let filaImpressao = Promise.resolve();
let naFila = 0; // etiquetas na fila de impressão, contando a que está saindo agora
function naFilaDeImpressao(tarefa) {
  naFila++;
  const vez = filaImpressao.then(tarefa).finally(() => { naFila--; });
  filaImpressao = vez.catch(() => {});
  return vez;
}
// Sequência contínua: com OFFSET > 0 a impressora empurra o papel até o picote depois de cada
// etiqueta e puxa de volta antes da próxima ("recua e avança"). Se já há outra etiqueta esperando,
// esta sai com OFFSET 0 e a próxima emenda direto; só a última da sequência para no picote.
function semOffsetSeContinua(bytes) {
  if (cfg.sequenciaContinua === false || naFila <= 1) return bytes;
  const ini = bytes.toString('latin1', 0, Math.min(bytes.length, 4096));
  const m = ini.match(/OFFSET [\d.]+ mm\r\n/);
  if (!m || m[0] === 'OFFSET 0 mm\r\n') return bytes;
  return Buffer.concat([bytes.subarray(0, m.index), Buffer.from('OFFSET 0 mm\r\n', 'latin1'), bytes.subarray(m.index + m[0].length)]);
}

// Recebe ZPL (um ou vários envios), monta as etiquetas 10x15 e imprime ou segura para conferência.
async function receberZpl(zpl, { origem = 'manual', imprimir = cfg.imprimir === 'direto', modo = cfg.modo, danfesTikTok = null, esperarImpressao = true, repetir = false } = {}) {
  // repetir: a pessoa mandou imprimir de propósito (pelo Imprimir do Mac); não passa pela trava de repetido
  const envios = separarEnvios(zpl);
  if (!envios.length) throw new Error('ZPL sem etiqueta (^XA...^XZ)');
  const feitos = [];
  const impressoes = [];
  // TikTok: espera até 20 s o endereço que a extensão manda pelo rastreio; se não vier para uma
  // etiqueta, as próximas do mesmo arquivo não esperam de novo (saem com o endereço como veio)
  let esperaEndereco = 20000;
  for (const [n, envio] of envios.entries()) {
    // SHA1 normalizado: remove espaços e quebras de linha para que API e Downloads
    // com o mesmo conteúdo (mas formatação diferente) tenham o mesmo hash.
    const normalizado = envio.replace(/[\s\r\n]+/g, '');
    const hash = crypto.createHash('sha1').update(normalizado).digest('hex').slice(0, 10);
    const antes = recentes.get(hash);
    // Janela de 180s para TODOS os caminhos: ML manda por API e Downloads quase simultaneamente
    if (!repetir && antes && Date.now() - antes < 180000) {
      log(`ignorado envio repetido (SHA1 ${hash}) via ${origem} — já recebido há ${Math.round((Date.now() - antes) / 1000)}s`);
      feitos.ignorados = (feitos.ignorados || 0) + 1;
      continue;
    }
    recentes.set(hash, Date.now());
    // Extrai o número do envio para dedup secundária (caso o SHA1 difira por dados variáveis)
    const numero = (envio.match(/"id"\s*:\s*"(\d+)"/) || envio.match(/ID:(\d+)/i) || envio.match(/Envio\s+(\d{10,})/i) || [])[1];
    const outro = numero && porNumero.get(numero);
    if (!repetir && outro && Date.now() - outro.quando < 180000) {
      log(`envio ${numero} já veio por ${outro.origem}; ignorada a cópia que chegou por ${origem}`);
      feitos.ignorados = (feitos.ignorados || 0) + 1;
      continue;
    }
    if (numero) porNumero.set(numero, { origem, quando: Date.now() });
    let etiquetas;
    try {
      // padrão: faixa simples igual às outras plataformas; DANFE completo só com cfg.tiktokDanfeCompleto
      etiquetas = await montar(envio, modo, { ...(danfesTikTok && cfg.tiktokDanfeCompleto ? { danfes: danfesTikTok } : {}), esperarEnderecoMs: esperaEndereco });
      for (const e of etiquetas) if (e.aviso) { log(`TikTok: ${e.aviso}`); if (/não chegou/.test(e.aviso)) esperaEndereco = 0; }
    } catch (e) {
      // nunca some em silêncio: libera para uma nova tentativa (não conta como repetido), guarda o
      // ZPL para ajuste e põe um item com o erro na fila do painel
      recentes.delete(hash);
      if (numero) porNumero.delete(numero);
      const idErro = numero || `sem-id-${n + 1}`;
      try {
        const dir = path.join(DADOS, 'logs', 'falhas');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${carimbo()}-${idErro}.zpl`), envio);
      } catch (_) { /* segue */ }
      const p = registrar(idErro, 'erro', origem, { l: 800, a: 1200, bits: new Uint8Array(800 * 1200) });
      p.estado = 'erro'; p.erro = `Não deu para montar a etiqueta: ${e.message}. Arquivo guardado em logs/falhas para ajuste.`;
      feitos.push(p); feitos.falhas = (feitos.falhas || 0) + 1;
      log(`ERRO ao montar o envio ${idErro} (via ${origem}): ${e.message}; ZPL guardado em logs/falhas`);
      continue;
    }
    const id = etiquetas[0].id || `sem-id-${n + 1}`;
    if (cfg.guardarHistorico) fs.writeFileSync(path.join(DADOS, 'recebidos', `${carimbo()}-${id}.zpl`), envio);
    // envio + documento fiscal que não couberam numa etiqueta só: guarda o ZPL neste computador
    // (fora do git, apagado em 7 dias) para dar para ajustar o modelo depois, mesmo sem histórico ligado
    if (etiquetas.some((e) => e.tipo === 'fiscal')) {
      try {
        const dir = path.join(DADOS, 'logs', 'nao-juntou');
        fs.mkdirSync(dir, { recursive: true });
        for (const f of fs.readdirSync(dir)) if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 7 * 864e5) fs.rmSync(path.join(dir, f), { force: true });
        fs.writeFileSync(path.join(dir, `${carimbo()}-${id}.zpl`), envio);
        log(`envio ${id}: documento fiscal saiu em etiqueta separada; ZPL guardado em logs/nao-juntou para ajuste`);
      } catch (e) { log(`não guardou o ZPL de ${id}: ${e.message}`); }
    }
    for (const e of etiquetas) {
      const p = registrar(id, e.tipo, origem, e.img);
      if (e.rastreio) p.rastreio = e.rastreio;
      feitos.push(p);
      // fluxo contínuo: a etiqueta entra na fila de impressão e a próxima já começa a ser montada
      if (imprimir) impressoes.push(naFilaDeImpressao(() => imprimirPedido(p.jid)).catch((err) => { p.repetir = true; log(`ERRO ao imprimir ${id}: ${err.message} (vai tentar de novo sozinho)`); }));
    }
    log(`${imprimir ? 'na fila de impressão' : 'aguardando conferência'}: envio ${id} via ${origem} (${etiquetas.map((e) => e.tipo).join(', ')})`);
    await new Promise((ok) => setImmediate(ok)); // deixa a impressão andar entre uma montagem e outra
  }
  // esperarImpressao=false: devolve assim que tudo foi montado e entrou na fila (o site do Mercado
  // Livre manda o próximo lote e ele já começa a ser montado enquanto este imprime)
  if (esperarImpressao) await Promise.all(impressoes);
  return feitos;
}

// ---------- entrada por arquivo (.txt ou .zip do Mercado Livre e da Shopee) ----------
function lerZplDeArquivo(caminho) {
  const cab = Buffer.alloc(4);
  const fd = fs.openSync(caminho, 'r'); fs.readSync(fd, cab, 0, 4, 0); fs.closeSync(fd);
  if (cab.toString('latin1', 0, 2) !== 'PK') {
    const t = fs.readFileSync(caminho, 'utf8');
    return /\^XA/.test(t) ? t : '';
  }
  // zip: junta todos os .txt que tiverem ZPL (o PDF da declaração fica de fora)
  const nomes = execFileSync('/usr/bin/unzip', ['-Z1', caminho], { timeout: 15000 }).toString().split('\n').filter((n) => /\.(txt|zpl)$/i.test(n));
  let zpl = '';
  for (const n of nomes) {
    const t = execFileSync('/usr/bin/unzip', ['-p', caminho, n.replace(/[\[\]*?]/g, '\\$&')], { timeout: 30000, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    if (/\^XA/.test(t)) zpl += t + '\n';
  }
  return zpl;
}

// Apaga de vez o arquivo baixado quando todas as etiquetas que vieram dele já imprimiram.
// Enquanto alguma estiver parada na fila, o arquivo fica. Só vale para arquivos que a vigia importou.
function apagarSeImprimiu(arquivo) {
  if (!arquivo || !cfg.limparDownloads) return;
  const dele = pedidos.filter((p) => p.arquivo === arquivo);
  if (!dele.length || !dele.every((p) => p.estado === 'impresso')) return;
  try {
    fs.rmSync(arquivo, { force: true });
    for (const p of dele) p.arquivo = '';
    log(`arquivo apagado depois de imprimir: ${path.basename(arquivo)}`);
  } catch (e) { log(`não deu para apagar ${path.basename(arquivo)}: ${e.message}`); }
}

// Vigia a pasta Downloads: etiqueta baixada do Mercado Livre ou da Shopee entra sozinha.
// Idempotente: cada arquivo (nome + tamanho + data) é processado uma vez só, mesmo após reiniciar.
const PASTA = process.env.ETIQUETA_DOWNLOADS ? path.resolve(process.env.ETIQUETA_DOWNLOADS) : path.join(require('os').homedir(), 'Downloads');
const lotesTikTok = new Map(); // "<data>" do nome do arquivo -> { etiqueta, nfe }
function descartarNfeTikTok(caminho, nome) {
  log(`TikTok: ${nome} não imprime separado; o DANFE simplificado vai junto na etiqueta de envio`);
  if (cfg.limparDownloads) { try { fs.rmSync(caminho, { force: true }); } catch (_) { /* fica */ } }
}
async function imprimirNfeSozinha(lote) {
  const l = lotesTikTok.get(lote);
  if (!l || !l.nfe || l.etiqueta) return;
  const { caminho, nome } = l.nfe; l.nfe = null;
  log(`TikTok: a etiqueta de envio do lote ${lote} não chegou em 10 min; imprimindo ${nome} sozinho`);
  try {
    const feitos = await receberZpl(lerZplDeArquivo(caminho), { origem: 'Downloads' });
    for (const p of feitos) p.arquivo = caminho;
    apagarSeImprimiu(caminho);
    for (const c of l.copias || []) if (cfg.limparDownloads) { try { fs.rmSync(c, { force: true }); } catch (_) { /* fica */ } }
    l.copias = [];
  } catch (e) { log(`ERRO ao imprimir ${nome}: ${e.message}`); }
}
// a NF-e e a etiqueta do mesmo lote podem sair com 1 ou 2 segundos de diferença no nome
// ("23-53-08_NF-e.txt" e "23-53-09_Shipping label.txt"): junta no lote já aberto até 5 s antes ou depois
function segundosDoLote(l) { const [mm, dd, h, mi, se] = l.split(/[-_]/).map(Number); return (((mm * 31 + dd) * 24 + h) * 60 + mi) * 60 + se; }
function loteTikTok(l) {
  if (!l) return l;
  if (lotesTikTok.has(l)) return l;
  const s = segundosDoLote(l);
  for (const k of lotesTikTok.keys()) if (Math.abs(segundosDoLote(k) - s) <= 5) return k;
  return l;
}
const ARQ_VISTOS = path.join(DADOS, 'logs', 'arquivos-vistos.json');
let vistos = {};
try { vistos = JSON.parse(fs.readFileSync(ARQ_VISTOS, 'utf8')); } catch (_) { /* primeira vez */ }
const vigia = { ativo: false, texto: 'Desligado' };
// .zip só com nome de etiqueta; .txt/.zpl qualquer nome (o TikTok baixa "<data>_Packing slip.txt" e
// "<data>_Shipping label.txt"), desde que o conteúdo seja ZPL (lerZplDeArquivo confere o ^XA)
const NOME_ETIQUETA = /etiqueta|shipping|label|envio|zpl|packing|slip|tiktok/i;
let varrendo = false;
async function varrerDownloads(inicial) {
  if (varrendo || !cfg.vigiarDownloads) { if (!cfg.vigiarDownloads) { vigia.ativo = false; vigia.texto = 'Desligado'; } return; }
  varrendo = true;
  try {
    const agora = Date.now();
    for (const nome of fs.readdirSync(PASTA)) {
      if (!/\.(zip|txt|zpl)$/i.test(nome) || (/\.zip$/i.test(nome) && !NOME_ETIQUETA.test(nome))) continue;
      const caminho = path.join(PASTA, nome);
      let st; try { st = fs.statSync(caminho); } catch (_) { continue; }
      if (!st.isFile() || st.size === 0 || st.size > 64 * 1024 * 1024 || (!/\.zip$/i.test(nome) && st.size > 8 * 1024 * 1024)) continue;
      const chave = `${nome}|${st.size}|${Math.round(st.mtimeMs)}`;
      if (vistos[chave]) continue;
      // o Chrome baixa em .crdownload e só renomeia no fim; a folga curta cobre outros navegadores
      if (agora - st.mtimeMs < 400) { setTimeout(varrerJa, 450); continue; } // ainda baixando: pega já já
      vistos[chave] = agora;
      // TikTok Shop: o mesmo lote vem em dois arquivos ("<data>_NF-e.txt" e "<data>_Shipping label.txt").
      // A etiqueta de envio já sai casada com a DANFE (chave + faixa fiscal), então o arquivo de NF-e
      // do mesmo lote não é impresso. Se a etiqueta não chegar em 10 minutos, a NF-e imprime sozinha.
      const lote = loteTikTok((nome.match(/^(\d{2}-\d{2}_\d{2}-\d{2}-\d{2})_/) || [])[1]);
      if (!inicial && lote && /_NF-e/i.test(nome)) {
        const l = lotesTikTok.get(lote) || {};
        lotesTikTok.set(lote, l);
        if (l.etiqueta) { descartarNfeTikTok(caminho, nome); continue; }
        // o navegador às vezes baixa em dobro ("NF-e (1).txt"): guarda todas as cópias para apagar juntas
        if (l.nfe) { l.copias = (l.copias || []).concat(caminho); log(`TikTok: ${nome} é cópia de ${l.nfe.nome}; será apagado junto`); continue; }
        l.nfe = { caminho, nome, relogio: setTimeout(() => imprimirNfeSozinha(lote), 10 * 60 * 1000) };
        log(`TikTok: ${nome} guardado; a DANFE sai junto com a etiqueta de envio do mesmo lote (até 10 min)`);
        continue;
      }
      let danfesTikTok = null;
      if (!inicial && lote && /_Shipping label/i.test(nome)) {
        const l = lotesTikTok.get(lote) || {};
        lotesTikTok.set(lote, l);
        // o TikTok baixa a NF-e e a etiqueta quase juntas: espera a NF-e do lote por até 15 s
        if (!l.nfe && (!l.espera || agora - l.espera < 15000)) { if (!l.espera) l.espera = agora; delete vistos[chave]; continue; }
        l.etiqueta = true;
        if (l.nfe) {
          clearTimeout(l.nfe.relogio);
          try {
            const { separarEnvios: sep } = require('./etiqueta');
            danfesTikTok = [];
            for (const pg of sep(lerZplDeArquivo(l.nfe.caminho))) danfesTikTok.push((await montar(pg, 'cheio'))[0].img);
          } catch (e) { log(`TikTok: não li as páginas de ${l.nfe.nome} (${e.message}); sai a faixa simples`); danfesTikTok = null; }
          descartarNfeTikTok(l.nfe.caminho, l.nfe.nome); l.nfe = null;
          for (const c of l.copias || []) if (cfg.limparDownloads) { try { fs.rmSync(c, { force: true }); } catch (_) { /* fica */ } }
          l.copias = [];
        }
      }
      // na primeira volta só marca o que já existia, para não imprimir arquivo antigo
      if (!inicial) {
        try {
          const zpl = lerZplDeArquivo(caminho);
          if (zpl) {
            log(`arquivo novo em Downloads: ${nome}`);
            // não espera imprimir: o próximo arquivo (ex.: o 2º pacote de um lote grande) já entra e
            // as etiquetas dele vão para a mesma fila, sem buraco entre um pacote e outro
            receberZpl(zpl, { origem: 'Downloads', danfesTikTok }).then((feitos) => {
              // o arquivo só é apagado depois que TODAS as etiquetas dele imprimirem (ver apagarSeImprimiu)
              for (const p of feitos) p.arquivo = caminho;
              apagarSeImprimiu(caminho);
              // arquivo só com cópias do que já veio pelo site: não tem mais serventia
              if (!feitos.length && feitos.ignorados && cfg.limparDownloads) {
                try { fs.rmSync(caminho, { force: true }); log(`arquivo apagado (cópia do que já foi impresso): ${nome}`); } catch (_) { /* fica */ }
              }
            }).catch((e) => log(`ERRO ao ler ${nome}: ${e.message}`));
          }
        } catch (e) { log(`ERRO ao ler ${nome}: ${e.message}`); }
      }
    }
    for (const k of Object.keys(vistos)) if (agora - vistos[k] > 30 * 24 * 3600 * 1000) delete vistos[k];
    fs.writeFileSync(ARQ_VISTOS, JSON.stringify(vistos));
    vigia.ativo = true; vigia.texto = 'Vigiando a pasta Downloads';
  } catch (e) {
    vigia.ativo = false;
    vigia.texto = /EPERM|EACCES|not permitted/i.test(e.message) ? 'Sem permissão para ler a pasta Downloads' : `Pasta Downloads: ${e.message}`;
  }
  varrendo = false;
}
// arquivo novo em Downloads entra na hora (aviso do sistema); a volta a cada 1 s fica de reserva
let varrerDeNovo = false, relogioVigia = null;
async function varrerJa() {
  if (varrendo) { varrerDeNovo = true; return; }
  await varrerDownloads(false);
  if (varrerDeNovo) { varrerDeNovo = false; setTimeout(varrerJa, 150); }
}
function iniciarVigia() {
  varrerDownloads(true).then(() => {
    setInterval(varrerJa, 1000);
    try {
      fs.watch(PASTA, { persistent: false }, () => { clearTimeout(relogioVigia); relogioVigia = setTimeout(varrerJa, 200); });
    } catch (e) { log(`aviso de arquivo novo indisponível (${e.message}); conferindo a cada 1 s`); }
  });
}

// Reimpressão automática: no modo direto, etiqueta que falhou por falta de conexão
// é reenviada assim que alguma impressora estiver disponível (até 30 minutos depois).
let repetindo = false;
setInterval(async () => {
  if (repetindo || cfg.imprimir !== 'direto') return;
  const pendentes = pedidos.filter((p) => p.repetir && p.estado === 'erro' && Date.now() - new Date(p.hora).getTime() < 1800000).reverse();
  if (!pendentes.length || !conexoesDisponiveis().length) return;
  repetindo = true;
  for (const p of pendentes) {
    try { await imprimirPedido(p.jid); p.repetir = false; log(`reenviado sozinho: envio ${p.id}`); } catch (e) { /* segue pendente */ }
  }
  repetindo = false;
}, 5000);

// Trabalho vindo do driver de sistema (qualquer programa do Mac). Cada página vira um item da
// fila, com prévia, igual às etiquetas dos marketplaces: aparece no painel, pode ser reimpressa
// e, se a impressora não estiver disponível, fica parada e sai sozinha quando ela voltar.
function paginasDoTspl(bytes) {
  const paginas = [];
  const txt = bytes.toString('latin1');
  const re = /BITMAP \d+,\d+,(\d+),(\d+),[012],/g;
  let m;
  while ((m = re.exec(txt))) {
    const lb = Number(m[1]), alt = Number(m[2]);
    const ini = m.index + m[0].length;
    if (!lb || !alt || ini + lb * alt > bytes.length) break;
    const img = { l: 800, a: 1200, bits: new Uint8Array(800 * 1200) };
    for (let y = 0; y < alt && y < 1200; y++) {
      for (let x = 0; x < lb * 8 && x < 800; x++) {
        if (!((bytes[ini + y * lb + (x >> 3)] >> (7 - (x & 7))) & 1)) img.bits[y * 800 + x] = 1; // no TSPL, bit 0 = preto
      }
    }
    paginas.push(img);
    re.lastIndex = ini + lb * alt;
  }
  return paginas;
}
let seqBruto = 0;
async function enviarBruto(bytes) {
  const inicio = bytes.toString('latin1', 0, Math.min(bytes.length, 4096));
  // o filtro do driver achou código ZPL no documento (arquivo .txt de etiqueta aberto e mandado
  // imprimir pelo Mac): desenha a etiqueta em vez de imprimir o código como texto
  if (inicio.startsWith('%ETIQUETA-ZPL')) {
    const zpl = bytes.toString('utf8').replace(/^%ETIQUETA-ZPL\r?\n/, '');
    const feitos = await receberZpl(zpl, { origem: 'Imprimir do Mac', repetir: true });
    log(`documento com código ZPL impresso pelo Mac: ${feitos.length} etiqueta(s) desenhada(s)`);
    return;
  }
  if (bytes.length < 20 || !/SIZE \d/.test(inicio)) throw new Error('o trabalho não é TSPL');
  const paginas = paginasDoTspl(bytes);
  if (!paginas.length) { // comando sem imagem: manda como veio
    await enviar(() => bytes, `${carimbo()}-driver-${++seqBruto}`);
    return;
  }
  const n = ++seqBruto;
  for (const [i, img] of paginas.entries()) {
    const p = registrar(`Documento ${n}${paginas.length > 1 ? ` (pág. ${i + 1})` : ''}`, 'impresso por outro programa', 'driver', img);
    if (cfg.imprimir === 'direto') await imprimirPedido(p.jid).catch((e) => { p.repetir = true; log(`ERRO ao imprimir ${p.id}: ${e.message} (vai tentar de novo sozinho)`); });
  }
  log(`${cfg.imprimir === 'direto' ? 'impresso' : 'aguardando conferência'}: documento ${n} do driver de sistema (${paginas.length} página(s))`);
}

// ---------- diagnóstico ----------
async function diagnostico(tipo) {
  if (tipo === 'regua') {
    const p = registrar('', 'régua de calibração', 'painel', await etiquetaRegua());
    await imprimirPedido(p.jid);
    return p;
  }
  const comandos = {
    autoteste: `${PREAMBULO}SELFTEST\r\n`,
    // <ESC>!R reinicia a impressora e apaga o que estava na memória dela (útil depois de papel travado)
    reiniciar: '\x1b!R',
    // enche de branco o que a impressora ainda esperava de uma etiqueta incompleta e fecha a linha
    destravar: '\xff'.repeat(130000) + '\r\n\r\nCLS\r\n',
    detectar: `${PREAMBULO}SIZE 100 mm,150 mm\r\nGAP ${cfg.calib.gapMm} mm,0 mm\r\nGAPDETECT\r\n`,
    avancar: `${PREAMBULO}SIZE 100 mm,150 mm\r\nGAP ${cfg.calib.gapMm} mm,0 mm\r\nFORMFEED\r\n`,
  };
  if (!comandos[tipo]) throw new Error('diagnóstico desconhecido');
  await enviar(() => Buffer.from(comandos[tipo], 'latin1'), `${carimbo()}-${tipo}`);
  return { tipo };
}

// O driver do fabricante está instalado neste Mac? (filtro e modelos que o instalador dele grava)
function driverDoFabricante() {
  try {
    const filtro = fs.existsSync('/Library/Printers/LabelPOS/rastertodlabel');
    const modelos = fs.readdirSync('/Library/Printers/PPDs/Contents/Resources').filter((n) => /^Label_TSPL/i.test(n)).length;
    return { instalado: filtro || modelos > 0, modelos };
  } catch (_) { return { instalado: false, modelos: 0 }; }
}

// Uma impressora com o NOSSO driver de sistema já está instalada neste Mac?
function driverProprio() {
  try { return fs.existsSync('/Library/Printers/EtiquetaTermica/rastertotspl'); } catch (_) { return false; }
}

function estado() {
  const config = { ...cfg, loja: cfg.loja ? { url: cfg.loja.url, temChave: !!(cfg.loja.chave && cfg.loja.segredo) } : undefined, ml: cfg.ml ? { appId: cfg.ml.appId, conectado: !!(cfg.ml.tokens && cfg.ml.tokens.refresh) } : undefined, mlEtiquetas: cfg.mlEtiquetas ? { ligado: !!cfg.mlEtiquetas.ligado, contas: (cfg.mlEtiquetas.contas || []).map((c) => c.apelido) } : undefined };
  return { config, limites: LIMITES, bleVivo: bleVivo(), bt: Date.now() - bleInfo.quando < 8000 ? bleInfo.bt : undefined, conector: { instalado: fs.existsSync(path.join(RAIZ, 'conector-bluetooth', 'conector-bluetooth')), rodando: Date.now() - bleInfo.quando < 20000 }, driver: driverDoFabricante(), driverProprio: driverProprio(), vigia, fila: situacaoFila(), conexoes: listarConexoes(), pedidos, log: ultimasLinhas.slice(-25).reverse() };
}

// TikTok sem baixar: a extensão lê os arquivos da janela "Imprimir resultado" direto da página e manda
// o conteúdo aqui (nada cai em Downloads). Mesma regra da vigia: a etiqueta de envio sai casada com a
// DANFE do mesmo lote; NF-e sem etiqueta no lote, ou outro documento, sai sozinho.
const LOTE_TT = /^(\d{2}-\d{2}_\d{2}-\d{2}-\d{2})_/;
async function receberArquivosTikTok(arquivos) {
  const lista = (Array.isArray(arquivos) ? arquivos : []).slice(0, 20)
    .map((a) => ({ nome: String((a && a.nome) || '').slice(0, 120), zpl: String((a && a.conteudo) || '') }))
    .filter((a) => /\^XA/i.test(a.zpl) && a.zpl.length <= 8 * 1024 * 1024);
  if (!lista.length) throw new Error('nenhum arquivo com etiqueta em ZPL');
  const lote = (a) => (a.nome.match(LOTE_TT) || [])[1] || '';
  const etiquetas = lista.filter((a) => /_Shipping label/i.test(a.nome));
  const nfes = lista.filter((a) => /_NF-e/i.test(a.nome));
  const outros = lista.filter((a) => !etiquetas.includes(a) && !nfes.includes(a));
  const usadas = new Set();
  const { separarEnvios: sep } = require('./etiqueta');
  let n = 0;
  for (const e of etiquetas) {
    // NF-e do mesmo lote (nome igual ou até 5 s de diferença); com um só par no envio, casa direto
    const par = nfes.find((x) => !usadas.has(x) && lote(x) && lote(e) && Math.abs(segundosDoLote(lote(x)) - segundosDoLote(lote(e))) <= 5)
      || (etiquetas.length === 1 && nfes.length === 1 ? nfes[0] : null);
    let danfesTikTok = null;
    if (par) {
      usadas.add(par);
      try { danfesTikTok = []; for (const pg of sep(par.zpl)) danfesTikTok.push((await montar(pg, 'cheio'))[0].img); }
      catch (err) { log(`TikTok: não li as páginas de ${par.nome} (${err.message}); sai a faixa simples`); danfesTikTok = null; }
    }
    log(`TikTok (sem baixar): ${e.nome}${par ? ' + ' + par.nome : ''}`);
    n += (await receberZpl(e.zpl, { origem: 'TikTok', danfesTikTok, esperarImpressao: false })).length;
  }
  for (const a of nfes.filter((x) => !usadas.has(x)).concat(outros)) {
    log(`TikTok (sem baixar): ${a.nome}`);
    n += (await receberZpl(a.zpl, { origem: 'TikTok', esperarImpressao: false })).length;
  }
  return { arquivos: lista.length, etiquetas: n };
}

module.exports = { receberArquivosTikTok, ehTermica, usbEscolhida, conexoesDisponiveis, DADOS, rastreiosImpressosTikTok, enviarBruto, bleInformar, lerZplDeArquivo, iniciarVigia, bleProximo, bleFeito, receberZpl, imprimirPedido, descartarPedido, diagnostico, salvarConfig, estado, log, cfg, RAIZ };
