import { Link } from '@tanstack/react-router'
import { Printer } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEstado } from '@/lib/ponte'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'

// Rodapé do menu: a impressora está pronta? Texto sempre junto da cor.
export function SituacaoImpressora() {
  const { data, isError } = useEstado()
  const ok = !isError && data?.fila.ok
  const texto = isError ? 'Ponte fora do ar' : data?.fila.texto || 'Consultando…'
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size='lg' asChild tooltip={texto}>
          <Link to='/impressora'>
            <div className={cn('relative flex aspect-square size-8 items-center justify-center rounded-lg border',
              ok ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400' : 'border-destructive/30 bg-destructive/10 text-destructive')}>
              <Printer className='size-4' aria-hidden='true' />
            </div>
            <div className='grid flex-1 text-start text-sm leading-tight'>
              <span className='truncate font-medium'>{ok ? 'Impressora pronta' : 'Impressora com problema'}</span>
              <span className='truncate text-xs text-muted-foreground'>{texto}</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
