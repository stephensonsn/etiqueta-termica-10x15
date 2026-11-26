import { createFileRoute } from '@tanstack/react-router'
import { Impressora } from '@/features/impressora'

export const Route = createFileRoute('/_authenticated/impressora/')({ component: Impressora })
