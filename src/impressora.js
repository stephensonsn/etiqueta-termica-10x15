// Pedidos de impressão, envio para a térmica (fila CUPS em modo bruto) e log em arquivo.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { execFile, execFileSync } = require('child_process');
const { montar, separarEnvios, paraPng, paraTspl, paraTsplCompacto, etiquetaRegua, PREAMBULO } = require('./etiqueta');

const RAIZ = path.join(__dirname, '..');
const ARQ_CFG = path.join(RAIZ, 'config.json');
if (!fs.existsSync(ARQ_CFG)) fs.copyFileSync(path.join(RAIZ, 'config.exemplo.json'), ARQ_CFG); // primeira execução
const cfg = JSON.parse(fs.readFileSync(ARQ_CFG, 'utf8'));
if (!cfg.conexao) cfg.conexao = { tipo: 'usb', dispositivo: '', host: '', portaRede: 9100 };
for (const d of ['logs', 'recebidos', 'previa']) fs.mkdirSync(path.join(RAIZ, d), { recursive: true });
// prévias são temporárias: ao iniciar sem histórico, limpa as que sobraram da vez anterior
if (!cfg.guardarHistorico) for (const f of fs.readdirSync(path.join(RAIZ, 'previa'))) fs.rmSync(path.join(RAIZ, 'previa', f), { force: true });

const ultimasLinhas = [];
// Registro: sempre fica na memória (o painel mostra as últimas linhas). Só vai para arquivo
// se "guardar histórico" estiver ligado; desligado, só erros e a partida vão para o registro do serviço.
function log(msg) {
  const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString(); // hora local
  const linha = `${agora.replace('T', ' ').slice(0, 19)} ${msg}`;
  if (cfg.guardarHistorico) fs.appendFileSync(path.join(RAIZ, 'logs', `etiqueta-${agora.slice(0, 10)}.log`), linha + '\n');
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
        // cria uma fila em modo bruto para a impressora que está no cabo (dispensa o driver do fabricante)
        const achada = listarConexoes().usb.find((u) => u.semFila && u.uri === n.uri);
        if (!achada) throw new Error('impressora não encontrada no cabo USB');
        execFileSync('/usr/sbin/lpadmin', ['-p', 'Etiqueta_10x15', '-E', '-v', achada.uri, '-m', 'raw', '-D', 'Etiqueta 10x15'], { timeout: 15000 });
        n.fila = 'Etiqueta_10x15';
        cxCache.quando = 0;
      }
      if (n.fila !== undefined && !listarConexoes().usb.some((u) => u.fila === n.fila)) throw new Error('fila USB não encontrada no macOS');
      if (n.fila) cfg.fila = n.fila;
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
  return cfg;
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
    await new Promise((r) => setTimeout(r, 700));
    const pendentes = await rodar('/usr/bin/lpstat', ['-o', fila], 5000).catch(() => trabalho);
    if (!pendentes.includes(trabalho)) return `trabalho ${trabalho} impresso`;
  }
  await rodar('/usr/bin/cancel', [trabalho], 5000).catch(() => {});
  throw new Error('a impressora não respondeu pelo cabo USB (desligada ou sem cabo)');
}

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
  return { usb, bluetooth };
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
    const prob = bleInfo.respondeAgora ? problemaDaImpressora(bleInfo.estado) : '';
    if (prob) return { ok: false, texto: `Impressora ${prob}` };
    if (bleInfo.jaRespondeu && !bleInfo.respondeAgora) return { ok: false, texto: 'Impressora parou de responder (ligada e por perto?)' };
    if (bleInfo.respondeAgora) return { ok: true, texto: (bleInfo.estado & 0x20) ? 'Imprimindo' : 'Impressora pronta (Bluetooth)' };
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
  const usb = achadas.usb.find((u) => u.ligada && u.fila === cfg.fila);
  const todas = {
    usb: usb ? { tipo: 'usb', fila: usb.fila } : null,
    ble: bleVivo() ? { tipo: 'ble' } : null,
    bluetooth: cx.dispositivo && fs.existsSync(cx.dispositivo) ? { tipo: 'bluetooth', dispositivo: cx.dispositivo } : null,
    rede: cx.tipo === 'rede' && cx.host ? { tipo: 'rede', host: cx.host, portaRede: cx.portaRede } : null,
  };
  return todas[cx.tipo] ? [todas[cx.tipo]] : [];
}

// Manda a etiqueta pela melhor conexão disponível, com nova tentativa e espera crescente.
// "gerar(tipo)" devolve os bytes no formato certo para cada conexão.
async function enviar(gerar, rotulo) {
  let ultimo = new Error(situacaoPreferida().texto || 'impressora não conectada');
  for (let t = 1; t <= cfg.tentativas; t++) {
    const opcoes = conexoesDisponiveis();
    for (const cx of opcoes) {
      const bytes = gerar(cx.tipo);
      const tempo = Math.min(10000 + Math.ceil(bytes.length / 1024) * 50, 60000); // base + por KB, com teto
      const arq = path.join(RAIZ, 'recebidos', `${rotulo}.tspl`);
      try {
        let r;
        if (cx.tipo === 'ble') r = await escreverBle(bytes, 30000 + Math.ceil(bytes.length / 1024) * 1500);
        else if (cx.tipo === 'bluetooth') r = await escreverSerial(cx.dispositivo, bytes, tempo);
        else if (cx.tipo === 'rede') r = await escreverRede(cx.host, cx.portaRede, bytes, tempo);
        else { fs.writeFileSync(arq, bytes); r = await lp(arq, tempo, cx.fila); fs.rmSync(arq, { force: true }); }
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
  if (cfg.conexao.tipo === 'ble') return situacaoBle(); // sem cache: muda a cada segundo
  if (cfg.conexao.tipo === 'rede') {
    valor = { ok: true, texto: `Rede ${cfg.conexao.host}:${cfg.conexao.portaRede}` };
    filaCache = { quando: Date.now(), valor };
    return valor;
  }
  if (!listarConexoes().usb.some((u) => u.ligada && u.fila === cfg.fila)) {
    valor = { ok: false, texto: 'Impressora desligada ou sem cabo' };
    filaCache = { quando: Date.now(), valor };
    return valor;
  }
  try {
    const env = { ...process.env, LANG: 'C', LC_ALL: 'C' };
    const txt = execFileSync('/usr/bin/lpstat', ['-p', cfg.fila], { timeout: 4000, env }).toString();
    const parados = execFileSync('/usr/bin/lpstat', ['-o', cfg.fila], { timeout: 4000, env }).toString().trim().split('\n').filter(Boolean).length;
    if (/disabled|desativad/i.test(txt)) valor = { ok: false, texto: 'Impressora pausada no macOS' };
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

function registrar(id, tipo, origem, img) {
  const jid = `${carimbo()}-${++seq}`;
  const p = { jid, id, tipo, origem, hora: new Date().toISOString(), estado: 'aguardando', erro: '', impressoes: 0 };
  fs.writeFileSync(path.join(RAIZ, 'previa', `${jid}.png`), paraPng(img));
  pedidos.unshift(p);
  imagens.set(jid, img);
  while (pedidos.length > 40) {
    const velho = pedidos.pop();
    imagens.delete(velho.jid);
    fs.rmSync(path.join(RAIZ, 'previa', `${velho.jid}.png`), { force: true });
  }
  return p;
}

async function imprimirPedido(jid) {
  const p = pedidos.find((x) => x.jid === jid);
  const img = imagens.get(jid);
  if (!p || !img) throw new Error('pedido não encontrado (a ponte foi reiniciada?)');
  p.estado = 'enviando';
  try {
    // trava aprendida com drivers TSPL prontos: não gastar etiqueta em branco
    if (cobertura(img) < 0.01) throw new Error('etiqueta saiu quase em branco na montagem; não foi enviada');
    await enviar((tipo) => (tipo === 'ble' ? paraTsplCompacto(img, cfg.calib) : paraTspl(img, cfg.calib)), `${p.jid}-${p.id || 'teste'}-${p.tipo}`.replace(/[^\w.+-]+/g, '_'));
    p.estado = 'impresso'; p.erro = ''; p.impressoes++;
    apagarSeImprimiu(p.arquivo);
    // as últimas enviadas ficam na memória (até 40) para reimprimir depois de um papel travado;
    // sem "guardar histórico", nada disso vai para o disco além da prévia temporária
  } catch (e) {
    p.estado = 'erro'; p.erro = e.message;
    if (cfg.imprimir === 'direto') p.repetir = true;
    throw e;
  }
  return p;
}

function descartarPedido(jid) {
  const p = pedidos.find((x) => x.jid === jid);
  if (p && (p.estado === 'aguardando' || p.estado === 'erro')) { p.estado = 'descartado'; p.repetir = false; }
  return p;
}

// Recebe ZPL (um ou vários envios), monta as etiquetas 10x15 e imprime ou segura para conferência.
async function receberZpl(zpl, { origem = 'manual', imprimir = cfg.imprimir === 'direto', modo = cfg.modo } = {}) {
  const envios = separarEnvios(zpl);
  if (!envios.length) throw new Error('ZPL sem etiqueta (^XA...^XZ)');
  const feitos = [];
  for (const [n, envio] of envios.entries()) {
    const hash = crypto.createHash('sha1').update(envio).digest('hex').slice(0, 10);
    const antes = recentes.get(hash);
    const janela = origem === 'Downloads' ? 180 : cfg.janelaDuplicadoSeg;
    if (antes && Date.now() - antes < janela * 1000) {
      log(`ignorado envio repetido em menos de ${janela}s via ${origem} (${hash})`);
      continue;
    }
    recentes.set(hash, Date.now());
    // O Mercado Livre manda a mesma etiqueta por dois caminhos ao mesmo tempo: direto para a ponte
    // e como arquivo baixado. O texto não é idêntico (o site tira quebras de linha), então a
    // comparação é pelo número do envio: o segundo que chegar em até 3 minutos, vindo de outro
    // caminho, é ignorado.
    const numero = (envio.match(/"id":"(\d+)"/) || [])[1];
    const outro = numero && porNumero.get(numero);
    if (outro && outro.origem !== origem && Date.now() - outro.quando < 180000) {
      log(`envio ${numero} já veio por ${outro.origem}; ignorada a cópia que chegou por ${origem}`);
      feitos.ignorados = (feitos.ignorados || 0) + 1;
      continue;
    }
    if (numero) porNumero.set(numero, { origem, quando: Date.now() });
    const etiquetas = await montar(envio, modo);
    const id = etiquetas[0].id || `sem-id-${n + 1}`;
    if (cfg.guardarHistorico) fs.writeFileSync(path.join(RAIZ, 'recebidos', `${carimbo()}-${id}.zpl`), envio);
    for (const e of etiquetas) {
      const p = registrar(id, e.tipo, origem, e.img);
      feitos.push(p);
      if (imprimir) await imprimirPedido(p.jid).catch((err) => { p.repetir = true; log(`ERRO ao imprimir ${id}: ${err.message} (vai tentar de novo sozinho)`); });
    }
    log(`${imprimir ? 'impresso' : 'aguardando conferência'}: envio ${id} via ${origem} (${etiquetas.map((e) => e.tipo).join(', ')})`);
  }
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
const PASTA = path.join(require('os').homedir(), 'Downloads');
const ARQ_VISTOS = path.join(RAIZ, 'logs', 'arquivos-vistos.json');
let vistos = {};
try { vistos = JSON.parse(fs.readFileSync(ARQ_VISTOS, 'utf8')); } catch (_) { /* primeira vez */ }
const vigia = { ativo: false, texto: 'Desligado' };
const NOME_ETIQUETA = /etiqueta|shipping|label|envio|zpl/i;
let varrendo = false;
async function varrerDownloads(inicial) {
  if (varrendo || !cfg.vigiarDownloads) { if (!cfg.vigiarDownloads) { vigia.ativo = false; vigia.texto = 'Desligado'; } return; }
  varrendo = true;
  try {
    const agora = Date.now();
    for (const nome of fs.readdirSync(PASTA)) {
      if (!/\.(zip|txt|zpl)$/i.test(nome) || !NOME_ETIQUETA.test(nome)) continue;
      const caminho = path.join(PASTA, nome);
      let st; try { st = fs.statSync(caminho); } catch (_) { continue; }
      if (!st.isFile() || st.size === 0 || st.size > 64 * 1024 * 1024) continue;
      const chave = `${nome}|${st.size}|${Math.round(st.mtimeMs)}`;
      if (vistos[chave]) continue;
      if (agora - st.mtimeMs < 1500) continue; // ainda baixando: pega na próxima volta
      vistos[chave] = agora;
      // na primeira volta só marca o que já existia, para não imprimir arquivo antigo
      if (!inicial) {
        try {
          const zpl = lerZplDeArquivo(caminho);
          if (zpl) {
            log(`arquivo novo em Downloads: ${nome}`);
            const feitos = await receberZpl(zpl, { origem: 'Downloads' });
            // o arquivo só é apagado depois que TODAS as etiquetas dele imprimirem (ver apagarSeImprimiu)
            for (const p of feitos) p.arquivo = caminho;
            apagarSeImprimiu(caminho);
            // arquivo só com cópias do que já veio pelo site: não tem mais serventia
            if (!feitos.length && feitos.ignorados && cfg.limparDownloads) {
              try { fs.rmSync(caminho, { force: true }); log(`arquivo apagado (cópia do que já foi impresso): ${nome}`); } catch (_) { /* fica */ }
            }
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
function iniciarVigia() {
  varrerDownloads(true).then(() => setInterval(() => varrerDownloads(false), 2000));
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

function estado() {
  return { config: cfg, limites: LIMITES, bleVivo: bleVivo(), driver: driverDoFabricante(), vigia, fila: situacaoFila(), conexoes: listarConexoes(), pedidos, log: ultimasLinhas.slice(-25).reverse() };
}

module.exports = { enviarBruto, bleInformar, lerZplDeArquivo, iniciarVigia, bleProximo, bleFeito, receberZpl, imprimirPedido, descartarPedido, diagnostico, salvarConfig, estado, log, cfg, RAIZ };
