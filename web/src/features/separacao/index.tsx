import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileDown, FileSpreadsheet, LoaderCircle, RotateCcw, ScanLine, Search, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { numero, plural } from '@/lib/formato'
import { api, ErroPonte, type EstadoSeparacao, type ItemSeparacao, useSeparacao } from '@/lib/ponte'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Pagina } from '@/components/layout/pagina'
import { gruposDoDia, prazo } from './prazo'

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function SeloPrazo({ item }: { item: ItemSeparacao }) {
  const p = prazo(item)
  const base = 'inline-flex rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap'
  if (p === 'hoje') return <span className={cn(base, 'border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300')}>Hoje</span>
  if (p === 'atrasado') return <span className={cn(base, 'border-destructive/30 bg-destructive/10 text-destructive')}>Atrasado</span>
  if (p === 'sem') return <span className={cn(base, 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300')}>Confira o prazo</span>
  const [a, m, d] = item.ship_date!.split('-')
  return <span className={cn(base, 'bg-muted text-muted-foreground')}>{SEMANA[new Date(+a, +m - 1, +d).getDay()]} {d}/{m}</span>
}

const lerBase64 = (f: File) => new Promise<string>((ok, erro) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result).split(',')[1])
  r.onerror = () => erro(new Error(`Não abriu ${f.name}`))
  r.readAsDataURL(f)
})

export function Separacao() {
  const qc = useQueryClient()
  const { data, isLoading, isError, error } = useSeparacao()
  const itens = useMemo(() => data?.items ?? [], [data])
  const [selecao, setSelecao] = useState<Set<string>>(new Set())
  const [busca, setBusca] = useState('')
  const [canal, setCanal] = useState('todas')
  const [despacho, setDespacho] = useState<'dia' | 'outros' | 'todos'>('dia')
  const [codigo, setCodigo] = useState('')
  const [confirmarParcial, setConfirmarParcial] = useState(false)
  const [confirmarNovo, setConfirmarNovo] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)
  const iniciado = useRef(false)

  // Ao abrir: marca só os pacotes do dia (hoje e atrasados).
  useEffect(() => {
    if (!data || iniciado.current) return
    iniciado.current = true
    const dia = gruposDoDia(data.items)
    setSelecao(new Set(data.items.filter((i) => dia.has(i.group)).map((i) => i.id)))
  }, [data])

  const doDia = useMemo(() => gruposDoDia(itens), [itens])
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return itens.filter((i) =>
      (canal === 'todas' || i.channel === canal) &&
      (despacho === 'todos' || (despacho === 'dia') === doDia.has(i.group)) &&
      (!q || [i.title, i.sku, i.variation, i.buyer, i.code, i.order, i.package, i.tracking].join(' ').toLowerCase().includes(q)))
  }, [itens, busca, canal, despacho, doDia])

  const escolhidos = itens.filter((i) => selecao.has(i.id))
  const parciais = useMemo(() => {
    const todos = new Map<string, number>(), marc = new Map<string, number>()
    for (const i of itens) { todos.set(i.group, (todos.get(i.group) ?? 0) + 1); if (selecao.has(i.id)) marc.set(i.group, (marc.get(i.group) ?? 0) + 1) }
    return [...marc].filter(([g, n]) => n < (todos.get(g) ?? 0)).length
  }, [itens, selecao])

  const importar = useMutation({
    mutationFn: async (arquivos: File[]) => {
      if (arquivos.some((f) => !f.name.toLowerCase().endsWith('.xlsx'))) throw new ErroPonte('Use só planilhas .xlsx exportadas do Mercado Livre ou do TikTok.')
      const files = await Promise.all(arquivos.map(async (f) => ({ name: f.name, data: await lerBase64(f) })))
      return api<EstadoSeparacao & { added: number; duplicates: number }>('/api/separacao/import', { files })
    },
    onSuccess: (j) => {
      const antes = new Set(itens.map((i) => i.id))
      const dia = gruposDoDia(j.items)
      setSelecao((s) => { const n = new Set(s); for (const i of j.items) if (!antes.has(i.id) && dia.has(i.group)) n.add(i.id); return n })
      qc.setQueryData(['separacao'], j)
      setDespacho('dia')
      toast.success(`${plural(j.added, 'item novo', 'itens novos')}. ${plural(dia.size, 'pacote é', 'pacotes são')} para despachar hoje e já ${dia.size === 1 ? 'está marcado' : 'estão marcados'}.`)
    },
  })
  const localizar = useMutation({
    mutationFn: () => api<{ ids: string[] }>('/api/separacao/match', { code: codigo }),
    onSuccess: ({ ids }) => { setSelecao((s) => new Set([...s, ...ids])); setCodigo(''); toast.success(`Pacote localizado: ${plural(ids.length, 'item marcado', 'itens marcados')}.`) },
  })
  const novoLote = useMutation({
    mutationFn: () => api('/api/separacao/reset', {}),
    onSuccess: () => { setSelecao(new Set()); qc.setQueryData(['separacao'], { items: [], files: [], warnings: [] }); toast.success('Novo lote iniciado. Envie as planilhas do dia.') },
  })
  const pdf = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/separacao/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ponte': '1' }, body: JSON.stringify({ ids: [...selecao], allow_partial: parciais > 0 }) })
      if (!r.ok) throw new ErroPonte((await r.json().catch(() => ({}))).erro || 'Não gerou o PDF.')
      const url = URL.createObjectURL(await r.blob())
      const a = Object.assign(document.createElement('a'), { href: url, download: r.headers.get('X-Filename') || 'Checklist-separacao.pdf' })
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000)
    },
    onSuccess: () => toast.success('PDF baixado. Imprima em A4, escala 100%.'),
  })

  const alternar = (id: string, v: boolean) => setSelecao((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n })
  const pacote = (g: string) => setSelecao((s) => new Set([...s, ...itens.filter((i) => i.group === g).map((i) => i.id)]))
  const todosVisiveis = visiveis.length > 0 && visiveis.every((i) => selecao.has(i.id))

  return (
    <Pagina
      titulo='Separação do dia'
      descricao='Planilhas do Mercado Livre e do TikTok viram o checklist A4 com Separado e embalado e Despachado.'
      acoes={
        <>
          <Button variant='outline' onClick={() => setConfirmarNovo(true)} disabled={!itens.length || novoLote.isPending}><RotateCcw aria-hidden='true' /> Novo lote</Button>
          <Button onClick={() => (parciais ? setConfirmarParcial(true) : pdf.mutate())} disabled={!escolhidos.length || pdf.isPending}>
            {pdf.isPending ? <LoaderCircle className='animate-spin' aria-hidden='true' /> : <FileDown aria-hidden='true' />} Baixar checklist A4
          </Button>
        </>
      }
    >
      {isError && (
        <Alert variant='destructive'>
          <TriangleAlert aria-hidden='true' />
          <AlertTitle>A separação não respondeu</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}

      {/* 4 números do lote, mesma grade das outras telas */}
      <section className='grid grid-cols-2 gap-4 xl:grid-cols-4' aria-label='Resumo da seleção'>
        <Numero titulo='Pacotes do dia' valor={doDia.size} detalhe='hoje ou atrasados' />
        <Numero titulo='Pacotes marcados' valor={new Set(escolhidos.map((i) => i.group)).size} detalhe={parciais ? `${parciais} incompleto(s)` : 'vão para o PDF'} alerta={parciais > 0} />
        <Numero titulo='Itens marcados' valor={escolhidos.length} detalhe='linhas do checklist' />
        <Numero titulo='Unidades' valor={escolhidos.reduce((s, i) => s + i.quantity, 0)} detalhe='kit conta como 1' />
      </section>

      <section className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <Card
          className={cn('h-full border-dashed transition-colors', arrastando && 'border-primary bg-primary/5')}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); const f = [...e.dataTransfer.files]; if (f.length) importar.mutate(f) }}
        >
          <CardContent className='flex h-full flex-col items-start gap-3'>
            <div className='flex items-center gap-2 font-medium'><FileSpreadsheet className='size-4' aria-hidden='true' /> 1. Envie as planilhas do dia</div>
            <p className='text-sm text-muted-foreground'>Arraste aqui ou escolha os .xlsx de vendas do Mercado Livre e de pedidos do TikTok. A leitura é feita neste computador.</p>
            <input ref={entrada} type='file' accept='.xlsx' multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) importar.mutate(f) }} />
            <Button variant='outline' onClick={() => entrada.current?.click()} disabled={importar.isPending}>
              {importar.isPending ? <><LoaderCircle className='animate-spin' aria-hidden='true' /> Lendo as planilhas…</> : 'Escolher planilhas'}
            </Button>
            {data?.files.length ? (
              <ul className='w-full min-w-0 text-xs text-muted-foreground'>
                <li className='font-medium'>{plural(data.files.length, 'planilha importada', 'planilhas importadas')}</li>
                {data.files.map((f) => <li key={f} className='truncate' title={f}>{f}</li>)}
              </ul>
            ) : <p className='text-xs text-muted-foreground'>Nenhuma planilha importada.</p>}
          </CardContent>
        </Card>
        <Card className='h-full'>
          <CardContent className='flex h-full flex-col gap-3'>
            <div className='flex items-center gap-2 font-medium'><ScanLine className='size-4' aria-hidden='true' /> 2. Bipe a etiqueta <span className='text-sm font-normal text-muted-foreground'>(opcional)</span></div>
            <p className='text-sm text-muted-foreground'>Envio, rastreio ou número do pedido: o pacote inteiro entra na seleção.</p>
            <form className='flex gap-2' onSubmit={(e) => { e.preventDefault(); if (codigo.trim()) localizar.mutate() }}>
              <Label htmlFor='codigo' className='sr-only'>Código da etiqueta</Label>
              <Input id='codigo' className='min-w-0 flex-1' value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder='Envio, rastreio ou pedido' autoComplete='off' />
              <Button type='submit' variant='outline' disabled={!codigo.trim() || localizar.isPending}>Marcar pacote</Button>
            </form>
          </CardContent>
        </Card>
      </section>

      {!!data?.warnings.length && (
        <Alert>
          <TriangleAlert aria-hidden='true' />
          <AlertTitle>Confira antes de separar</AlertTitle>
          <AlertDescription><ul className='list-disc ps-4'>{data.warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}</ul></AlertDescription>
        </Alert>
      )}

      <div className='flex flex-wrap items-end gap-3'>
        <div className='relative w-full sm:w-72'>
          <Search className='absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden='true' />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder='Produto, SKU, cliente ou código' className='ps-8' aria-label='Buscar nos pedidos' />
        </div>
        <Select value={canal} onValueChange={setCanal}>
          <SelectTrigger className='w-52' aria-label='Plataforma'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='todas'>Todas as plataformas</SelectItem>
            <SelectItem value='Mercado Livre'>Mercado Livre</SelectItem>
            <SelectItem value='TikTok Shop'>TikTok Shop</SelectItem>
          </SelectContent>
        </Select>
        <Select value={despacho} onValueChange={(v) => setDespacho(v as typeof despacho)}>
          <SelectTrigger className='w-64' aria-label='Despacho'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='dia'>Despacho: hoje e atrasados</SelectItem>
            <SelectItem value='outros'>Despacho: outros dias</SelectItem>
            <SelectItem value='todos'>Despacho: todos</SelectItem>
          </SelectContent>
        </Select>
        <span className='ms-auto text-sm text-muted-foreground'>{numero(visiveis.length)} de {numero(itens.length)} itens</span>
      </div>

      <div className='overflow-x-auto rounded-xl border'>
        <Table>
          <TableHeader>
            <TableRow className='bg-muted/40 hover:bg-muted/40'>
              <TableHead className='w-10'>
                <Checkbox checked={todosVisiveis} aria-label='Marcar todos os itens visíveis'
                  onCheckedChange={(v) => setSelecao((s) => { const n = new Set(s); for (const i of visiveis) { if (v) n.add(i.id); else n.delete(i.id) } return n })} />
              </TableHead>
              <TableHead>Despacho</TableHead>
              <TableHead>Plataforma / etiqueta</TableHead>
              <TableHead>Destinatário</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead className='text-end'>Qtd.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }, (_, i) => <TableRow key={i}><TableCell colSpan={6}><Skeleton className='h-10 w-full' /></TableCell></TableRow>)
            ) : visiveis.length ? visiveis.map((i) => (
              <TableRow key={i.id} data-state={selecao.has(i.id) && 'selected'}>
                <TableCell><Checkbox checked={selecao.has(i.id)} onCheckedChange={(v) => alternar(i.id, !!v)} aria-label={`Marcar ${i.title}`} /></TableCell>
                <TableCell><SeloPrazo item={i} /></TableCell>
                <TableCell>
                  <Badge variant='outline' className='font-normal'>{i.channel}</Badge>
                  <div className='mt-1 font-medium tabular-nums whitespace-nowrap'>{i.code || 'Sem envio/rastreio'}</div>
                  <Button variant='link' size='sm' className='h-auto p-0 text-xs' onClick={() => pacote(i.group)}>Marcar o pacote</Button>
                </TableCell>
                <TableCell className='max-w-48'>
                  <div className='truncate'>{i.buyer || 'Não informado'}</div>
                  <div className='text-xs text-muted-foreground tabular-nums'>Pedido {i.order}</div>
                </TableCell>
                <TableCell className='min-w-56 max-w-md'>
                  <div className='line-clamp-2'>{i.title}</div>
                  <div className='truncate text-xs text-muted-foreground'>{[i.variation, i.sku ? `SKU ${i.sku}` : ''].filter(Boolean).join(' · ')}</div>
                </TableCell>
                <TableCell className='text-end text-lg font-semibold tabular-nums'>{i.quantity}</TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={6} className='h-40 text-center text-sm text-muted-foreground'>
                  {itens.length ? 'Nada com esses filtros. Troque o filtro de despacho ou a busca.' : 'Envie as planilhas do dia para montar a lista de separação.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog open={confirmarParcial} onOpenChange={setConfirmarParcial} title='Pacote incompleto'
        desc={`${plural(parciais, 'pacote está marcado', 'pacotes estão marcados')} só em parte. O PDF sai com o aviso "PACOTE INCOMPLETO". Gerar mesmo assim?`}
        confirmText='Gerar PDF' handleConfirm={() => { setConfirmarParcial(false); pdf.mutate() }} />
      <ConfirmDialog open={confirmarNovo} onOpenChange={setConfirmarNovo} title='Começar um lote novo?' destructive
        desc='Os pedidos importados e a seleção saem desta tela. As planilhas originais não são alteradas.'
        confirmText='Começar novo lote' handleConfirm={() => { setConfirmarNovo(false); novoLote.mutate() }} />
    </Pagina>
  )
}

function Numero({ titulo, valor, detalhe, alerta }: { titulo: string; valor: number; detalhe: string; alerta?: boolean }) {
  return (
    <Card className='h-full gap-1 py-4'>
      <CardContent className='px-4'>
        <p className='text-sm text-muted-foreground'>{titulo}</p>
        <p className='text-2xl font-semibold tabular-nums whitespace-nowrap'>{numero(valor)}</p>
        <p className={cn('truncate text-xs', alerta ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>{detalhe}</p>
      </CardContent>
    </Card>
  )
}
