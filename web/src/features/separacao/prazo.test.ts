import { describe, expect, it } from 'vitest'
import { type ItemSeparacao } from '@/lib/ponte'
import { gruposDoDia, prazo } from './prazo'

const item = (p: Partial<ItemSeparacao>): ItemSeparacao => ({ id: 'i', group: 'g', channel: 'Mercado Livre', order: '1', package: '', buyer: '', code: '', tracking: '', title: '', sku: '', product_id: '', variation: '', quantity: 1, status: '', ...p })
const HOJE = '2026-11-26'

describe('Separação: prazo de despacho', () => {
  it('classifica hoje, atrasado, futuro e sem prazo', () => {
    expect(prazo(item({ ship_date: HOJE }), HOJE)).toBe('hoje')
    expect(prazo(item({ ship_date: '2026-11-25' }), HOJE)).toBe('atrasado')
    expect(prazo(item({ ship_date: HOJE, ship_late: true }), HOJE)).toBe('atrasado')
    expect(prazo(item({ ship_date: '2026-11-27' }), HOJE)).toBe('futuro')
    expect(prazo(item({}), HOJE)).toBe('sem')
  })
  it('pacote entra no dia se algum item dele é do dia', () => {
    const g = gruposDoDia([
      item({ id: 'a', group: 'p1', ship_date: '2026-11-27' }),
      item({ id: 'b', group: 'p1', ship_date: HOJE }),
      item({ id: 'c', group: 'p2', ship_date: '2026-11-28' }),
      item({ id: 'd', group: 'p3' }),
    ], HOJE)
    expect([...g]).toEqual(['p1'])
  })
})
