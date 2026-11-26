import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { ChevronDown, FileUp, FolderDown, Inbox, Printer, Search, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { hora, plural } from '@/lib/formato'
import { api, enviarArquivo, type Pedido, salvarConfig, useEstado } from '@/lib/ponte'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Pagina } from '@/components/layout/pagina'
import { type Aba, agruparPorDia, FILTRO, ordemDeImpressao, resumoLote, vezesImpresso } from './agrupar'
import { DetalheEtiqueta, numeroDoEnvio, PreviaEtiqueta } from './detalhe'
import { origemLegivel, SeloEstado } from './estado'

const rota = getRouteApi('/_authenticated/fila')
const ABAS: { valor: Aba; rotulo: string }[] = [
  { valor: 'fila', rotulo: 'Para imprimir' },
  { valor: 'falhas', rotulo: 'Com falha' },
  { valor: 'impressas', rotulo: 'Impressas' },
  { valor: 'descartadas', rotulo: 'Descartadas' },
]

export function Fila() {
  const { aba = 'fila' } = rota.useSearch()
  const navegar = rota.useNavigate()
  const { data, isLoading } = useEstado()
  const qc = useQueryClient()
  const celular = useIsMobile()
  const [busca, setBusca] = useState('')
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [foco, setFoco] = useState<string | null>(null)
  const [progresso, setProgresso] = useState<{ i: number; n: number } | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const arquivo = useRef<HTMLInputElement>(null)

  const pedidos = useMemo(() => data?.pedidos ?? [], [data])
  const contagem = useMemo(() => Object.fromEntries(ABAS.map((a) => [a.valor, pedidos.filter(FILTRO[a.valor]).length])) as Record<Aba, number>, [pedidos])
  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return pedidos.filter(FILTRO[aba]).filter((p) => !q || `${p.id} ${p.rastreio ?? ''} ${p.origem} ${p.tipo} ${origemLegivel(p)}`.toLowerCase().includes(q))
  }, [pedidos, aba, busca])
  const grupos = useMemo(() => agruparPorDia(linhas), [linhas])
  const focado = pedidos.find((p) => p.jid === foco) ?? (celular ? null : linhas[0] ?? null)
  const selecionadas = linhas.filter((p) => marcadas.has(p.jid))
  const paraImprimir = pedidos.filter((p) => p.estado === 'aguardando' || p.estado === 'erro')

  // Imprime uma de cada vez (a ponte usa a impressora em fila única), mostrando o andamento.
  const lote = useMutation({
    mutationFn: async ({ tipo, itens }: { tipo: 'imprimir' | 'descartar'; itens: Pedido[] }) => {
      const ordem = tipo === 'imprimir' ? ordemDeImpressao(itens) : itens
      let ok = 0, falhas = 0, primeiroErro = ''
      for (let i = 0; i < ordem.length; i++) {
        if (tipo === 'imprimir' && ordem.length > 1) setProgresso({ i: i + 1, n: ordem.length })
        try { await api(`/api/pedido/${ordem[i].jid}/${tipo}`, {}); ok++ } catch (e) { falhas++; primeiroErro ||= (e as Error).message }
        qc.invalidateQueries({ queryKey: ['estado'] })
      }
      return { tipo, ok, falhas, primeiroErro }
    },
    onSettled: () => setProgresso(null),
    onSuccess: ({ tipo, ok, falhas, primeiroErro }) => {
      setMarcadas(new Set())
      if (tipo === 'descartar') return toast.success(`${plural(ok, 'etiqueta tirada', 'etiquetas tiradas')} da fila`)
      const texto = resumoLote(ok, falhas)
      if (falhas) toast.error(`${texto}. ${primeiroErro}`)
      else toast.success(texto)
    },
  })
  const envio = useMutation({
    mutationFn: async (arquivos: File[]) => { for (const f of arquivos) await enviarArquivo(f); return arquivos.length },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['estado'] })
      navegar({ search: { aba: 'fila' } })
      toast.success(`${plural(n, 'arquivo lido', 'arquivos lidos')}. A etiqueta está na fila.`)
    },
  })
  const modo = useMutation({
    mutationFn: (imprimir: 'direto' | 'conferir') => salvarConfig({ imprimir }),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['estado'] }); toast.success(v === 'direto' ? 'Etiquetas novas imprimem sozinhas' : 'Etiquetas novas esperam você conferir') },
  })
  const ocupado = lote.isPending || envio.isPending
  const mutarLote = lote.mutate
  const mutarEnvio = envio.mutate
  const imprimir = useCallback((itens: Pedido[]) => mutarLote({ tipo: 'imprimir', itens }), [mutarLote])
  const descartar = (itens: Pedido[]) => mutarLote({ tipo: 'descartar', itens: itens.filter((p) => p.estado === 'aguardando' || p.estado === 'erro') })

  // Arrastar um arquivo em qualquer lugar da tela.
  useEffect(() => {
    const sobre = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setArrastando(true) } }
    const fora = (e: DragEvent) => { if (!e.relatedTarget) setArrastando(false) }
    const soltar = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault(); setArrastando(false)
      mutarEnvio([...e.dataTransfer.files])
    }
    window.addEventListener('dragover', sobre); window.addEventListener('dragleave', fora); window.addEventListener('drop', soltar)
    return () => { window.removeEventListener('dragover', sobre); window.removeEventListener('dragleave', fora); window.removeEventListener('drop', soltar) }
  }, [mutarEnvio])

  // Setas mudam a etiqueta em foco; Enter imprime (fora de campos de texto).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, button, [role="dialog"], [role="tab"]') || !linhas.length) return
      const i = Math.max(0, linhas.findIndex((p) => p.jid === focado?.jid))
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const prox = linhas[Math.min(linhas.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
        setFoco(prox.jid)
        document.getElementById(`etq-${prox.jid}`)?.scrollIntoView({ block: 'nearest' })
      }
      if (e.key === 'Enter' && focado && !ocupado && focado.estado !== 'enviando') { e.preventDefault(); imprimir([focado]) }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [linhas, focado, ocupado, imprimir])

  const todasMarcadas = linhas.length > 0 && linhas.every((p) => marcadas.has(p.jid))
  const algumaMarcada = selecionadas.length > 0

  return (
    <Pagina
      titulo='Fila de impressão'
      descricao='Etiquetas do Mercado Livre, Shopee, TikTok ou de arquivo, guardadas pelo prazo do histórico para reimprimir.'
      acoes={
        <>
          <Tabs value={data?.config.imprimir ?? 'direto'} onValueChange={(v) => modo.mutate(v as 'direto' | 'conferir')}>
            <TabsList aria-label='Quando imprimir'>
              <TabsTrigger value='direto'>Imprimir direto</TabsTrigger>
              <TabsTrigger value='conferir'>Conferir antes</TabsTrigger>
            </TabsList>
          </Tabs>
          <input ref={arquivo} type='file' accept='.zip,.txt,.zpl' multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) envio.mutate(f) }} />
          <Button variant='outline' onClick={() => arquivo.current?.click()} disabled={ocupado}><FileUp aria-hidden='true' /> Enviar arquivo</Button>
          <Button disabled={ocupado || (!algumaMarcada && !paraImprimir.length)} onClick={() => imprimir(algumaMarcada ? selecionadas : paraImprimir)}>
            <Printer aria-hidden='true' />
            {progresso ? `Imprimindo ${progresso.i} de ${progresso.n}…` : algumaMarcada ? `Imprimir selecionadas (${selecionadas.length})` : `Imprimir a fila (${paraImprimir.length})`}
          </Button>
        </>
      }
    >
      {/* situação: impressora e entrada automática, lado a lado e com a mesma altura */}
      <section className='grid grid-cols-1 gap-3 md:grid-cols-2' aria-label='Situação'>
        <Situacao ok={!!data?.fila.ok} titulo={data ? (data.fila.ok ? 'Impressora pronta' : 'Impressora com problema') : 'Consultando a impressora…'} texto={data?.fila.texto} icone={Printer} />
        <Situacao ok={!!data?.vigia?.ativo} titulo={data?.vigia?.ativo ? 'Pegando as etiquetas baixadas' : 'Entrada automática parada'}
          texto={data?.vigia?.ativo ? 'O que cair em Downloads entra sozinho na fila' : data?.vigia?.texto} icone={FolderDown} alerta />
      </section>

      <div className='flex flex-wrap items-center justify-between gap-3'>
        <Tabs value={aba} onValueChange={(v) => { setMarcadas(new Set()); setFoco(null); navegar({ search: { aba: v as Aba } }) }} className='max-w-full overflow-x-auto'>
          <TabsList>
            {ABAS.map((a) => (
              <TabsTrigger key={a.valor} value={a.valor}>
                {a.rotulo}
                <span className={cn('ms-1.5 rounded-full px-1.5 text-xs tabular-nums',
                  a.valor === 'falhas' && contagem.falhas ? 'bg-destructive text-white' : a.valor === 'fila' && contagem.fila ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                  {contagem[a.valor]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className='relative w-full sm:w-72'>
          <Search className='absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden='true' />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder='Buscar envio, rastreio ou origem' className='ps-8' aria-label='Buscar na fila' />
        </div>
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]'>
        <section className='min-w-0 overflow-hidden rounded-xl border' aria-label='Etiquetas'>
          <div className='flex min-h-12 items-center gap-3 border-b px-4 py-2 text-sm'>
            <Checkbox checked={todasMarcadas || (algumaMarcada && 'indeterminate')} disabled={!linhas.length}
              onCheckedChange={(v) => setMarcadas(v ? new Set(linhas.map((p) => p.jid)) : new Set())} aria-label='Selecionar todas' />
            <span className='text-muted-foreground'>{algumaMarcada ? `${selecionadas.length} selecionada(s)` : plural(linhas.length, 'etiqueta', 'etiquetas')}</span>
            {algumaMarcada && (aba === 'fila' || aba === 'falhas') && (
              <Button size='sm' variant='ghost' className='ms-auto' disabled={ocupado} onClick={() => descartar(selecionadas)}><Trash2 aria-hidden='true' /> Tirar da fila</Button>
            )}
          </div>
          {isLoading ? (
            <div className='flex flex-col gap-2 p-4'>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className='h-14 w-full' />)}</div>
          ) : grupos.length ? grupos.map((g) => (
            <div key={g.dia}>
              <h3 className='border-b bg-muted/50 px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
                {g.rotulo} <span className='font-normal normal-case'>· {plural(g.itens.length, 'etiqueta', 'etiquetas')}</span>
              </h3>
              <ul>
                {g.itens.map((p) => {
                  const vezes = vezesImpresso(p, pedidos)
                  const ativo = focado?.jid === p.jid
                  return (
                    <li key={p.jid} id={`etq-${p.jid}`}
                      className={cn('flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0 hover:bg-muted/40',
                        p.estado === 'erro' && 'bg-destructive/5', ativo && 'bg-primary/5 shadow-[inset_3px_0_0_var(--primary)]')}>
                      <Checkbox checked={marcadas.has(p.jid)} aria-label={`Selecionar ${numeroDoEnvio(p)}`}
                        onCheckedChange={(v) => setMarcadas((s) => { const n = new Set(s); if (v) n.add(p.jid); else n.delete(p.jid); return n })} />
                      <button type='button' className='flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-start focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                        onClick={() => setFoco(p.jid)} aria-current={ativo || undefined}>
                        <PreviaEtiqueta jid={p.jid} alt='' className='w-9 shrink-0' />
                        <span className='min-w-0 flex-1'>
                          <span className='flex items-center gap-2'>
                            <span className='truncate font-medium tabular-nums'>{numeroDoEnvio(p)}</span>
                            {vezes > 1 && <Badge variant='secondary' className='px-1.5 tabular-nums' title={`Impressa ${vezes} vezes`}>{vezes}x</Badge>}
                          </span>
                          <span className='block truncate text-xs text-muted-foreground'>{hora(p.hora)} · {origemLegivel(p)} · {p.tipo}</span>
                          {p.erro && <span className='block truncate text-xs text-destructive'>{p.erro}</span>}
                        </span>
                        <SeloEstado estado={p.estado} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )) : (
            <Vazio aba={aba} buscando={!!busca} onArquivo={() => arquivo.current?.click()} modoConferir={data?.config.imprimir === 'conferir'} />
          )}
        </section>

        {!celular && (
          <aside className='rounded-xl border p-4 lg:sticky lg:top-20 lg:self-start' aria-label='Etiqueta escolhida'>
            <DetalheEtiqueta p={focado} vezes={focado ? vezesImpresso(focado, pedidos) : 0} calib={data?.config.calib} ocupado={ocupado}
              onImprimir={(p) => imprimir([p])} onDescartar={(p) => descartar([p])} />
          </aside>
        )}
      </div>

      <Collapsible className='rounded-xl border'>
        <CollapsibleTrigger className='group flex w-full items-center justify-between px-4 py-3 text-sm font-medium'>
          Registro técnico da ponte
          <ChevronDown className='size-4 transition-transform group-data-[state=open]:rotate-180' aria-hidden='true' />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className='max-h-72 overflow-auto border-t bg-muted/30 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap'>{(data?.log ?? []).join('\n') || 'Sem registros recentes.'}</pre>
        </CollapsibleContent>
      </Collapsible>

      {celular && (
        <Sheet open={!!foco} onOpenChange={(v) => !v && setFoco(null)}>
          <SheetContent side='bottom' className='max-h-[92svh] overflow-y-auto'>
            <SheetHeader className='sr-only'><SheetTitle>Etiqueta</SheetTitle><SheetDescription>Prévia e histórico da etiqueta</SheetDescription></SheetHeader>
            <div className='p-4'>
              <DetalheEtiqueta p={focado} vezes={focado ? vezesImpresso(focado, pedidos) : 0} calib={data?.config.calib} ocupado={ocupado}
                onImprimir={(p) => imprimir([p])} onDescartar={(p) => descartar([p])} />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {arrastando && (
        <div className='pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm'>
          <div className='flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-background px-10 py-8 text-center'>
            <Upload className='size-8 text-primary' aria-hidden='true' />
            <p className='font-medium'>Solte o arquivo de etiqueta</p>
            <p className='text-sm text-muted-foreground'>.zip, .txt ou .zpl do Mercado Livre, Shopee ou TikTok</p>
          </div>
        </div>
      )}
    </Pagina>
  )
}

function Situacao({ ok, titulo, texto, icone: Icone, alerta }: { ok: boolean; titulo: string; texto?: string; icone: React.ElementType; alerta?: boolean }) {
  const tom = ok ? 'border-emerald-600/25 bg-emerald-600/5 text-emerald-700 dark:text-emerald-400'
    : alerta ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300' : 'border-destructive/30 bg-destructive/5 text-destructive'
  return (
    <div className={cn('flex h-full items-start gap-3 rounded-lg border px-4 py-3', tom)} role='status'>
      <Icone className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
      <div className='min-w-0'>
        <p className='text-sm font-medium'>{titulo}</p>
        {texto && <p className='truncate text-xs text-muted-foreground'>{texto}</p>}
      </div>
    </div>
  )
}

function Vazio({ aba, buscando, onArquivo, modoConferir }: { aba: Aba; buscando: boolean; onArquivo: () => void; modoConferir: boolean }) {
  if (buscando) return <p className='p-10 text-center text-sm text-muted-foreground'>Nada encontrado com essa busca.</p>
  const textos: Record<Aba, [string, string]> = {
    fila: ['Nenhuma etiqueta esperando', modoConferir ? 'Baixe a etiqueta no marketplace: ela entra aqui e espera você conferir.' : 'Baixe a etiqueta no marketplace: ela entra aqui e imprime sozinha.'],
    falhas: ['Nenhuma falha', 'Etiqueta que não imprimir aparece aqui com o motivo.'],
    impressas: ['Nenhuma impressa ainda', 'As impressas ficam aqui pelo prazo do histórico, em Configurações.'],
    descartadas: ['Nenhuma descartada', 'Etiquetas tiradas da fila aparecem aqui.'],
  }
  return (
    <div className='mx-auto flex max-w-sm flex-col items-center gap-2 p-10 text-center'>
      <Inbox className='size-8 text-muted-foreground' aria-hidden='true' />
      <p className='font-medium'>{textos[aba][0]}</p>
      <p className='text-sm text-muted-foreground'>{textos[aba][1]}</p>
      {aba === 'fila' && <Button variant='outline' size='sm' onClick={onArquivo}><FileUp aria-hidden='true' /> Enviar arquivo</Button>}
    </div>
  )
}
