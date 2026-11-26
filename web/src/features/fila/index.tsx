import { useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  type ColumnDef,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ChevronDown, Eye, FileUp, Inbox, Printer, RotateCcw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { hora, dataHora, ehHoje, plural } from '@/lib/formato'
import { api, enviarArquivo, type Pedido, useEstado } from '@/lib/ponte'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTableBulkActions, DataTablePagination } from '@/components/data-table'
import { Pagina } from '@/components/layout/pagina'
import { naFila, origemLegivel, SeloEstado } from './estado'

const rota = getRouteApi('/_authenticated/fila')
type Aba = 'fila' | 'impressas' | 'descartadas'
const FILTRO: Record<Aba, (p: Pedido) => boolean> = {
  fila: naFila,
  impressas: (p) => p.estado === 'impresso',
  descartadas: (p) => p.estado === 'descartado',
}

export function Fila() {
  const { aba = 'fila' } = rota.useSearch()
  const navegar = rota.useNavigate()
  const { data, isLoading } = useEstado()
  const qc = useQueryClient()
  const [busca, setBusca] = useState('')
  const [selecao, setSelecao] = useState<RowSelectionState>({})
  const [previa, setPrevia] = useState<Pedido | null>(null)
  const arquivo = useRef<HTMLInputElement>(null)

  const pedidos = useMemo(() => data?.pedidos ?? [], [data])
  const contagem = useMemo(
    () => ({ fila: pedidos.filter(FILTRO.fila).length, impressas: pedidos.filter(FILTRO.impressas).length, descartadas: pedidos.filter(FILTRO.descartadas).length }),
    [pedidos]
  )
  const linhas = useMemo(() => pedidos.filter(FILTRO[aba]), [pedidos, aba])

  // Imprime ou descarta em sequência (a ponte imprime uma de cada vez) e conta o resultado.
  const acao = useMutation({
    mutationFn: async ({ tipo, jids }: { tipo: 'imprimir' | 'descartar'; jids: string[] }) => {
      let ok = 0
      const erros: string[] = []
      for (const jid of jids) {
        try { await api(`/api/pedido/${jid}/${tipo}`, {}); ok++ } catch (e) { erros.push((e as Error).message) }
      }
      return { tipo, ok, erros }
    },
    onSuccess: ({ tipo, ok, erros }) => {
      setSelecao({})
      qc.invalidateQueries({ queryKey: ['estado'] })
      if (ok) toast.success(tipo === 'imprimir' ? `${plural(ok, 'etiqueta enviada', 'etiquetas enviadas')} para a impressora` : `${plural(ok, 'etiqueta tirada', 'etiquetas tiradas')} da fila`)
      if (erros.length) toast.error(`${plural(erros.length, 'falhou', 'falharam')}: ${erros[0]}`)
    },
  })
  const envio = useMutation({
    mutationFn: async (arquivos: File[]) => { for (const f of arquivos) await enviarArquivo(f); return arquivos.length },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['estado'] })
      navegar({ search: { aba: 'fila' } })
      toast.success(`${plural(n, 'arquivo lido', 'arquivos lidos')}. Confira na fila e clique em Imprimir.`)
    },
  })
  const ocupado = acao.isPending || envio.isPending
  const executar = acao.mutate

  const colunas = useMemo<ColumnDef<Pedido>[]>(() => [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label='Selecionar todas desta página'
        />
      ),
      cell: ({ row }) => (
        <Checkbox checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} aria-label={`Selecionar ${row.original.id}`} />
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'hora',
      header: 'Hora',
      cell: ({ row }) => (
        <span className='tabular-nums whitespace-nowrap' title={dataHora(row.original.hora)}>
          {ehHoje(row.original.hora) ? hora(row.original.hora) : dataHora(row.original.hora)}
        </span>
      ),
    },
    {
      id: 'etiqueta',
      header: 'Etiqueta',
      accessorFn: (p) => `${p.id} ${p.rastreio ?? ''} ${p.origem} ${p.tipo}`,
      cell: ({ row }) => {
        const p = row.original
        return (
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <Badge variant='outline' className='font-normal'>{origemLegivel(p)}</Badge>
              <span className='truncate font-medium tabular-nums'>{p.id.replace(new RegExp(`^${origemLegivel(p)}\\s+`, 'i'), '') || 'Sem número'}</span>
            </div>
            <div className='mt-0.5 truncate text-xs text-muted-foreground'>
              {p.tipo}{p.rastreio ? ` · rastreio ${p.rastreio}` : ''}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'estado',
      header: 'Situação',
      cell: ({ row }) => (
        <div className='flex flex-col items-start gap-1'>
          <SeloEstado estado={row.original.estado} />
          {row.original.erro && <span className='max-w-72 text-xs text-destructive'>{row.original.erro}</span>}
        </div>
      ),
    },
    {
      accessorKey: 'impressoes',
      header: () => <span className='block text-end'>Impressões</span>,
      cell: ({ row }) => <span className='block text-end tabular-nums'>{row.original.impressoes ?? 0}</span>,
    },
    {
      id: 'acoes',
      header: () => <span className='sr-only'>Ações</span>,
      cell: ({ row }) => {
        const p = row.original
        const reimprimir = p.estado === 'impresso' || p.estado === 'descartado'
        return (
          <div className='flex justify-end gap-1'>
            <Button size='sm' variant='ghost' onClick={() => setPrevia(p)} aria-label={`Ver prévia de ${p.id}`}>
              <Eye aria-hidden='true' /> <span className='max-lg:sr-only'>Prévia</span>
            </Button>
            <Button size='sm' variant={reimprimir ? 'outline' : 'default'} disabled={ocupado || p.estado === 'enviando'}
              onClick={() => executar({ tipo: 'imprimir', jids: [p.jid] })}>
              {reimprimir ? <RotateCcw aria-hidden='true' /> : <Printer aria-hidden='true' />}
              {reimprimir ? 'Reimprimir' : p.estado === 'erro' ? 'Tentar de novo' : 'Imprimir'}
            </Button>
            {(p.estado === 'aguardando' || p.estado === 'erro') && (
              <Button size='sm' variant='ghost' disabled={ocupado} onClick={() => executar({ tipo: 'descartar', jids: [p.jid] })} aria-label={`Descartar ${p.id}`}>
                <Trash2 aria-hidden='true' />
              </Button>
            )}
          </div>
        )
      },
    },
  ], [executar, ocupado])

  const tabela = useReactTable({
    data: linhas,
    columns: colunas,
    getRowId: (p) => p.jid,
    state: { rowSelection: selecao, globalFilter: busca },
    onRowSelectionChange: setSelecao,
    onGlobalFilterChange: setBusca,
    globalFilterFn: (row, _c, valor) => String(row.getValue('etiqueta')).toLowerCase().includes(String(valor).toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })
  const selecionadas = tabela.getFilteredSelectedRowModel().rows.map((r) => r.original)
  const aguardando = pedidos.filter((p) => p.estado === 'aguardando' || p.estado === 'erro')

  return (
    <Pagina
      titulo='Fila de impressão'
      descricao='Etiquetas que chegaram do Mercado Livre, Shopee, TikTok ou de arquivo. Atualiza sozinha a cada 2 segundos.'
      acoes={
        <>
          <input ref={arquivo} type='file' accept='.zip,.txt,.zpl' multiple hidden
            onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) envio.mutate(f) }} />
          <Button variant='outline' onClick={() => arquivo.current?.click()} disabled={ocupado}>
            <FileUp aria-hidden='true' /> Enviar arquivo
          </Button>
          <Button onClick={() => acao.mutate({ tipo: 'imprimir', jids: aguardando.map((p) => p.jid) })} disabled={ocupado || !aguardando.length}>
            <Printer aria-hidden='true' /> Imprimir a fila ({aguardando.length})
          </Button>
        </>
      }
    >
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm',
        data?.fila.ok ? 'border-emerald-600/25 bg-emerald-600/5' : 'border-destructive/30 bg-destructive/5')} role='status'>
        <Printer className={cn('size-4', data?.fila.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive')} aria-hidden='true' />
        <span className='font-medium'>{data ? (data.fila.ok ? 'Impressora pronta' : 'Impressora com problema') : 'Consultando a impressora…'}</span>
        {data && <span className='text-muted-foreground'>{data.fila.texto}</span>}
      </div>

      <div className='flex flex-wrap items-center justify-between gap-3'>
        <Tabs value={aba} onValueChange={(v) => { setSelecao({}); navegar({ search: { aba: v as Aba } }) }}>
          <TabsList>
            <TabsTrigger value='fila'>Na fila <Contador n={contagem.fila} destaque /></TabsTrigger>
            <TabsTrigger value='impressas'>Impressas <Contador n={contagem.impressas} /></TabsTrigger>
            <TabsTrigger value='descartadas'>Descartadas <Contador n={contagem.descartadas} /></TabsTrigger>
          </TabsList>
        </Tabs>
        <div className='relative w-full sm:w-72'>
          <Search className='absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden='true' />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder='Buscar envio, rastreio ou origem' className='ps-8' aria-label='Buscar na fila' />
        </div>
      </div>

      {/* celular: cartões, cada um com a ação principal à vista */}
      <ul className='flex flex-col gap-3 md:hidden' aria-label='Etiquetas'>
        {tabela.getRowModel().rows.map((r) => {
          const p = r.original
          const reimprimir = p.estado === 'impresso' || p.estado === 'descartado'
          return (
            <li key={r.id} className={cn('rounded-xl border p-4', p.estado === 'erro' && 'border-destructive/30 bg-destructive/5')}>
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <div className='flex items-center gap-2'>
                    <Badge variant='outline' className='font-normal'>{origemLegivel(p)}</Badge>
                    <span className='text-sm text-muted-foreground tabular-nums'>{hora(p.hora)}</span>
                  </div>
                  <p className='mt-1 truncate font-medium tabular-nums'>{p.id.replace(new RegExp(`^${origemLegivel(p)}\\s+`, 'i'), '') || 'Sem número'}</p>
                  <p className='truncate text-xs text-muted-foreground'>{p.tipo}</p>
                </div>
                <SeloEstado estado={p.estado} />
              </div>
              {p.erro && <p className='mt-2 text-xs text-destructive'>{p.erro}</p>}
              <div className='mt-3 grid grid-cols-2 gap-2'>
                <Button variant='outline' onClick={() => setPrevia(p)}><Eye aria-hidden='true' /> Prévia</Button>
                <Button variant={reimprimir ? 'outline' : 'default'} disabled={ocupado || p.estado === 'enviando'} onClick={() => executar({ tipo: 'imprimir', jids: [p.jid] })}>
                  {reimprimir ? <RotateCcw aria-hidden='true' /> : <Printer aria-hidden='true' />} {reimprimir ? 'Reimprimir' : 'Imprimir'}
                </Button>
              </div>
            </li>
          )
        })}
        {!isLoading && !tabela.getRowModel().rows.length && (
          <li className='rounded-xl border p-6'><Vazio aba={aba} buscando={!!busca} onArquivo={() => arquivo.current?.click()} /></li>
        )}
      </ul>

      <div className='hidden overflow-hidden rounded-xl border md:block'>
        <Table>
          <TableHeader>
            {tabela.getHeaderGroups().map((g) => (
              <TableRow key={g.id} className='bg-muted/40 hover:bg-muted/40'>
                {g.headers.map((h) => (
                  <TableHead key={h.id} className={cn(h.id === 'select' && 'w-10', h.id === 'acoes' && 'text-end')}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }, (_, i) => (
                <TableRow key={i}><TableCell colSpan={colunas.length}><Skeleton className='h-9 w-full' /></TableCell></TableRow>
              ))
            ) : tabela.getRowModel().rows.length ? (
              tabela.getRowModel().rows.map((r) => (
                <TableRow key={r.id} data-state={r.getIsSelected() && 'selected'} className={cn(r.original.estado === 'erro' && 'bg-destructive/5')}>
                  {r.getVisibleCells().map((c) => (
                    <TableCell key={c.id} className={cn('py-2.5 align-middle', c.column.id === 'etiqueta' && 'max-w-[22rem]')}>
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={colunas.length} className='h-48'>
                  <Vazio aba={aba} buscando={!!busca} onArquivo={() => arquivo.current?.click()} />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {linhas.length > 20 && <DataTablePagination table={tabela} />}

      <DataTableBulkActions table={tabela} entityName='etiqueta'>
        <Button size='sm' disabled={ocupado} onClick={() => acao.mutate({ tipo: 'imprimir', jids: selecionadas.map((p) => p.jid) })}>
          <Printer aria-hidden='true' /> {aba === 'fila' ? 'Imprimir' : 'Reimprimir'}
        </Button>
        {aba === 'fila' && (
          <Button size='sm' variant='outline' disabled={ocupado}
            onClick={() => acao.mutate({ tipo: 'descartar', jids: selecionadas.filter((p) => p.estado !== 'enviando').map((p) => p.jid) })}>
            <Trash2 aria-hidden='true' /> Descartar
          </Button>
        )}
      </DataTableBulkActions>

      <Collapsible className='rounded-xl border'>
        <CollapsibleTrigger className='group flex w-full items-center justify-between px-4 py-3 text-sm font-medium'>
          Registro técnico da ponte
          <ChevronDown className='size-4 transition-transform group-data-[state=open]:rotate-180' aria-hidden='true' />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className='max-h-72 overflow-auto border-t bg-muted/30 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap'>
            {(data?.log ?? []).join('\n') || 'Sem registros recentes.'}
          </pre>
        </CollapsibleContent>
      </Collapsible>

      <Sheet open={!!previa} onOpenChange={(v) => !v && setPrevia(null)}>
        <SheetContent className='w-full sm:max-w-md'>
          {previa && (
            <>
              <SheetHeader>
                <SheetTitle>Etiqueta {previa.id || 'sem número'}</SheetTitle>
                <SheetDescription>{origemLegivel(previa)} · {previa.tipo} · chegou {dataHora(previa.hora)}</SheetDescription>
              </SheetHeader>
              <div className='flex flex-1 flex-col gap-4 overflow-auto px-4'>
                <img src={`/api/previa/${previa.jid}.png`} alt={`Prévia da etiqueta ${previa.id}`} className='mx-auto w-full max-w-xs rounded-md border bg-white' />
                <Button disabled={ocupado} onClick={() => { acao.mutate({ tipo: 'imprimir', jids: [previa.jid] }); setPrevia(null) }}>
                  <Printer aria-hidden='true' /> {previa.estado === 'impresso' ? 'Reimprimir' : 'Imprimir'}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Pagina>
  )
}

function Contador({ n, destaque }: { n: number; destaque?: boolean }) {
  return (
    <span className={cn('ms-1.5 rounded-full px-1.5 text-xs tabular-nums', destaque && n ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
      {n}
    </span>
  )
}

function Vazio({ aba, buscando, onArquivo }: { aba: Aba; buscando: boolean; onArquivo: () => void }) {
  if (buscando) return <p className='text-center text-sm text-muted-foreground'>Nada encontrado com essa busca.</p>
  return (
    <div className='mx-auto flex max-w-md flex-col items-center gap-2 text-center'>
      <Inbox className='size-8 text-muted-foreground' aria-hidden='true' />
      <p className='font-medium'>{aba === 'fila' ? 'Nenhuma etiqueta esperando' : aba === 'impressas' ? 'Nenhuma etiqueta impressa ainda' : 'Nenhuma etiqueta descartada'}</p>
      {aba === 'fila' && (
        <>
          <p className='text-sm text-muted-foreground'>Baixe a etiqueta no Mercado Livre, na Shopee ou no TikTok: ela aparece aqui sozinha. Ou envie o arquivo.</p>
          <Button variant='outline' size='sm' onClick={onArquivo}><FileUp aria-hidden='true' /> Enviar arquivo</Button>
        </>
      )}
    </div>
  )
}
