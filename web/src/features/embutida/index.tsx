import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Pagina } from '@/components/layout/pagina'

// Telas que ainda são as páginas originais da ponte, abertas dentro do app até virarem React.
export function TelaEmbutida({ titulo, descricao, endereco }: { titulo: string; descricao: string; endereco: string }) {
  // repassa ?ml=... e #sec-ml (volta do login do Mercado Livre) para a página original
  const src = endereco.includes('#') ? endereco : endereco + window.location.search + window.location.hash
  return (
    <Pagina
      titulo={titulo}
      descricao={descricao}
      fixa
      acoes={
        <Button variant='outline' size='sm' asChild>
          <a href={endereco} target='_blank' rel='noopener'>
            <ExternalLink aria-hidden='true' /> Abrir em outra aba
          </a>
        </Button>
      }
    >
      <iframe
        title={titulo}
        src={src}
        className='min-h-[70svh] w-full flex-1 rounded-xl border bg-background'
      />
    </Pagina>
  )
}
