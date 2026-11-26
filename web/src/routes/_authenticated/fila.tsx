import { createFileRoute } from '@tanstack/react-router'
import { Fila } from '@/features/fila'

type Busca = { aba?: 'fila' | 'impressas' | 'descartadas' }

export const Route = createFileRoute('/_authenticated/fila')({
  validateSearch: (s: Record<string, unknown>): Busca =>
    ['fila', 'impressas', 'descartadas'].includes(String(s.aba)) ? { aba: s.aba as Busca['aba'] } : {},
  component: Fila,
})
