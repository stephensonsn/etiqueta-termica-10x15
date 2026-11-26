import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Bluetooth, Cable, Check, CircleCheck, ExternalLink, Network, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { escolherImpressora, temWebBluetooth } from '@/lib/ble-navegador'
import { api, useEstado } from '@/lib/ponte'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Pagina } from '@/components/layout/pagina'
import { ETAPAS, etapaPronta, FALTA, liberacoes, type Metodo, metodoAtual } from './assistente'
import { diagnostico } from './regras'

const METODOS: { v: Metodo; t: string; d: string; icone: React.ElementType }[] = [
  { v: 'usb', t: 'Cabo USB', d: 'A impressora ligada no computador pelo cabo', icone: Cable },
  { v: 'ble', t: 'Bluetooth', d: 'Sem fio, perto do computador (OIA-8370-B e parecidas)', icone: Bluetooth },
  { v: 'rede', t: 'Rede', d: 'Wi-Fi ou cabo de rede, pelo endereço IP', icone: Network },
]
const PASSOS: Record<Metodo, string[]> = {
  usb: ['Ligue a impressora na tomada e no USB do computador.', 'Espere ela aparecer abaixo (leva alguns segundos).', 'Clique em Usar esta impressora.'],
  ble: ['Ligue a impressora e deixe perto do computador.', 'Confira o nome Bluetooth dela (sai na etiqueta de autoteste; na OIA-8370-B é OIA-8370-B) e clique em Usar.', 'Não precisa parear nos Ajustes do Sistema nem digitar código.'],
  rede: ['Ligue a impressora na mesma rede deste computador.', 'Descubra o endereço IP dela (na etiqueta de autoteste ou no roteador).', 'Digite o endereço e clique em Usar este endereço.'],
}

export function ConfigurarImpressora() {
  const { data: e } = useEstado()
  const qc = useQueryClient()
  const navegar = useNavigate()
  const [etapa, setEtapa] = useState(1)
  const [metodo, setMetodo] = useState<Metodo | null>(null)
  const [testeEnviado, setTesteEnviado] = useState(false)
  const [testeOk, setTesteOk] = useState(false)
  const [semMl, setSemMl] = useState(false)
  const [nomeBle, setNomeBle] = useState('')
  const [ip, setIp] = useState('')
  const atualizar = () => qc.invalidateQueries({ queryKey: ['estado'] })
  const chamar = useMutation({ mutationFn: ({ rota, corpo }: { rota: string; corpo: unknown }) => api(rota, corpo), onSuccess: atualizar })
  const concluir = useMutation({
    mutationFn: () => api('/api/config', { configurado: true }),
    onSuccess: () => { atualizar(); toast.success('Impressora configurada'); navegar({ to: '/impressora' }) },
  })

  if (!e) return <Pagina titulo='Configurar impressora'><Skeleton className='h-96 w-full' /></Pagina>
  const met = metodo ?? metodoAtual(e)
  const pronta = etapaPronta(etapa, { e, metodo: met, testeOk, semMl })
  const usb = e.conexoes.usb.find((u) => u.ligada)

  return (
    <Pagina titulo='Configurar impressora' descricao='Cinco passos. Cada um só libera o próximo quando está pronto de verdade.'>
      {/* trilha das etapas */}
      <ol className='grid grid-cols-5 gap-2' aria-label='Etapas'>
        {ETAPAS.map((nome, i) => {
          const n = i + 1
          const feita = n < etapa
          return (
            <li key={nome} aria-current={n === etapa ? 'step' : undefined} className='flex flex-col items-center gap-1.5 text-center'>
              <span className={cn('flex size-8 items-center justify-center rounded-full border text-sm font-semibold',
                feita ? 'border-emerald-600 bg-emerald-600 text-white' : n === etapa ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                {feita ? <Check className='size-4' aria-hidden='true' /> : n}
              </span>
              <span className={cn('text-xs', n === etapa ? 'font-medium' : 'text-muted-foreground', 'max-sm:sr-only')}>{nome}</span>
            </li>
          )
        })}
      </ol>

      <Card className='mx-auto w-full max-w-2xl'>
        <CardHeader>
          <CardTitle>{etapa}. {ETAPAS[etapa - 1]}</CardTitle>
          <CardDescription>
            {etapa === 1 && 'Como a impressora está ligada neste computador?'}
            {etapa === 2 && 'Permissões que o macOS precisa dar para a ponte.'}
            {etapa === 3 && met && PASSOS[met].join(' ')}
            {etapa === 4 && 'Imprima uma régua e confira se saiu inteira.'}
            {etapa === 5 && 'O botão Imprimir do Mercado Livre precisa achar a ponte uma vez.'}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-4'>
          {etapa === 1 && (
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-3' role='radiogroup' aria-label='Como a impressora está ligada'>
              {METODOS.map((m) => {
                const Icone = m.icone
                const ativo = met === m.v
                return (
                  <button key={m.v} type='button' role='radio' aria-checked={ativo} onClick={() => setMetodo(m.v)}
                    className={cn('flex h-full flex-col items-start gap-2 rounded-xl border p-4 text-start transition-colors hover:bg-muted/50', ativo && 'border-primary ring-1 ring-primary')}>
                    <Icone className='size-5 text-primary' aria-hidden='true' />
                    <span className='text-sm font-medium'>{m.t}</span>
                    <span className='text-xs text-muted-foreground'>{m.d}</span>
                  </button>
                )
              })}
            </div>
          )}

          {etapa === 2 && (
            <ul className='divide-y rounded-lg border'>
              {liberacoes(e, met).map((c) => (
                <li key={c.chave} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                  {c.ok ? <CircleCheck className='size-5 text-emerald-600' aria-hidden='true' /> : <TriangleAlert className='size-5 text-amber-600' aria-hidden='true' />}
                  <div className='min-w-0 flex-1'><p className='text-sm font-medium'>{c.titulo}</p><p className='text-xs text-muted-foreground'>{c.detalhe}</p></div>
                  {!c.ok && c.acao && <Button size='sm' variant='outline' onClick={() => chamar.mutate({ rota: c.acao!.rota, corpo: c.acao!.corpo })}>{c.acao.rotulo}</Button>}
                </li>
              ))}
            </ul>
          )}

          {etapa === 3 && met === 'usb' && (
            usb ? <Button onClick={() => chamar.mutate({ rota: '/api/config', corpo: { conexao: usb.semFila ? { tipo: 'usb', uri: usb.uri } : { tipo: 'usb', fila: usb.fila } } })}>Usar esta impressora ({usb.nome})</Button>
              : <p className='rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm'>Nenhuma impressora no cabo ainda. Ligue o cabo e a tomada; ela aparece aqui sozinha.</p>
          )}
          {etapa === 3 && met === 'ble' && (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='nome-ble'>Nome Bluetooth da impressora</Label>
              <div className='flex flex-wrap gap-2'>
                <Input id='nome-ble' className='min-w-48 flex-1' value={nomeBle || e.config.conexao.bleNome || 'OIA-8370-B'} onChange={(ev) => setNomeBle(ev.target.value)} />
                <Button onClick={() => chamar.mutate({ rota: '/api/config', corpo: { conexao: { tipo: 'ble', bleNome: nomeBle || e.config.conexao.bleNome || 'OIA-8370-B' } } })}>Usar</Button>
              </div>
              {temWebBluetooth() && <Button variant='link' className='h-auto self-start p-0' onClick={() => escolherImpressora().then(atualizar).catch((err) => toast.error(err.message))}>Ou escolher pelo Bluetooth do Chrome</Button>}
            </div>
          )}
          {etapa === 3 && met === 'rede' && (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='ip'>Endereço IP da impressora</Label>
              <div className='flex flex-wrap gap-2'>
                <Input id='ip' className='min-w-48 flex-1' placeholder='192.168.0.50' value={ip || e.config.conexao.host || ''} onChange={(ev) => setIp(ev.target.value)} />
                <Button disabled={!(ip || e.config.conexao.host)} onClick={() => chamar.mutate({ rota: '/api/config', corpo: { conexao: { tipo: 'rede', host: (ip || e.config.conexao.host || '').trim(), portaRede: 9100 } } })}>Usar este endereço</Button>
              </div>
            </div>
          )}
          {etapa === 3 && (
            <>
              <p className={cn('text-sm', e.config.conexao.tipo === met && e.fila.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                {e.config.conexao.tipo === met ? e.fila.texto : 'Ainda não está usando esta conexão'}
              </p>
              <ul className='divide-y rounded-lg border'>
                {diagnostico(e).filter((c) => c.chave.startsWith('driver')).map((c) => (
                  <li key={c.chave} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                    <div className='min-w-0 flex-1'><p className='text-sm font-medium'>{c.titulo} <span className='text-xs font-normal text-muted-foreground'>opcional</span></p><p className='text-xs text-muted-foreground'>{c.detalhe}</p></div>
                    {!c.ok && c.acao && <Button size='sm' variant='outline' onClick={() => chamar.mutate({ rota: c.acao!.rota, corpo: c.acao!.corpo })}>{c.acao.rotulo}</Button>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {etapa === 4 && (
            <div className='flex flex-col gap-3'>
              <Button className='self-start' onClick={() => chamar.mutate({ rota: '/api/teste', corpo: { tipo: 'regua' } }, { onSuccess: () => setTesteEnviado(true) })}>Imprimir teste</Button>
              {testeEnviado && (
                <div className='flex flex-wrap gap-2'>
                  <Button variant={testeOk ? 'default' : 'outline'} onClick={() => setTesteOk(true)}><Check aria-hidden='true' /> Saiu inteira</Button>
                  <Button variant='outline' onClick={() => { setTesteOk(false); chamar.mutate({ rota: '/api/teste', corpo: { tipo: 'detectar' } }); toast.info('Recalibrando o sensor de papel. Imprima o teste de novo.') }}>Não saiu ou saiu cortada</Button>
                </div>
              )}
            </div>
          )}

          {etapa === 5 && (
            <div className='flex flex-col gap-3'>
              <div className='flex flex-wrap gap-2'>
                <Button variant='outline' asChild><a href='https://www.mercadolivre.com.br/vendas/omni/lista' target='_blank' rel='noopener'><ExternalLink aria-hidden='true' /> Abrir Vendas</a></Button>
                <Button variant='outline' asChild><a href='https://www.mercadolivre.com.br/preferencias-de-venda' target='_blank' rel='noopener'><ExternalLink aria-hidden='true' /> Preferências de venda</a></Button>
              </div>
              <p className='text-sm text-muted-foreground'>Em Vendas, clique em Imprimir etiqueta uma vez: a ponte aparece como impressora Zebra.</p>
              <label htmlFor='sem-ml' className='flex items-center gap-2 text-sm'>
                <Checkbox id='sem-ml' checked={semMl} onCheckedChange={(v) => setSemMl(!!v)} /> Não vendo no Mercado Livre (pular esta etapa)
              </label>
            </div>
          )}
        </CardContent>
        <CardFooter className='flex flex-wrap items-center gap-2 border-t'>
          {etapa > 1 && <Button variant='ghost' onClick={() => setEtapa(etapa - 1)}>Voltar</Button>}
          <span className='ms-auto text-xs text-muted-foreground'>{pronta ? '' : FALTA[etapa]}</span>
          <Button variant='ghost' onClick={() => concluir.mutate()}>Fazer depois</Button>
          {etapa < 5
            ? <Button disabled={!pronta} onClick={() => { if (etapa === 1 && met) setMetodo(met); setEtapa(etapa + 1) }}>Continuar</Button>
            : <Button disabled={!pronta || concluir.isPending} onClick={() => concluir.mutate()}>Concluir</Button>}
        </CardFooter>
      </Card>
    </Pagina>
  )
}
