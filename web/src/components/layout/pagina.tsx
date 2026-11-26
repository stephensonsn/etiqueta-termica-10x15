import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

type PaginaProps = {
  titulo: string
  descricao?: string
  acoes?: React.ReactNode
  fixa?: boolean
  children: React.ReactNode
}

// Moldura comum: barra do topo (menu, busca ⌘K, tema) + título, descrição e ações da tela.
export function Pagina({ titulo, descricao, acoes, fixa, children }: PaginaProps) {
  return (
    <>
      <Header fixed>
        <Search placeholder='Ir para…' />
        <div className='ms-auto flex items-center gap-2'>
          <ThemeSwitch />
        </div>
      </Header>
      <Main fixed={fixa} className='flex flex-col gap-5'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div className='min-w-0'>
            <h1 className='text-2xl font-semibold tracking-tight'>{titulo}</h1>
            {descricao && <p className='text-sm text-muted-foreground'>{descricao}</p>}
          </div>
          {acoes && <div className='flex flex-wrap items-center gap-2'>{acoes}</div>}
        </div>
        {children}
      </Main>
    </>
  )
}
