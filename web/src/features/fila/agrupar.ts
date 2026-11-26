import { diaIso } from '@/lib/formato'
import { type Pedido } from '@/lib/ponte'

export type Aba = 'fila' | 'falhas' | 'impressas' | 'descartadas'

export const FILTRO: Record<Aba, (p: Pedido) => boolean> = {
  fila: (p) => p.estado === 'aguardando' || p.estado === 'enviando',
  falhas: (p) => p.estado === 'erro',
  impressas: (p) => p.estado === 'impresso',
  descartadas: (p) => p.estado === 'descartado',
}

// "Hoje", "Ontem" ou "qui, 20/11", na ordem em que os pedidos vieram (mais novo primeiro).
export function agruparPorDia(pedidos: Pedido[], agora = new Date()) {
  const hoje = diaIso(agora)
  const ontem = diaIso(new Date(agora.getTime() - 864e5))
  const grupos: { dia: string; rotulo: string; itens: Pedido[] }[] = []
  for (const p of pedidos) {
    const dia = diaIso(new Date(p.hora))
    let g = grupos.find((x) => x.dia === dia)
    if (!g) {
      const rotulo = dia === hoje ? 'Hoje' : dia === ontem ? 'Ontem'
        : new Date(p.hora).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
      g = { dia, rotulo, itens: [] }
      grupos.push(g)
    }
    g.itens.push(p)
  }
  return grupos
}

// Impressão em lote: da mais antiga para a mais nova (a ordem em que chegaram do marketplace).
export const ordemDeImpressao = (selecionados: Pedido[]) => [...selecionados].sort((a, b) => (a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0))

// Mesmo envio pode chegar mais de uma vez (baixou de novo): soma as impressões de todas as cópias.
export function vezesImpresso(p: Pedido, todos: Pedido[]) {
  if (!p.id) return p.impressoes ?? 0
  return todos.filter((x) => x.id === p.id).reduce((s, x) => s + (x.impressoes ?? 0), 0)
}

export function resumoLote(ok: number, falhas: number) {
  if (!falhas) return `${ok} ${ok === 1 ? 'etiqueta enviada' : 'etiquetas enviadas'} para a impressora`
  if (!ok) return `${falhas === 1 ? 'A etiqueta falhou' : `As ${falhas} etiquetas falharam`}`
  return `${ok} enviada(s) e ${falhas} com falha`
}
