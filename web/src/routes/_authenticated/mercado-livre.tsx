import { createFileRoute } from '@tanstack/react-router'
import { TelaEmbutida } from '@/features/embutida'

export const Route = createFileRoute('/_authenticated/mercado-livre')({
  component: () => (
    <TelaEmbutida titulo='Mercado Livre' descricao='Anúncios ligados ao estoque e conta do Mercado Livre' endereco='/estoque#ml' />
  ),
})
