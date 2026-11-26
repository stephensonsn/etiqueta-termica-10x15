// Formatos brasileiros usados em todas as telas.
const fuso = 'America/Sao_Paulo'

export const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: fuso })

export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: fuso })

export const diaIso = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: fuso })

export const ehHoje = (iso: string) => diaIso(new Date(iso)) === diaIso()

export const numero = (n: number) => n.toLocaleString('pt-BR')

export const plural = (n: number, um: string, varios: string) => `${numero(n)} ${n === 1 ? um : varios}`
