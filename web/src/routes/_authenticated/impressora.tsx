import { createFileRoute } from '@tanstack/react-router'
import { TelaEmbutida } from '@/features/embutida'

export const Route = createFileRoute('/_authenticated/impressora')({
  component: () => (
    <TelaEmbutida titulo='Impressora e ajustes' descricao='Conexão, calibração, impressão automática e histórico' endereco='/painel' />
  ),
})
