import { describe, expect, it } from 'vitest'
import { type Estado } from '@/lib/ponte'
import { etapaPronta, liberacoes } from './assistente'
import { conexoes, diagnostico } from './regras'

const base = (x: Partial<Estado> = {}, conexao: Record<string, unknown> = { tipo: 'usb' }): Estado => ({
  config: { porta: 9100, fila: '', imprimir: 'direto', modo: 'junto', vigiarDownloads: true, limparDownloads: true, guardarHistorico: false, configurado: true,
    calib: { deslocXmm: 0, deslocYmm: 0, densidade: 6, velocidade: 4, gapMm: 2, offsetMm: 2, faixaLinhas: 0, crlfInicial: true }, conexao: conexao as Estado['config']['conexao'] },
  limites: {}, fila: { ok: true, texto: 'Impressora pronta' }, conexoes: { usb: [], bluetooth: [] }, pedidos: [], log: [], vigia: { ativo: true, texto: '' }, ...x,
})

describe('Impressora: conexões', () => {
  it('USB sem fila no macOS usa a uri; com fila usa a fila', () => {
    const semFila = conexoes(base({ conexoes: { usb: [{ fila: '', nome: 'OIA', ligada: true, semFila: true, uri: 'usb://x' }], bluetooth: [] } }, { tipo: 'ble' }))
    expect(semFila[0].usar).toEqual({ tipo: 'usb', uri: 'usb://x' })
    const comFila = conexoes(base({ conexoes: { usb: [{ fila: 'Termica', nome: 'OIA', ligada: true }], bluetooth: [] } }, { tipo: 'ble' }))
    expect(comFila[0].usar).toEqual({ tipo: 'usb', fila: 'Termica' })
  })
  it('em uso não oferece Usar; desligada também não', () => {
    const e = base({ conexoes: { usb: [{ fila: '', nome: 'OIA', ligada: true, semFila: true, uri: 'usb://x' }], bluetooth: [] } })
    expect(conexoes(e)[0]).toMatchObject({ emUso: true, usar: undefined })
    const desl = conexoes(base({ conexoes: { usb: [{ fila: 'T', nome: 'OIA', ligada: false }], bluetooth: [] } }, { tipo: 'ble' }))
    expect(desl[0]).toMatchObject({ emUso: false, usar: undefined, detalhe: 'OIA está desligada ou sem cabo' })
  })
  it('Bluetooth pareado só aparece se existir ou estiver em uso', () => {
    expect(conexoes(base()).map((c) => c.chave)).toEqual(['usb', 'ble', 'rede'])
    expect(conexoes(base({}, { tipo: 'bluetooth' })).find((c) => c.chave === 'bluetooth')?.detalhe).toMatch(/porta sumiu/)
  })
  it('rede: digitar um IP oferece Usar com porta 9100', () => {
    expect(conexoes(base({}, { tipo: 'rede', host: '10.0.0.5' })).slice(-1)[0]).toMatchObject({ emUso: true })
    expect(conexoes(base({}, { tipo: 'rede', host: '10.0.0.5' }), '10.0.0.9').slice(-1)[0]?.usar).toEqual({ tipo: 'rede', host: '10.0.0.9', portaRede: 9100 })
  })
})

describe('Impressora: diagnóstico e assistente', () => {
  it('Bluetooth bloqueado pede a liberação; liberado fica pronto', () => {
    const bloq = diagnostico(base({ bt: 3, conector: { instalado: true, rodando: true } }, { tipo: 'ble' }))
    expect(bloq[0]).toMatchObject({ chave: 'bt', ok: false, acao: { corpo: { qual: 'bluetooth' } } })
    expect(diagnostico(base({ bt: 5, conector: { instalado: true, rodando: true } }, { tipo: 'ble' }))[0].ok).toBe(true)
  })
  it('Mercado Livre conta como visto por 15 minutos', () => {
    const agora = 1_000_000_000
    expect(diagnostico(base({ siteVisto: agora - 60000 }), { agora }).find((c) => c.chave === 'ml')?.ok).toBe(true)
    expect(diagnostico(base({ siteVisto: agora - 16 * 60000 }), { agora }).find((c) => c.chave === 'ml')?.ok).toBe(false)
  })
  it('etapas só liberam quando prontas', () => {
    const e = base({ vigia: { ativo: false, texto: 'Sem permissão para ler a pasta Downloads' } })
    expect(etapaPronta(1, { e, metodo: null, testeOk: false, semMl: false })).toBe(false)
    expect(etapaPronta(2, { e, metodo: 'usb', testeOk: false, semMl: false })).toBe(false)
    expect(liberacoes(base({ bt: 4, conector: { instalado: true, rodando: true } }), 'ble').map((c) => c.chave)).toEqual(['bt', 'downloads'])
    expect(etapaPronta(3, { e: base(), metodo: 'usb', testeOk: false, semMl: false })).toBe(true)
    expect(etapaPronta(3, { e: base(), metodo: 'rede', testeOk: false, semMl: false })).toBe(false)
    expect(etapaPronta(5, { e: base(), metodo: 'usb', testeOk: true, semMl: true })).toBe(true)
  })
})
