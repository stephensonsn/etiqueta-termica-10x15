import { createFileRoute } from '@tanstack/react-router'
import { Configuracoes, type Secao } from '@/features/configuracoes'

const SECOES: Secao[] = ['impressao', 'calibracao', 'historico', 'mercado-livre']

export const Route = createFileRoute('/_authenticated/configuracoes')({
  validateSearch: (s: Record<string, unknown>): { secao?: Secao; ml?: string } => ({
    ...(SECOES.includes(s.secao as Secao) ? { secao: s.secao as Secao } : {}),
    ...(typeof s.ml === 'string' ? { ml: s.ml } : {}),
  }),
  component: Configuracoes,
})
