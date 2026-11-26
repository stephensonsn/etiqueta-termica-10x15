// Cliente da ponte local (127.0.0.1:9100). Todo POST leva o cabeçalho X-Ponte: a ponte recusa
// POST de página que não seja a dela (outro site não consegue mandar cabeçalho próprio sem CORS).
import { useQuery } from '@tanstack/react-query'

export type EstadoPedido = 'aguardando' | 'enviando' | 'impresso' | 'erro' | 'descartado'

export type Pedido = {
  jid: string
  id: string
  tipo: string
  origem: string
  hora: string
  estado: EstadoPedido
  erro?: string
  impressoes?: number
  rastreio?: string
  arquivo?: string
  repetir?: boolean
}

export type Estado = {
  config: {
    porta: number
    conexao: { tipo: string; bleNome?: string; host?: string; dispositivo?: string }
    configurado?: boolean
  }
  bleVivo?: boolean
  fila: { ok: boolean; texto: string }
  pedidos: Pedido[]
  log: string[]
  conector?: { instalado: boolean; rodando: boolean }
}

export type Pendencia = { tipo: string; texto: string; envio?: string }

export class ErroPonte extends Error {}

export async function api<T = unknown>(caminho: string, corpo?: unknown): Promise<T> {
  let r: Response
  try {
    r = await fetch(caminho, corpo === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ponte': '1' }, body: JSON.stringify(corpo) })
  } catch {
    throw new ErroPonte('A ponte não respondeu. Confira se o programa de etiquetas está aberto.')
  }
  const tipo = r.headers.get('content-type') || ''
  const dados = tipo.includes('json') ? await r.json() : null
  if (!r.ok) throw new ErroPonte((dados && (dados.erro || dados.error)) || `A ponte recusou (${r.status}).`)
  return dados as T
}

export async function enviarArquivo(arquivo: File) {
  const r = await fetch('/api/zpl', { method: 'POST', headers: { 'X-Ponte': '1', 'X-Arquivo': encodeURIComponent(arquivo.name) }, body: arquivo })
  if (!r.ok) {
    const j = await r.json().catch(() => ({}))
    throw new ErroPonte(j.erro || 'A ponte não aceitou o arquivo.')
  }
}

export const useEstado = () =>
  useQuery({ queryKey: ['estado'], queryFn: () => api<Estado>('/api/estado'), refetchInterval: 2000, staleTime: 1000 })

export const usePendencias = () =>
  useQuery({ queryKey: ['pendencias'], queryFn: () => api<{ pendencias: Pendencia[] }>('/api/pendencias'), refetchInterval: 15000 })

// ---------- Separação (app Python da pasta separacao/, repassado pela ponte) ----------
export type ItemSeparacao = {
  id: string
  group: string
  channel: string
  order: string
  package: string
  buyer: string
  code: string
  tracking: string
  title: string
  sku: string
  product_id: string
  variation: string
  quantity: number
  status: string
  ship_date?: string
  ship_late?: boolean
  ship_text?: string
}
export type EstadoSeparacao = { items: ItemSeparacao[]; files: string[]; warnings: string[] }

export const useSeparacao = () =>
  useQuery({ queryKey: ['separacao'], queryFn: () => api<EstadoSeparacao>('/api/separacao/state'), refetchInterval: 30000 })
