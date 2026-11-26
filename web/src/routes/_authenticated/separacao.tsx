import { createFileRoute } from '@tanstack/react-router'
import { Separacao } from '@/features/separacao'

export const Route = createFileRoute('/_authenticated/separacao')({ component: Separacao })
