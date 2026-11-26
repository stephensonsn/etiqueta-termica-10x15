import { describe, expect, it } from 'vitest'
import { type Pedido } from '@/lib/ponte'
import { naFila, origemLegivel } from './estado'

const pedido = (p: Partial<Pedido>): Pedido => ({ jid: '1-1', id: '', tipo: '', origem: '', hora: '2026-11-26T10:00:00Z', estado: 'aguardando', ...p })

describe('Fila: origem e estado', () => {
  it('reconhece a origem pelo texto que a ponte grava', () => {
    expect(origemLegivel(pedido({ origem: 'https://vendedores.mercadolivre.com.br' }))).toBe('Mercado Livre')
    expect(origemLegivel(pedido({ origem: 'ML Trend Toy' }))).toBe('Mercado Livre')
    expect(origemLegivel(pedido({ id: 'Shopee 2bc866', tipo: 'envio + DACE (Shopee)' }))).toBe('Shopee')
    expect(origemLegivel(pedido({ id: 'TikTok NF 123', tipo: 'envio + Danfe (TikTok)' }))).toBe('TikTok')
    expect(origemLegivel(pedido({ origem: 'painel', tipo: 'régua de calibração' }))).toBe('Teste')
    expect(origemLegivel(pedido({ origem: 'Downloads', tipo: 'envio' }))).toBe('Arquivo')
  })
  it('na fila = aguardando, imprimindo ou com falha', () => {
    expect(['aguardando', 'enviando', 'erro', 'impresso', 'descartado'].map((estado) => naFila(pedido({ estado: estado as Pedido['estado'] }))))
      .toEqual([true, true, true, false, false])
  })
})
