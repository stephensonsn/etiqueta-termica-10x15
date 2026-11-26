import { CircleAlert, CircleCheck, Inbox, Printer, RotateCcw, Trash2 } from 'lucide-react'
import { dataHora, hora } from '@/lib/formato'
import { type Calib, type EventoPedido, type Pedido } from '@/lib/ponte'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { origemLegivel, SeloEstado } from './estado'

const EVENTO: Record<EventoPedido['tipo'], { rotulo: string; icone: React.ElementType; cor: string }> = {
  chegou: { rotulo: 'Chegou na ponte', icone: Inbox, cor: 'text-muted-foreground' },
  impressa: { rotulo: 'Enviada para a impressora', icone: CircleCheck, cor: 'text-emerald-600 dark:text-emerald-400' },
  falhou: { rotulo: 'Falhou', icone: CircleAlert, cor: 'text-destructive' },
  descartada: { rotulo: 'Tirada da fila', icone: Trash2, cor: 'text-muted-foreground' },
}

export const numeroDoEnvio = (p: Pedido) => p.id.replace(new RegExp(`^${origemLegivel(p)}\\s+`, 'i'), '') || 'Sem número'

// Prévia 10x15 com o deslocamento da calibração (mesma conta do painel antigo: x em %, y em %/1,5).
export function PreviaEtiqueta({ jid, calib, className, alt }: { jid: string; calib?: Calib; className?: string; alt: string }) {
  return (
    <div className={cn('relative aspect-[2/3] overflow-hidden rounded-md border bg-white shadow-sm', className)}>
      <img
        src={`/api/previa/${jid}.png`}
        alt={alt}
        className='absolute inset-0 size-full object-contain'
        style={calib ? { transform: `translate(${calib.deslocXmm}%, ${calib.deslocYmm / 1.5}%)` } : undefined}
        loading='lazy'
      />
    </div>
  )
}

export function DetalheEtiqueta({ p, vezes, calib, ocupado, onImprimir, onDescartar }: {
  p: Pedido | null; vezes: number; calib?: Calib; ocupado: boolean
  onImprimir: (p: Pedido) => void; onDescartar: (p: Pedido) => void
}) {
  if (!p) {
    return (
      <div className='flex h-full min-h-80 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground'>
        <Printer className='size-6' aria-hidden='true' />
        Escolha uma etiqueta na lista para ver a prévia e o que aconteceu com ela.
      </div>
    )
  }
  const reimprimir = p.estado === 'impresso' || p.estado === 'descartado'
  const eventos = [...(p.eventos ?? [{ quando: p.hora, tipo: 'chegou' as const, detalhe: p.origem }])].reverse()
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='text-xs text-muted-foreground'>{origemLegivel(p)} · {p.tipo}</p>
          <h2 className='truncate text-lg font-semibold tabular-nums'>{numeroDoEnvio(p)}</h2>
        </div>
        <SeloEstado estado={p.estado} />
      </div>

      <PreviaEtiqueta jid={p.jid} calib={calib} alt={`Prévia da etiqueta ${numeroDoEnvio(p)}`} className='mx-auto w-full max-w-[260px]' />

      {p.erro && <p className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive'>{p.erro}</p>}

      <div className='grid grid-cols-2 gap-2'>
        <Button disabled={ocupado || p.estado === 'enviando'} onClick={() => onImprimir(p)} variant={reimprimir ? 'outline' : 'default'} className={cn((p.estado === 'aguardando' || p.estado === 'erro') ? '' : 'col-span-2')}>
          {reimprimir ? <RotateCcw aria-hidden='true' /> : <Printer aria-hidden='true' />}
          {reimprimir ? 'Imprimir de novo' : p.estado === 'erro' ? 'Tentar de novo' : 'Imprimir'}
        </Button>
        {(p.estado === 'aguardando' || p.estado === 'erro') && (
          <Button variant='outline' disabled={ocupado} onClick={() => onDescartar(p)}><Trash2 aria-hidden='true' /> Tirar da fila</Button>
        )}
      </div>

      <dl className='grid grid-cols-2 gap-x-4 gap-y-2 text-sm'>
        <dt className='text-muted-foreground'>Chegou</dt><dd className='text-end tabular-nums'>{dataHora(p.hora)}</dd>
        <dt className='text-muted-foreground'>Vezes impressa</dt><dd className='text-end tabular-nums'>{vezes}</dd>
        {p.rastreio && <><dt className='text-muted-foreground'>Rastreio</dt><dd className='truncate text-end tabular-nums'>{p.rastreio}</dd></>}
      </dl>

      <section aria-label='Linha do tempo'>
        <h3 className='mb-2 text-sm font-medium'>O que aconteceu</h3>
        <ol className='relative flex flex-col gap-3 border-s ps-4'>
          {eventos.map((e, i) => {
            const ev = EVENTO[e.tipo] ?? EVENTO.chegou
            const Icone = ev.icone
            return (
              <li key={i} className='relative'>
                <span className='absolute -start-[1.4rem] top-0.5 flex size-4 items-center justify-center rounded-full bg-background'>
                  <Icone className={cn('size-4', ev.cor)} aria-hidden='true' />
                </span>
                <p className='text-sm'>{ev.rotulo}{e.detalhe && e.tipo !== 'chegou' ? <span className='text-muted-foreground'> · {e.detalhe}</span> : null}</p>
                <p className='text-xs text-muted-foreground tabular-nums'>{hora(e.quando)}{e.tipo === 'chegou' && e.detalhe ? ` · por ${e.detalhe}` : ''}</p>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
