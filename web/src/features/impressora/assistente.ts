// Condições de cada etapa do assistente (as mesmas do painel antigo, etapaPronta()).
import { type Estado } from '@/lib/ponte'
import { diagnostico } from './regras'

export type Metodo = 'usb' | 'ble' | 'rede'
export const ETAPAS = ['Conexão', 'Liberações', 'Impressora', 'Teste', 'Mercado Livre'] as const

export function metodoAtual(e: Estado): Metodo | null {
  if (!e.config.configurado) return null
  const t = e.config.conexao.tipo
  return t === 'bluetooth' || t === 'ble' ? 'ble' : t === 'rede' ? 'rede' : t === 'usb' ? 'usb' : null
}

// Liberações: só as checagens obrigatórias (Bluetooth no método ble e pasta Downloads).
export function liberacoes(e: Estado, metodo: Metodo | null) {
  return diagnostico(e, { metodo }).filter((c) => (c.chave === 'downloads') || (metodo === 'ble' && (c.chave === 'bt' || c.chave === 'conector')))
}

export function etapaPronta(etapa: number, x: { e: Estado; metodo: Metodo | null; testeOk: boolean; semMl: boolean; agora?: number }) {
  const { e, metodo } = x
  if (etapa === 1) return !!metodo
  if (etapa === 2) return liberacoes(e, metodo).every((c) => c.ok)
  if (etapa === 3) return e.config.conexao.tipo === metodo && e.fila.ok
  if (etapa === 4) return x.testeOk
  if (etapa === 5) return x.semMl || !!(e.siteVisto && (x.agora ?? Date.now()) - e.siteVisto < 15 * 60000)
  return false
}

export const FALTA: Record<number, string> = {
  1: 'Escolha como a impressora está ligada',
  2: 'Resolva as liberações pendentes',
  3: 'Ligue a impressora e clique em Usar',
  4: 'Imprima o teste e diga se saiu inteira',
  5: 'Abra Vendas no Mercado Livre ou marque que não vende lá',
}
