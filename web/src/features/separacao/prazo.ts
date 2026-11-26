import { diaIso } from '@/lib/formato'
import { type ItemSeparacao } from '@/lib/ponte'

export type Prazo = 'hoje' | 'atrasado' | 'futuro' | 'sem'

// Mesma regra da tela antiga: atrasado ou de hoje = do dia; sem prazo reconhecido fica para conferir.
export function prazo(i: ItemSeparacao, hoje = diaIso()): Prazo {
  if (!i.ship_date) return 'sem'
  if (i.ship_late || i.ship_date < hoje) return 'atrasado'
  return i.ship_date === hoje ? 'hoje' : 'futuro'
}

export function gruposDoDia(itens: ItemSeparacao[], hoje = diaIso()) {
  const g = new Set<string>()
  for (const i of itens) if (['hoje', 'atrasado'].includes(prazo(i, hoje))) g.add(i.group)
  return g
}
