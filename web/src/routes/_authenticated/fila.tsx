import { createFileRoute } from '@tanstack/react-router'
import { type Aba } from '@/features/fila/agrupar'
import { Fila } from '@/features/fila'

const ABAS: Aba[] = ['fila', 'falhas', 'impressas', 'descartadas']

export const Route = createFileRoute('/_authenticated/fila')({
  validateSearch: (s: Record<string, unknown>): { aba?: Aba } => (ABAS.includes(s.aba as Aba) ? { aba: s.aba as Aba } : {}),
  component: Fila,
})
