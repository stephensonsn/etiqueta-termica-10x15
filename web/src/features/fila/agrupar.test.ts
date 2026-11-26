import { describe, expect, it } from 'vitest'
import { type Pedido } from '@/lib/ponte'
import { agruparPorDia, FILTRO, ordemDeImpressao, resumoLote, vezesImpresso } from './agrupar'

const p = (x: Partial<Pedido>): Pedido => ({ jid: '1-1', id: '', tipo: '', origem: '', hora: '2026-11-26T13:00:00Z', estado: 'aguardando', ...x })
const AGORA = new Date('2026-11-26T15:00:00Z') // 12h em São Paulo

describe('Fila: agrupar, ordenar e contar', () => {
  it('agrupa em Hoje, Ontem e data, mantendo a ordem', () => {
    const g = agruparPorDia([p({ jid: 'a', hora: '2026-11-26T14:00:00Z' }), p({ jid: 'b', hora: '2026-11-25T20:00:00Z' }), p({ jid: 'c', hora: '2026-11-23T12:00:00Z' })], AGORA)
    expect(g.map((x) => x.rotulo.toLowerCase())).toEqual(['hoje', 'ontem', expect.stringContaining('23/11')])
    expect(g[0].itens.map((x) => x.jid)).toEqual(['a'])
  })
  it('meia-noite conta pelo fuso de São Paulo', () => {
    // 01:30 UTC do dia 26 = 22:30 do dia 25 em São Paulo → Ontem
    expect(agruparPorDia([p({ hora: '2026-11-26T01:30:00Z' })], AGORA)[0].rotulo).toBe('Ontem')
  })
  it('lote imprime da mais antiga para a mais nova', () => {
    const ordem = ordemDeImpressao([p({ jid: 'n', hora: '2026-11-26T14:00:00Z' }), p({ jid: 'v', hora: '2026-11-26T10:00:00Z' })])
    expect(ordem.map((x) => x.jid)).toEqual(['v', 'n'])
  })
  it('vezes impressa soma as cópias do mesmo envio', () => {
    const todos = [p({ jid: 'a', id: 'TikTok NF 42', impressoes: 2 }), p({ jid: 'b', id: 'TikTok NF 42', impressoes: 1 }), p({ jid: 'c', id: 'outro', impressoes: 1 })]
    expect(vezesImpresso(todos[0], todos)).toBe(3)
    expect(vezesImpresso(p({ id: '', impressoes: 1 }), todos)).toBe(1)
  })
  it('abas: falha fica só em Com falha', () => {
    expect(FILTRO.fila(p({ estado: 'erro' }))).toBe(false)
    expect(FILTRO.falhas(p({ estado: 'erro' }))).toBe(true)
    expect(FILTRO.fila(p({ estado: 'enviando' }))).toBe(true)
  })
  it('resumo do lote', () => {
    expect(resumoLote(3, 0)).toBe('3 etiquetas enviadas para a impressora')
    expect(resumoLote(0, 2)).toBe('As 2 etiquetas falharam')
    expect(resumoLote(2, 1)).toBe('2 enviada(s) e 1 com falha')
  })
})
