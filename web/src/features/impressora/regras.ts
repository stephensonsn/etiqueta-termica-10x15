// Regras das conexões e do diagnóstico: as mesmas do painel antigo (src/painel.html), em funções
// puras para testar. A tela só desenha o que estas funções decidem.
import { type Conexao, type Estado } from '@/lib/ponte'

export type CartaoConexao = {
  chave: 'usb' | 'ble' | 'bluetooth' | 'rede'
  titulo: string
  detalhe: string
  emUso: boolean
  usar?: Conexao // corpo de /api/config {conexao} quando dá para usar esta
}

export function conexoes(e: Estado, hostDigitado?: string): CartaoConexao[] {
  const tipo = e.config.conexao.tipo
  const usb = e.conexoes.usb.find((u) => u.ligada) ?? e.conexoes.usb[0]
  const usbEmUso = tipo === 'usb' && !!usb?.ligada && (!usb.semFila || !e.config.fila)
  const lista: CartaoConexao[] = [
    {
      chave: 'usb', titulo: 'Cabo USB',
      detalhe: !usb ? 'Nenhuma impressora encontrada no USB' : usb.ligada ? `${usb.nome} ligada no cabo` : `${usb.nome} está desligada ou sem cabo`,
      emUso: usbEmUso,
      usar: !usbEmUso && usb?.ligada && (tipo !== 'usb' || usb.semFila) ? (usb.semFila ? { tipo: 'usb', uri: usb.uri } : { tipo: 'usb', fila: usb.fila }) : undefined,
    },
    {
      chave: 'ble', titulo: 'Bluetooth',
      detalhe: tipo === 'ble' && e.bleVivo ? `Conectada${e.config.conexao.bleNome ? ` em ${e.config.conexao.bleNome}` : ''}. Liga sozinha e reconecta se cair`
        : e.config.conexao.bleNome ? `Procurando ${e.config.conexao.bleNome}… deixe a impressora ligada e perto` : 'Escolha a impressora uma vez (no Google Chrome)',
      emUso: tipo === 'ble' && !!e.bleVivo,
      usar: tipo !== 'ble' && e.bleVivo ? { tipo: 'ble' } : undefined,
    },
  ]
  const bt = e.conexoes.bluetooth[0]
  if (bt || tipo === 'bluetooth') {
    lista.push({
      chave: 'bluetooth', titulo: 'Bluetooth pareado',
      detalhe: bt ? `${bt.nome || bt.dispositivo} (porta serial do Mac)` : 'A porta sumiu: pareie de novo nos Ajustes do Sistema',
      emUso: tipo === 'bluetooth',
      usar: tipo !== 'bluetooth' && bt ? { tipo: 'bluetooth', dispositivo: bt.dispositivo } : undefined,
    })
  }
  const host = (hostDigitado ?? e.config.conexao.host ?? '').trim()
  const redeEmUso = tipo === 'rede' && hostDigitado === undefined
  lista.push({
    chave: 'rede', titulo: 'Rede',
    detalhe: redeEmUso ? `Imprimindo em ${e.config.conexao.host}:${e.config.conexao.portaRede ?? 9100}` : 'Wi-Fi ou cabo de rede: digite o endereço IP da impressora',
    emUso: redeEmUso,
    usar: !redeEmUso && /^[\w.-]+$/.test(host) ? { tipo: 'rede', host, portaRede: 9100 } : undefined,
  })
  return lista
}

export type Checagem = {
  chave: string
  titulo: string
  detalhe: string
  ok: boolean
  opcional?: boolean
  acao?: { rotulo: string; rota: string; corpo: Record<string, unknown> }
}

// metodo: no assistente, o método escolhido vale antes de virar a conexão em uso
export function diagnostico(e: Estado, { agora = Date.now(), metodo }: { agora?: number; metodo?: string | null } = {}): Checagem[] {
  const lista: Checagem[] = []
  const ble = (metodo ?? e.config.conexao.tipo) === 'ble'
  if (ble) {
    if (e.conector?.instalado === false) lista.push({ chave: 'conector', titulo: 'Conector Bluetooth', detalhe: 'Não foi instalado: reinstale a ponte pelo instalador', ok: false })
    else if (!e.conector?.rodando && e.bt === undefined) lista.push({ chave: 'conector', titulo: 'Conector Bluetooth', detalhe: 'Instalado, mas não está rodando', ok: false })
    else {
      lista.push({
        chave: 'bt', titulo: 'Bluetooth do Mac', ok: e.bt === 5,
        detalhe: e.bt === 5 ? 'Ligado e liberado para a impressora' : e.bt === 3 ? 'O macOS bloqueou: libere "conector-bluetooth" em Privacidade e Segurança' : e.bt === 4 ? 'Desligado: ligue o Bluetooth do Mac' : 'Esperando o conector responder…',
        acao: e.bt === 3 ? { rotulo: 'Abrir a liberação', rota: '/api/abrir-ajustes', corpo: { qual: 'bluetooth' } }
          : e.bt === 4 ? { rotulo: 'Abrir Bluetooth', rota: '/api/abrir-ajustes', corpo: { qual: 'bluetoothLigar' } } : undefined,
      })
    }
  }
  lista.push({
    chave: 'downloads', titulo: 'Pasta Downloads', ok: !!e.vigia?.ativo,
    detalhe: e.vigia?.ativo ? 'A ponte pega sozinha as etiquetas baixadas' : e.vigia?.texto || 'Parada',
    acao: e.vigia?.ativo || e.vigia?.texto === 'Desligado' ? undefined : { rotulo: 'Abrir a liberação', rota: '/api/abrir-ajustes', corpo: { qual: 'arquivos' } },
  })
  const viu = e.siteVisto && agora - e.siteVisto < 15 * 60000
  lista.push({ chave: 'ml', titulo: 'Mercado Livre achou a ponte', ok: !!viu, opcional: true, detalhe: viu ? 'O botão Imprimir do Mercado Livre já fala com esta ponte' : 'Abra Vendas no Mercado Livre e clique em Imprimir etiqueta uma vez' })
  lista.push({
    chave: 'driver-proprio', titulo: 'Imprimir de outros programas', ok: !!e.driverProprio, opcional: true,
    detalhe: e.driverProprio ? 'PDF ou arquivo de etiqueta impresso pelo Mac sai na térmica' : 'Instale para imprimir na térmica pelo menu Imprimir do Mac',
    acao: e.driverProprio ? undefined : { rotulo: 'Instalar', rota: '/api/instalar-driver', corpo: {} },
  })
  lista.push({
    chave: 'driver-fabricante', titulo: 'Driver do fabricante', ok: !!e.driver?.instalado, opcional: true,
    detalhe: e.driver?.instalado ? 'LabelPrinter instalado' : 'Opcional: o driver oficial da impressora (LabelPrinter 2.3.3)',
    acao: e.driver?.instalado ? undefined : { rotulo: 'Baixar e instalar', rota: '/api/driver-fabricante', corpo: {} },
  })
  return lista
}

export const TESTES = [
  { tipo: 'regua', rotulo: 'Imprimir régua', detalhe: 'Confere se a etiqueta sai inteira e no lugar' },
  { tipo: 'autoteste', rotulo: 'Autoteste da impressora', detalhe: 'A própria impressora imprime a configuração dela' },
  { tipo: 'detectar', rotulo: 'Recalibrar o sensor de papel', detalhe: 'Use depois de trocar o rolo ou se pular etiqueta' },
  { tipo: 'destravar', rotulo: 'Destravar', detalhe: 'Termina uma etiqueta que ficou pela metade na memória' },
  { tipo: 'reiniciar', rotulo: 'Reiniciar a impressora', detalhe: 'Apaga a memória dela; use se travar o papel' },
] as const
