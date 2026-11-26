import { createFileRoute } from '@tanstack/react-router'
import { TelaEmbutida } from '@/features/embutida'

export const Route = createFileRoute('/_authenticated/estoque')({
  component: () => (
    <TelaEmbutida titulo='Estoque' descricao='Etiquetas de produto, loja e leitor de código de barras' endereco='/estoque' />
  ),
})
