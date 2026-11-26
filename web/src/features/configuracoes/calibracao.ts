// Limites da calibração: os mesmos de LIMITES em src/impressora.js (o servidor também confere).
export const CAMPOS_CALIB = [
  { chave: 'deslocXmm', rotulo: 'Deslocar para o lado', unidade: 'mm', passo: 0.5, ajuda: 'Positivo empurra para a direita' },
  { chave: 'deslocYmm', rotulo: 'Deslocar para baixo', unidade: 'mm', passo: 0.5, ajuda: 'Positivo empurra para baixo' },
  { chave: 'densidade', rotulo: 'Escuro da impressão', unidade: '', passo: 1, ajuda: 'O padrão é 6' },
  { chave: 'velocidade', rotulo: 'Velocidade', unidade: '', passo: 1, ajuda: 'Mais lento imprime mais nítido' },
] as const

export const CAMPOS_AVANCADOS = [
  { chave: 'gapMm', rotulo: 'Espaço entre etiquetas', unidade: 'mm', passo: 0.5, ajuda: 'Vão do rolo entre uma etiqueta e outra' },
  { chave: 'offsetMm', rotulo: 'Recuo depois de imprimir', unidade: 'mm', passo: 0.5, ajuda: 'Quanto o papel avança para destacar' },
] as const

export type ChaveCalib = (typeof CAMPOS_CALIB)[number]['chave'] | (typeof CAMPOS_AVANCADOS)[number]['chave']

// Devolve a mensagem de erro do campo, ou '' se estiver dentro do limite.
export function conferirCampo(valor: string, limite?: [number, number]) {
  if (valor.trim() === '') return 'Preencha um número'
  const n = Number(valor.replace(',', '.'))
  if (!Number.isFinite(n)) return 'Use só números (ex.: 1,5)'
  if (limite && (n < limite[0] || n > limite[1])) return `Entre ${String(limite[0]).replace('.', ',')} e ${String(limite[1]).replace('.', ',')}`
  return ''
}

export const paraNumero = (valor: string) => Number(valor.replace(',', '.'))
