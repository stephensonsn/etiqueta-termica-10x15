import { createFileRoute } from '@tanstack/react-router'
import { ConfigurarImpressora } from '@/features/impressora/configurar'

export const Route = createFileRoute('/_authenticated/impressora/configurar')({ component: ConfigurarImpressora })
