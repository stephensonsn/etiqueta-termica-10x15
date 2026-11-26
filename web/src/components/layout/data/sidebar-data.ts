import { Boxes, ClipboardCheck, House, Printer, Settings2, Store } from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  navGroups: [
    {
      title: 'Operação do dia',
      items: [
        { title: 'Início', url: '/', icon: House },
        { title: 'Fila de impressão', url: '/fila', icon: Printer },
        { title: 'Separação', url: '/separacao', icon: ClipboardCheck },
      ],
    },
    {
      title: 'Cadastros',
      items: [
        { title: 'Estoque', url: '/estoque', icon: Boxes },
        { title: 'Mercado Livre', url: '/mercado-livre', icon: Store },
      ],
    },
    {
      title: 'Sistema',
      items: [{ title: 'Impressora e ajustes', url: '/impressora', icon: Settings2 }],
    },
  ],
}
