import { CircleAlert, CircleCheck, Clock3, LoaderCircle, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type EstadoPedido, type Pedido } from '@/lib/ponte'

// Cada estado tem texto, ícone e cor; a cor nunca é a única pista.
export const ESTADOS: Record<EstadoPedido, { rotulo: string; icone: React.ElementType; classe: string }> = {
  aguardando: { rotulo: 'Aguardando', icone: Clock3, classe: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300' },
  enviando: { rotulo: 'Imprimindo', icone: LoaderCircle, classe: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300' },
  impresso: { rotulo: 'Impressa', icone: CircleCheck, classe: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300' },
  erro: { rotulo: 'Falhou', icone: CircleAlert, classe: 'border-destructive/30 bg-destructive/10 text-destructive' },
  descartado: { rotulo: 'Descartada', icone: Trash2, classe: 'border-border bg-muted text-muted-foreground' },
}

export function SeloEstado({ estado }: { estado: EstadoPedido }) {
  const e = ESTADOS[estado] ?? ESTADOS.aguardando
  const Icone = e.icone
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap', e.classe)}>
      <Icone className={cn('size-3.5', estado === 'enviando' && 'animate-spin motion-reduce:animate-none')} aria-hidden='true' />
      {e.rotulo}
    </span>
  )
}

// Origem legível: "ML Trend Toy", "Shopee", "Downloads", "https://vendedores.mercadolivre.com.br" → "Mercado Livre".
export function origemLegivel(p: Pick<Pedido, 'origem' | 'tipo' | 'id'>) {
  const o = `${p.origem} ${p.tipo} ${p.id}`.toLowerCase()
  if (o.includes('shopee')) return 'Shopee'
  if (o.includes('tiktok')) return 'TikTok'
  if (o.includes('mercadoli') || o.startsWith('ml ') || /\bml\b/.test(o) || o.includes('danfe') || o.includes('dace')) return 'Mercado Livre'
  if (o.includes('régua') || o.includes('teste')) return 'Teste'
  if (o.includes('sku') || o.includes('produto')) return 'Produto'
  return 'Arquivo'
}

export const naFila = (p: Pedido) => p.estado === 'aguardando' || p.estado === 'enviando' || p.estado === 'erro'
