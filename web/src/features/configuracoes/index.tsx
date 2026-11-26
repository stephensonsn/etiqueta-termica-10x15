import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { ChevronDown, Eye, EyeOff, History, Printer, Ruler, Store } from 'lucide-react'
import { toast } from 'sonner'
import { dataHora, plural } from '@/lib/formato'
import { api, type Config, type MlApp, salvarConfig, useEstado, useMlApp, useMlEtiquetas } from '@/lib/ponte'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Pagina } from '@/components/layout/pagina'
import { PreviaEtiqueta } from '@/features/fila/detalhe'
import { CAMPOS_AVANCADOS, CAMPOS_CALIB, type ChaveCalib, conferirCampo, paraNumero } from './calibracao'

const rota = getRouteApi('/_authenticated/configuracoes')
export type Secao = 'impressao' | 'calibracao' | 'historico' | 'mercado-livre'
const SECOES: { valor: Secao; rotulo: string; icone: React.ElementType }[] = [
  { valor: 'impressao', rotulo: 'Impressão', icone: Printer },
  { valor: 'calibracao', rotulo: 'Calibração', icone: Ruler },
  { valor: 'historico', rotulo: 'Histórico', icone: History },
  { valor: 'mercado-livre', rotulo: 'Mercado Livre automático', icone: Store },
]

function useSalvar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (parcial: Record<string, unknown>) => salvarConfig(parcial),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['estado'] }); toast.success('Salvo') },
  })
}

export function Configuracoes() {
  const { secao = 'impressao' } = rota.useSearch()
  const navegar = rota.useNavigate()
  const { data } = useEstado()
  return (
    <Pagina titulo='Configurações' descricao='Como a ponte imprime, calibração, por quanto tempo guarda o histórico e a automação do Mercado Livre.'>
      <div className='grid grid-cols-1 gap-6 md:grid-cols-[200px_minmax(0,1fr)]'>
        <nav aria-label='Seções' className='flex gap-1 overflow-x-auto md:flex-col'>
          {SECOES.map((s) => {
            const Icone = s.icone
            return (
              <button key={s.valor} type='button' onClick={() => navegar({ search: { secao: s.valor } })} aria-current={secao === s.valor ? 'page' : undefined}
                className={cn('flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-start text-sm whitespace-nowrap transition-colors hover:bg-muted',
                  secao === s.valor && 'bg-muted font-medium')}>
                <Icone className='size-4 text-muted-foreground' aria-hidden='true' /> {s.rotulo}
              </button>
            )
          })}
        </nav>
        <div className='min-w-0'>
          {!data ? <Skeleton className='h-64 w-full' />
            : secao === 'impressao' ? <SecaoImpressao c={data.config} />
              : secao === 'calibracao' ? <SecaoCalibracao c={data.config} limites={data.limites} ultima={data.pedidos[0]?.jid} />
                : secao === 'historico' ? <SecaoHistorico c={data.config} total={data.pedidos.length} maisAntiga={data.pedidos[data.pedidos.length - 1]?.hora} key={data.config.historicoDias} />
                  : <SecaoMercadoLivre />}
        </div>
      </div>
    </Pagina>
  )
}

// Uma opção por linha: título + explicação à esquerda, controle à direita (padrão Featurebase/Buffer).
function Linha({ titulo, detalhe, children, id }: { titulo: string; detalhe: string; children: React.ReactNode; id: string }) {
  return (
    <div className='flex items-center justify-between gap-4 px-5 py-4'>
      <div className='min-w-0'>
        <Label htmlFor={id} className='text-sm font-medium'>{titulo}</Label>
        <p className='mt-0.5 text-xs text-muted-foreground'>{detalhe}</p>
      </div>
      <div className='shrink-0'>{children}</div>
    </div>
  )
}

function SecaoImpressao({ c }: { c: Config }) {
  const salvar = useSalvar()
  return (
    <div className='flex flex-col gap-6'>
      <Card className='gap-0 py-0'>
        <CardHeader className='border-b py-4'><CardTitle className='text-base'>Quando imprimir</CardTitle></CardHeader>
        <RadioGroup value={c.imprimir} onValueChange={(v) => salvar.mutate({ imprimir: v })} className='gap-0 divide-y'>
          {[
            { v: 'direto', t: 'Imprimir direto', d: 'A etiqueta que chega imprime sozinha, sem clique' },
            { v: 'conferir', t: 'Conferir antes', d: 'A etiqueta espera na fila até você clicar Imprimir' },
          ].map((o) => (
            <label key={o.v} htmlFor={`imp-${o.v}`} className='flex cursor-pointer items-center gap-3 px-5 py-4'>
              <RadioGroupItem id={`imp-${o.v}`} value={o.v} />
              <span><span className='block text-sm font-medium'>{o.t}</span><span className='block text-xs text-muted-foreground'>{o.d}</span></span>
            </label>
          ))}
        </RadioGroup>
      </Card>
      <Card className='gap-0 py-0'>
        <CardHeader className='border-b py-4'><CardTitle className='text-base'>Formato da etiqueta</CardTitle></CardHeader>
        <RadioGroup value={c.modo} onValueChange={(v) => salvar.mutate({ modo: v })} className='gap-0 divide-y'>
          {[
            { v: 'junto', t: 'Envio e documento fiscal juntos', d: 'Uma etiqueta 10x15 com o envio em cima e a DANFE/DACE resumida embaixo' },
            { v: 'cheio', t: 'Em etiquetas separadas', d: 'O envio numa etiqueta e o documento fiscal em outra' },
          ].map((o) => (
            <label key={o.v} htmlFor={`fmt-${o.v}`} className='flex cursor-pointer items-center gap-3 px-5 py-4'>
              <RadioGroupItem id={`fmt-${o.v}`} value={o.v} />
              <span><span className='block text-sm font-medium'>{o.t}</span><span className='block text-xs text-muted-foreground'>{o.d}</span></span>
            </label>
          ))}
        </RadioGroup>
      </Card>
      <Card className='gap-0 divide-y py-0'>
        <Linha id='vigiar' titulo='Pegar as etiquetas baixadas' detalhe='Arquivo de etiqueta que cair na pasta Downloads entra sozinho na fila'>
          <Switch id='vigiar' checked={c.vigiarDownloads} onCheckedChange={(v) => salvar.mutate({ vigiarDownloads: v })} />
        </Linha>
        <Linha id='limpar' titulo='Apagar o arquivo depois de imprimir' detalhe='Tira de vez o .zip ou .txt baixado quando todas as etiquetas dele saírem'>
          <Switch id='limpar' checked={c.limparDownloads} onCheckedChange={(v) => salvar.mutate({ limparDownloads: v })} />
        </Linha>
      </Card>
    </div>
  )
}

function SecaoCalibracao({ c, limites, ultima }: { c: Config; limites: Record<string, [number, number]>; ultima?: string }) {
  const salvar = useSalvar()
  const qc = useQueryClient()
  const inicial = () => Object.fromEntries([...CAMPOS_CALIB, ...CAMPOS_AVANCADOS].map((f) => [f.chave, String(c.calib[f.chave]).replace('.', ',')])) as Record<ChaveCalib, string>
  const [valores, setValores] = useState(inicial)
  const [linhaInicial, setLinhaInicial] = useState(c.calib.crlfInicial)
  const erros = Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, conferirCampo(v, limites[k])])) as Record<ChaveCalib, string>
  const temErro = Object.values(erros).some(Boolean)
  const regua = useMutation({ mutationFn: () => api('/api/teste', { tipo: 'regua' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['estado'] }); toast.success('Régua enviada') } })
  const previa = { ...c.calib, deslocXmm: paraNumero(valores.deslocXmm) || 0, deslocYmm: paraNumero(valores.deslocYmm) || 0 }

  const campo = (f: (typeof CAMPOS_CALIB)[number] | (typeof CAMPOS_AVANCADOS)[number]) => (
    <div key={f.chave} className='flex flex-col gap-1.5'>
      <Label htmlFor={`c-${f.chave}`}>{f.rotulo}{f.unidade && <span className='font-normal text-muted-foreground'> ({f.unidade})</span>}</Label>
      <Input id={`c-${f.chave}`} inputMode='decimal' value={valores[f.chave]} aria-invalid={!!erros[f.chave]} aria-describedby={`c-${f.chave}-ajuda`}
        onChange={(e) => setValores((v) => ({ ...v, [f.chave]: e.target.value }))} />
      <p id={`c-${f.chave}-ajuda`} className={cn('text-xs', erros[f.chave] ? 'text-destructive' : 'text-muted-foreground')}>{erros[f.chave] || f.ajuda}</p>
    </div>
  )
  return (
    <div className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_220px]'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Ajuste fino da impressão</CardTitle>
          <CardDescription>Use se a etiqueta sair torta, cortada ou clara demais. Imprima a régua para conferir.</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-5'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>{CAMPOS_CALIB.map(campo)}</div>
          <Collapsible>
            <CollapsibleTrigger className='group flex items-center gap-1 text-sm font-medium'>
              Avançado <ChevronDown className='size-4 transition-transform group-data-[state=open]:rotate-180' aria-hidden='true' />
            </CollapsibleTrigger>
            <CollapsibleContent className='mt-4 flex flex-col gap-4'>
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>{CAMPOS_AVANCADOS.map(campo)}</div>
              <div className='flex items-center justify-between gap-4'>
                <div><Label htmlFor='crlf'>Linha em branco antes de cada etiqueta</Label><p className='text-xs text-muted-foreground'>Ligue se a primeira linha da etiqueta sair cortada</p></div>
                <Switch id='crlf' checked={linhaInicial} onCheckedChange={setLinhaInicial} />
              </div>
            </CollapsibleContent>
          </Collapsible>
          <div className='flex flex-wrap gap-2'>
            <Button disabled={temErro || salvar.isPending}
              onClick={() => salvar.mutate({ calib: { ...Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, paraNumero(v)])), crlfInicial: linhaInicial } })}>
              Salvar calibração
            </Button>
            <Button variant='outline' onClick={() => regua.mutate()} disabled={regua.isPending}>Imprimir régua</Button>
            <Button variant='ghost' onClick={() => { setValores(inicial()); setLinhaInicial(c.calib.crlfInicial) }}>Desfazer</Button>
          </div>
        </CardContent>
      </Card>
      <div className='flex flex-col items-center gap-2'>
        <p className='text-sm font-medium'>Como vai sair</p>
        {ultima ? <PreviaEtiqueta jid={ultima} calib={previa} alt='Prévia da última etiqueta com o deslocamento' className='w-full max-w-[220px]' />
          : <div className='flex aspect-[2/3] w-full max-w-[220px] items-center justify-center rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground'>A prévia aparece depois da primeira etiqueta</div>}
        <p className='text-center text-xs text-muted-foreground'>Última etiqueta da fila, com o deslocamento digitado</p>
      </div>
    </div>
  )
}

function SecaoHistorico({ c, total, maisAntiga }: { c: Config; total: number; maisAntiga?: string }) {
  const salvar = useSalvar()
  const [dias, setDias] = useState(String(c.historicoDias ?? 2)) // a seção remonta (key) quando o valor salvo muda
  const n = Number(dias)
  const erro = !Number.isInteger(n) || n < 1 || n > 30 ? 'De 1 a 30 dias' : ''
  return (
    <div className='flex flex-col gap-6'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Histórico de impressão</CardTitle>
          <CardDescription>As etiquetas ficam guardadas neste computador, com a prévia, para reimprimir mesmo depois de reiniciar.</CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          <div className='flex flex-wrap items-end gap-3'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='dias'>Excluir o histórico depois de</Label>
              <div className='flex items-center gap-2'>
                <Input id='dias' inputMode='numeric' className='w-20' value={dias} aria-invalid={!!erro} onChange={(e) => setDias(e.target.value)} aria-describedby='dias-ajuda' />
                <span className='text-sm'>dias</span>
              </div>
            </div>
            <Button disabled={!!erro || n === c.historicoDias || salvar.isPending} onClick={() => salvar.mutate({ historicoDias: n })}>Salvar</Button>
          </div>
          <p id='dias-ajuda' className={cn('text-xs', erro ? 'text-destructive' : 'text-muted-foreground')}>
            {erro || 'Etiquetas esperando na fila nunca são excluídas, só as impressas, com falha ou descartadas.'}
          </p>
          <dl className='grid grid-cols-2 gap-4 rounded-lg bg-muted/40 p-4'>
            <div><dt className='text-xs text-muted-foreground'>Guardadas agora</dt><dd className='text-xl font-semibold tabular-nums'>{plural(total, 'etiqueta', 'etiquetas')}</dd></div>
            <div><dt className='text-xs text-muted-foreground'>A mais antiga</dt><dd className='text-xl font-semibold tabular-nums'>{maisAntiga ? dataHora(maisAntiga) : '—'}</dd></div>
          </dl>
        </CardContent>
      </Card>
      <Card className='gap-0 py-0'>
        <Linha id='hist' titulo='Guardar o registro técnico em arquivo' detalhe='Grava cada passo da ponte em logs/ (um arquivo por dia). Útil para investigar problemas'>
          <Switch id='hist' checked={c.guardarHistorico} onCheckedChange={(v) => salvar.mutate({ guardarHistorico: v })} />
        </Linha>
      </Card>
    </div>
  )
}

function SecaoMercadoLivre() {
  const qc = useQueryClient()
  const { data: e } = useMlEtiquetas()
  const { data: app } = useMlApp()
  const [colado, setColado] = useState('')
  const [retornoMl] = useState(() => new URLSearchParams(window.location.search).get('ml'))
  const recarregar = () => { qc.invalidateQueries({ queryKey: ['ml-etiquetas'] }); qc.invalidateQueries({ queryKey: ['ml-app'] }) }
  const cfg = useMutation({ mutationFn: (c: Record<string, unknown>) => api('/api/ml-etiquetas/config', c), onSuccess: () => { recarregar(); toast.success('Salvo') } })
  const adicionar = useMutation({ mutationFn: () => api('/api/ml-etiquetas/autorizar', { colado }), onSuccess: () => { setColado(''); recarregar(); toast.success('Conta adicionada') } })
  const conectar = useMutation({ mutationFn: async () => { const r = await api<{ url: string }>('/api/ml-etiquetas/autorizar'); window.location.assign(r.url) } })

  if (!e || !app) return <Skeleton className='h-64 w-full' />
  const appPronto = !!(app.appId && app.temSegredo)
  const semContas = !e.contas.length
  return (
    <div className='flex flex-col gap-6'>
      {retornoMl && (
        <Alert variant={retornoMl.startsWith('ok:') ? 'default' : 'destructive'}>
          <AlertDescription>{retornoMl.replace(/^(ok|erro):/, '')}</AlertDescription>
        </Alert>
      )}
      <Card className='gap-0 divide-y py-0'>
        <CardHeader className='py-4'>
          <CardTitle className='text-base'>Impressão automática das vendas</CardTitle>
          <CardDescription>A cada 5 minutos a ponte busca as vendas prontas para enviar e imprime a etiqueta sozinha.</CardDescription>
        </CardHeader>
        <Linha id='ml-ligado' titulo='Imprimir sozinha as etiquetas prontas' detalhe={semContas ? 'Conecte uma conta abaixo para ligar' : `${plural(e.contas.length, 'conta conectada', 'contas conectadas')}`}>
          <Switch id='ml-ligado' checked={e.ligado} disabled={semContas} onCheckedChange={(v) => cfg.mutate({ ligado: v })} />
        </Linha>
        <Linha id='ml-nfe' titulo='Emitir a NF-e quando faltar' detalhe='Pede a nota ao Faturador do Mercado Livre para liberar a etiqueta'>
          <Switch id='ml-nfe' checked={e.emitirNfe} disabled={semContas} onCheckedChange={(v) => cfg.mutate({ emitirNfe: v })} />
        </Linha>
      </Card>

      <Card>
        <CardHeader className='flex flex-row items-start justify-between gap-3'>
          <div><CardTitle className='text-base'>Contas</CardTitle><CardDescription>Uma por vendedor. O login usa a conta administradora.</CardDescription></div>
          <Button disabled={!appPronto || conectar.isPending} title={appPronto ? undefined : 'Configure o aplicativo abaixo (uma vez só)'} onClick={() => conectar.mutate()}>Conectar conta</Button>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          {semContas ? <p className='text-sm text-muted-foreground'>Nenhuma conta autorizada ainda.</p> : (
            <ul className='divide-y rounded-lg border'>
              {e.contas.map((c) => (
                <li key={c.uid} className='flex items-center justify-between gap-3 px-4 py-2.5 text-sm'>
                  <span className='font-medium'>{c.apelido}</span>
                  <Button size='sm' variant='ghost' onClick={() => cfg.mutate({ remover: c.uid })}>Remover</Button>
                </li>
              ))}
            </ul>
          )}
          <form className='flex flex-wrap gap-2' onSubmit={(ev) => { ev.preventDefault(); if (colado.trim()) adicionar.mutate() }}>
            <Label htmlFor='ml-colado' className='sr-only'>Endereço com o código de autorização</Label>
            <Input id='ml-colado' className='min-w-56 flex-1' placeholder='Ou cole aqui o endereço com ?code=' value={colado} onChange={(ev) => setColado(ev.target.value)} />
            <Button type='submit' variant='outline' disabled={!colado.trim() || adicionar.isPending}>Adicionar conta</Button>
          </form>
        </CardContent>
      </Card>

      {!!e.travados.length && (
        <Card>
          <CardHeader><CardTitle className='text-base'>Envios travados</CardTitle><CardDescription>Corrija o cadastro no Mercado Livre e tente de novo.</CardDescription></CardHeader>
          <CardContent>
            <ul className='divide-y rounded-lg border'>
              {e.travados.map((t) => (
                <li key={t.envio} className='flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm'>
                  <span><span className='font-medium'>{t.conta}</span>: {t.motivo}</span>
                  <Button size='sm' variant='outline' onClick={() => cfg.mutate({ liberar: t.envio })}>Corrigi, tentar de novo</Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <AppMercadoLivre app={app} pronto={appPronto} aoSalvar={recarregar} />

      <Collapsible className='rounded-xl border'>
        <CollapsibleTrigger className='group flex w-full items-center justify-between px-5 py-4 text-sm font-medium'>
          Eventos da automação
          <ChevronDown className='size-4 transition-transform group-data-[state=open]:rotate-180' aria-hidden='true' />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className='max-h-60 overflow-auto border-t bg-muted/30 px-5 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap'>
            {[...e.pendencias.map((p) => `PENDENTE: ${p.texto}`), ...e.eventos.map((v) => `${dataHora(v.hora)}  ${v.txt}`)].join('\n') || 'Sem registros ainda.'}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function AppMercadoLivre({ app, pronto, aoSalvar }: { app: MlApp; pronto: boolean; aoSalvar: () => void }) {
  const [mostrar, setMostrar] = useState(false)
  const [form, setForm] = useState({ appId: app.appId || '', segredo: '', retorno: String(app.retorno ?? '') })
  const salvarApp = useMutation({ mutationFn: () => api('/api/ml/config', form), onSuccess: () => { setForm((f) => ({ ...f, segredo: '' })); aoSalvar(); toast.success('Aplicativo salvo') } })
  const appPronto = pronto
  return (
      <Collapsible defaultOpen={!appPronto} className='rounded-xl border'>
        <CollapsibleTrigger className='group flex w-full items-center justify-between px-5 py-4 text-sm font-medium'>
          <span>Aplicativo do Mercado Livre <span className={cn('ms-2 text-xs font-normal', appPronto ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300')}>{appPronto ? 'configurado' : 'falta configurar'}</span></span>
          <ChevronDown className='size-4 transition-transform group-data-[state=open]:rotate-180' aria-hidden='true' />
        </CollapsibleTrigger>
        <CollapsibleContent className='flex flex-col gap-4 border-t p-5'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <div className='flex flex-col gap-1.5'><Label htmlFor='ml-id'>ID do aplicativo</Label><Input id='ml-id' value={form.appId} onChange={(ev) => setForm({ ...form, appId: ev.target.value })} /></div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='ml-seg'>Chave secreta</Label>
              <div className='relative'>
                <Input id='ml-seg' type={mostrar ? 'text' : 'password'} autoComplete='off' className='pe-10' placeholder={app.temSegredo ? 'já cadastrada (deixe vazio para manter)' : ''}
                  value={form.segredo} onChange={(ev) => setForm({ ...form, segredo: ev.target.value })} />
                <Button type='button' size='icon' variant='ghost' className='absolute inset-e-0 top-0' onClick={() => setMostrar(!mostrar)} aria-label={mostrar ? 'Esconder a chave' : 'Mostrar a chave'}>
                  {mostrar ? <EyeOff aria-hidden='true' /> : <Eye aria-hidden='true' />}
                </Button>
              </div>
            </div>
          </div>
          <div className='flex flex-col gap-1.5'><Label htmlFor='ml-ret'>Endereço de retorno</Label><Input id='ml-ret' value={form.retorno} onChange={(ev) => setForm({ ...form, retorno: ev.target.value })} /></div>
          <div><Button onClick={() => salvarApp.mutate()} disabled={salvarApp.isPending || !form.appId.trim()}>Salvar aplicativo</Button></div>
        </CollapsibleContent>
      </Collapsible>
  )
}
