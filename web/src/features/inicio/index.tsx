import { useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CircleAlert, CircleCheck, ClipboardCheck, Clock3, Printer, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { ehHoje, hora, numero, plural } from '@/lib/formato'
import { api, usePendencias, useEstado, useSeparacao } from '@/lib/ponte'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Pagina } from '@/components/layout/pagina'
import { naFila, origemLegivel, SeloEstado } from '@/features/fila/estado'
import { gruposDoDia } from '@/features/separacao/prazo'

const saudacao = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

export function Inicio() {
  const estado = useEstado()
  const pendencias = usePendencias()
  const separacao = useSeparacao()
  const pedidos = estado.data?.pedidos ?? []
  const fila = pedidos.filter(naFila)
  const erros = pedidos.filter((p) => p.estado === 'erro')
  const impressasHoje = pedidos.filter((p) => p.estado === 'impresso' && ehHoje(p.hora))
  const itensSep = separacao.data?.items ?? []
  const doDia = gruposDoDia(itensSep)
  const totalPacotes = new Set(itensSep.map((i) => i.group)).size
  const teste = useMutation({
    mutationFn: () => api('/api/teste', { tipo: 'autoteste' }),
    onSuccess: () => toast.success('Autoteste enviado. Confira a etiqueta que saiu da impressora.'),
  })
  // a situação da impressora já está no cartão ao lado: não repete nas pendências
  const lista = (pendencias.data?.pendencias ?? []).filter((p) => p.tipo !== 'impressora')

  return (
    <Pagina titulo={saudacao()} descricao='O que precisa de atenção hoje na impressão e na separação.'>
      {/* 4 números, grade única: 4×1 na tela larga, 2×2 na média, 1 por linha no celular */}
      <section className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4' aria-label='Resumo do dia'>
        <Indicador titulo='Na fila agora' valor={fila.length} carregando={estado.isLoading}
          detalhe={fila.length ? 'esperando para imprimir' : 'nada esperando'} icone={Clock3} tom={fila.length ? 'ambar' : 'neutro'} para='/fila' />
        <Indicador titulo='Com falha' valor={erros.length} carregando={estado.isLoading}
          detalhe={erros.length ? 'precisam de nova tentativa' : 'nenhuma falha'} icone={CircleAlert} tom={erros.length ? 'vermelho' : 'neutro'} para='/fila' />
        <Indicador titulo='Impressas hoje' valor={impressasHoje.length} carregando={estado.isLoading}
          detalhe={impressasHoje[0] ? `última às ${hora(impressasHoje[0].hora)}` : 'nenhuma ainda'} icone={CircleCheck} tom='verde' para='/fila' busca={{ aba: 'impressas' }} />
        <Indicador titulo='Pacotes para despachar' valor={doDia.size} carregando={separacao.isLoading}
          detalhe={separacao.isError ? 'separação fora do ar' : totalPacotes ? `hoje ou atrasados · de ${numero(totalPacotes)} importados` : 'importe as planilhas do dia'}
          icone={ClipboardCheck} tom={doDia.size ? 'ambar' : 'neutro'} para='/separacao' />
      </section>

      <section className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <Card className='h-full'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'><Printer className='size-4' aria-hidden='true' /> Impressora</CardTitle>
            <CardDescription>{estado.data ? estado.data.fila.texto : 'Consultando…'}</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            <div className={cn('flex items-center gap-2 text-sm font-medium', estado.data?.fila.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')}>
              {estado.data?.fila.ok ? <CircleCheck className='size-4' aria-hidden='true' /> : <TriangleAlert className='size-4' aria-hidden='true' />}
              {estado.isError ? 'A ponte não respondeu' : estado.data?.fila.ok ? 'Pronta para imprimir' : 'Precisa de atenção'}
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button variant='outline' size='sm' onClick={() => teste.mutate()} disabled={teste.isPending}>Imprimir autoteste</Button>
              <Button variant='ghost' size='sm' asChild><Link to='/impressora'>Conexão e calibração <ArrowRight aria-hidden='true' /></Link></Button>
            </div>
          </CardContent>
        </Card>

        <Card className='h-full'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'><TriangleAlert className='size-4' aria-hidden='true' /> Pendências</CardTitle>
            <CardDescription>{lista.length ? plural(lista.length, 'item para resolver', 'itens para resolver') : 'Avisos das automações e da extensão do Chrome'}</CardDescription>
          </CardHeader>
          <CardContent>
            {pendencias.isLoading ? <Skeleton className='h-16 w-full' /> : lista.length ? (
              <ul className='flex flex-col gap-2'>
                {lista.slice(0, 5).map((p, i) => (
                  <li key={i} className='rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm'>{p.texto}</li>
                ))}
              </ul>
            ) : (
              <p className='flex items-center gap-2 text-sm text-muted-foreground'><CircleCheck className='size-4 text-emerald-600' aria-hidden='true' /> Tudo em dia.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between gap-2'>
          <div>
            <CardTitle>Últimas etiquetas</CardTitle>
            <CardDescription>As 6 mais recentes que chegaram na ponte</CardDescription>
          </div>
          <Button variant='ghost' size='sm' asChild><Link to='/fila'>Ver a fila <ArrowRight aria-hidden='true' /></Link></Button>
        </CardHeader>
        <CardContent>
          {estado.isLoading ? <Skeleton className='h-24 w-full' /> : pedidos.length ? (
            <ul className='divide-y'>
              {pedidos.slice(0, 6).map((p) => (
                <li key={p.jid} className='flex items-center gap-3 py-2.5 text-sm'>
                  <span className='w-12 shrink-0 tabular-nums text-muted-foreground'>{hora(p.hora)}</span>
                  <span className='min-w-0 flex-1 truncate'><span className='font-medium'>{origemLegivel(p)}</span> · {p.id || p.tipo}</span>
                  <SeloEstado estado={p.estado} />
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-sm text-muted-foreground'>Nenhuma etiqueta desde que a ponte abriu. Baixe uma etiqueta no marketplace e ela aparece aqui.</p>
          )}
        </CardContent>
      </Card>
    </Pagina>
  )
}

type Tom = 'neutro' | 'verde' | 'ambar' | 'vermelho'
const TONS: Record<Tom, string> = {
  neutro: 'text-muted-foreground bg-muted',
  verde: 'text-emerald-700 bg-emerald-600/10 dark:text-emerald-400',
  ambar: 'text-amber-700 bg-amber-500/10 dark:text-amber-300',
  vermelho: 'text-destructive bg-destructive/10',
}

function Indicador({ titulo, valor, detalhe, icone: Icone, tom, para, busca, carregando }: {
  titulo: string; valor: number; detalhe: string; icone: React.ElementType; tom: Tom
  para: '/fila' | '/separacao'; busca?: { aba: 'impressas' }; carregando?: boolean
}) {
  return (
    <Link to={para} search={busca} className='group rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'>
      <Card className='h-full gap-3 py-5 transition-colors group-hover:border-foreground/20'>
        <CardHeader className='flex flex-row items-center justify-between gap-2 px-5'>
          <CardTitle className='text-sm font-medium text-muted-foreground'>{titulo}</CardTitle>
          <span className={cn('flex size-8 items-center justify-center rounded-lg', TONS[tom])}><Icone className='size-4' aria-hidden='true' /></span>
        </CardHeader>
        <CardContent className='px-5'>
          {carregando ? <Skeleton className='h-9 w-16' /> : <p className='text-3xl font-semibold tabular-nums whitespace-nowrap'>{numero(valor)}</p>}
          <p className='mt-1 truncate text-xs text-muted-foreground'>{detalhe}</p>
        </CardContent>
      </Card>
    </Link>
  )
}
