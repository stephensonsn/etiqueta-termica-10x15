import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Bluetooth, Cable, ChevronDown, CircleCheck, CircleDashed, Network, Printer, Radio, TriangleAlert, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { escolherImpressora, temWebBluetooth, useEstadoBle } from '@/lib/ble-navegador'
import { api, type Conexao, useEstado } from '@/lib/ponte'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Pagina } from '@/components/layout/pagina'
import { type CartaoConexao, conexoes, diagnostico, TESTES } from './regras'

const ICONE: Record<CartaoConexao['chave'], React.ElementType> = { usb: Cable, ble: Bluetooth, bluetooth: Radio, rede: Network }
const NOME_TIPO: Record<string, string> = { usb: 'cabo USB', ble: 'Bluetooth', bluetooth: 'Bluetooth pareado', rede: 'rede' }

export function Impressora() {
  const { data, isLoading } = useEstado()
  const qc = useQueryClient()
  const ble = useEstadoBle()
  const [host, setHost] = useState<string | undefined>(undefined)
  const atualizar = () => qc.invalidateQueries({ queryKey: ['estado'] })

  const usar = useMutation({
    mutationFn: (conexao: Conexao) => api('/api/config', { conexao }),
    onSuccess: (_r, c) => { setHost(undefined); atualizar(); toast.success(`Agora imprimindo por ${NOME_TIPO[c.tipo] ?? c.tipo}`) },
  })
  const teste = useMutation({
    mutationFn: (tipo: string) => api('/api/teste', { tipo }),
    onSuccess: (_r, tipo) => { atualizar(); toast.success(tipo === 'regua' ? 'Régua enviada. Confira se saiu inteira.' : 'Comando enviado para a impressora') },
  })
  const acao = useMutation({
    mutationFn: ({ rota, corpo }: { rota: string; corpo: Record<string, unknown> }) => api(rota, corpo),
    onSuccess: () => { atualizar(); toast.success('Feito. Siga o que aparecer na tela do Mac.') },
  })
  const procurar = useMutation({ mutationFn: escolherImpressora, onSuccess: atualizar })

  if (isLoading || !data) {
    return <Pagina titulo='Impressora'><Skeleton className='h-40 w-full' /><Skeleton className='h-64 w-full' /></Pagina>
  }
  const cartoes = conexoes(data, host)
  const checagens = diagnostico(data)
  const pendentes = checagens.filter((c) => !c.ok && !c.opcional).length
  const emUso = cartoes.find((c) => c.emUso)

  return (
    <Pagina
      titulo='Impressora'
      descricao='Situação, conexão, diagnóstico e testes da térmica 10x15.'
      acoes={<Button variant='outline' asChild><Link to='/impressora/configurar'><Wand2 aria-hidden='true' /> Configurar passo a passo</Link></Button>}
    >
      {!data.config.configurado && (
        <Card className='border-primary/40 bg-primary/5'>
          <CardContent className='flex flex-wrap items-center gap-3'>
            <Wand2 className='size-5 text-primary' aria-hidden='true' />
            <p className='min-w-0 flex-1 text-sm'><span className='font-medium'>Primeira vez?</span> O passo a passo liga a impressora, libera as permissões e imprime um teste.</p>
            <Button asChild><Link to='/impressora/configurar'>Começar</Link></Button>
          </CardContent>
        </Card>
      )}

      {/* situação em destaque */}
      <Card className={cn('border-2', data.fila.ok ? 'border-emerald-600/30' : 'border-destructive/40')}>
        <CardContent className='flex flex-wrap items-center gap-4'>
          <span className={cn('flex size-12 items-center justify-center rounded-xl', data.fila.ok ? 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/10 text-destructive')}>
            <Printer className='size-6' aria-hidden='true' />
          </span>
          <div className='min-w-0 flex-1'>
            <p className='text-lg font-semibold'>{data.fila.ok ? 'Pronta para imprimir' : 'Precisa de atenção'}</p>
            <p className='text-sm text-muted-foreground'>{data.fila.texto} · {emUso ? `por ${emUso.titulo.toLowerCase()}` : 'nenhuma conexão em uso'}</p>
          </div>
          <Button onClick={() => teste.mutate('regua')} disabled={teste.isPending}><Printer aria-hidden='true' /> Imprimir teste</Button>
        </CardContent>
      </Card>

      {/* conexões: grade única, colunas pelo número de cartões (4 → 2×2, 3 → 3×1; nunca 2+1) */}
      <section aria-labelledby='t-conexao'>
        <h2 id='t-conexao' className='mb-3 text-base font-semibold'>Conexão</h2>
        <div className={cn('grid grid-cols-1 gap-4', cartoes.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
          {cartoes.map((c) => {
            const Icone = ICONE[c.chave]
            return (
              <Card key={c.chave} className={cn('h-full gap-3', c.emUso && 'border-primary/50 ring-1 ring-primary/30')}>
                <CardHeader className='flex flex-row items-start justify-between gap-2'>
                  <div className='flex items-center gap-2'>
                    <Icone className='size-4 text-muted-foreground' aria-hidden='true' />
                    <CardTitle className='text-sm'>{c.titulo}</CardTitle>
                  </div>
                  {c.emUso && <Badge className='bg-emerald-600 text-white'>Em uso</Badge>}
                </CardHeader>
                <CardContent className='flex flex-1 flex-col gap-3'>
                  <CardDescription>{c.detalhe}</CardDescription>
                  {c.chave === 'rede' && (
                    <Input aria-label='Endereço IP da impressora' placeholder='192.168.0.50' value={host ?? data.config.conexao.host ?? ''}
                      onChange={(e) => setHost(e.target.value)} />
                  )}
                  {c.chave === 'ble' && ble.texto && <p className='text-xs text-muted-foreground'>{ble.texto}</p>}
                  <div className='mt-auto flex flex-wrap gap-2'>
                    {c.usar && <Button size='sm' disabled={usar.isPending} onClick={() => usar.mutate(c.usar!)}>{c.chave === 'rede' ? 'Usar este endereço' : 'Usar'}</Button>}
                    {c.chave === 'ble' && (
                      <Button size='sm' variant={data.config.conexao.bleNome ? 'outline' : 'default'} disabled={!temWebBluetooth() || procurar.isPending}
                        title={temWebBluetooth() ? undefined : 'Abra no Google Chrome'} onClick={() => procurar.mutate()}>
                        {data.config.conexao.bleNome ? 'Trocar de impressora' : 'Escolher impressora'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      {/* diagnóstico: uma linha por checagem, ação ao lado do que está pendente */}
      <section aria-labelledby='t-diag'>
        <div className='mb-3 flex items-baseline justify-between gap-2'>
          <h2 id='t-diag' className='text-base font-semibold'>Diagnóstico</h2>
          <span className={cn('text-sm', pendentes ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
            {pendentes ? `${pendentes} pendente(s)` : 'Tudo pronto'}
          </span>
        </div>
        <Card className='py-0'>
          <ul className='divide-y'>
            {checagens.map((c) => (
              <li key={c.chave} className='flex flex-wrap items-center gap-3 px-5 py-3.5'>
                {c.ok ? <CircleCheck className='size-5 shrink-0 text-emerald-600' aria-hidden='true' />
                  : c.opcional ? <CircleDashed className='size-5 shrink-0 text-muted-foreground' aria-hidden='true' />
                    : <TriangleAlert className='size-5 shrink-0 text-amber-600' aria-hidden='true' />}
                <div className='min-w-0 flex-1'>
                  <p className='text-sm font-medium'>{c.titulo}{c.opcional && <span className='ms-2 text-xs font-normal text-muted-foreground'>opcional</span>}</p>
                  <p className='text-xs text-muted-foreground'>{c.detalhe}</p>
                </div>
                <span className={cn('rounded-md border px-2 py-0.5 text-xs font-medium',
                  c.ok ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300' : c.opcional ? 'bg-muted text-muted-foreground' : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300')}>
                  {c.ok ? 'Pronto' : c.opcional ? 'Opcional' : 'Pendente'}
                </span>
                {!c.ok && c.acao && <Button size='sm' variant='outline' disabled={acao.isPending} onClick={() => acao.mutate(c.acao!)}>{c.acao.rotulo}</Button>}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* testes e manutenção */}
      <section aria-labelledby='t-testes'>
        <h2 id='t-testes' className='mb-3 text-base font-semibold'>Testes e manutenção</h2>
        <Card className='py-0'>
          <ul className='divide-y'>
            {TESTES.map((t) => (
              <li key={t.tipo} className='flex flex-wrap items-center gap-3 px-5 py-3.5'>
                <div className='min-w-0 flex-1'>
                  <p className='text-sm font-medium'>{t.rotulo}</p>
                  <p className='text-xs text-muted-foreground'>{t.detalhe}</p>
                </div>
                <Button size='sm' variant='outline' disabled={teste.isPending} onClick={() => teste.mutate(t.tipo)}>Enviar</Button>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <Collapsible className='rounded-xl border'>
        <CollapsibleTrigger className='group flex w-full items-center justify-between px-4 py-3 text-sm font-medium'>
          Registro técnico da ponte
          <ChevronDown className='size-4 transition-transform group-data-[state=open]:rotate-180' aria-hidden='true' />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className='max-h-72 overflow-auto border-t bg-muted/30 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap'>{data.log.join('\n') || 'Sem registros recentes.'}</pre>
        </CollapsibleContent>
      </Collapsible>
    </Pagina>
  )
}
