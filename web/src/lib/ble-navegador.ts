// Bluetooth 4.0 direto pelo Chrome (Web Bluetooth): reserva do conector nativo do Mac.
// Mesmo protocolo do painel antigo: busca o trabalho em /api/ble/proximo, escreve em pedaços
// na característica gravável da impressora e confirma em /api/ble/feito. Roda no layout do app,
// então funciona em qualquer tela aberta (não precisa do painel antigo).
import { useEffect, useSyncExternalStore } from 'react'
import { api } from './ponte'

const SERVICOS = [0xff00, 0xfff0, 0xffe0, 0xae30, 0xae00, 0x18f0, 0xfee7,
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '0000ffe5-0000-1000-8000-00805f9b34fb']

/* eslint-disable @typescript-eslint/no-explicit-any -- Web Bluetooth não tem tipos no TS padrão */
type Caracteristica = any
let car: Caracteristica = null
let ocupado = false
let estado = { conectada: false, nome: '', texto: '' }
const ouvintes = new Set<() => void>()
const mudar = (p: Partial<typeof estado>) => { estado = { ...estado, ...p }; ouvintes.forEach((f) => f()) }

export const temWebBluetooth = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator

async function conectar(dispositivo: any) {
  mudar({ texto: `Conectando em ${dispositivo.name || 'impressora'}…` })
  const gatt = await dispositivo.gatt.connect()
  let achada: Caracteristica = null
  for (const srv of await gatt.getPrimaryServices()) {
    for (const c of await srv.getCharacteristics()) {
      if (c.properties.writeWithoutResponse || c.properties.write) { if (!achada || c.properties.writeWithoutResponse) achada = c }
    }
    if (achada) break
  }
  if (!achada) throw new Error('a impressora não mostrou um canal de escrita por Bluetooth')
  car = achada
  dispositivo.addEventListener('gattserverdisconnected', () => { car = null; mudar({ conectada: false, texto: 'Desconectada. Clique em Escolher impressora' }) })
  mudar({ conectada: true, nome: dispositivo.name || 'impressora', texto: `Conectada pelo Chrome: ${dispositivo.name || 'impressora'}` })
}

// Abre a janela do Chrome para escolher a impressora (precisa de um clique da pessoa).
export async function escolherImpressora() {
  if (!temWebBluetooth()) throw new Error('Este navegador não tem Bluetooth. Use o Google Chrome')
  try {
    const nav = navigator as any
    await conectar(await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICOS }))
    await api('/api/config', { conexao: { tipo: 'ble', bleNome: estado.nome } })
  } catch (e) {
    const err = e as Error
    mudar({ texto: err.name === 'NotFoundError' ? 'Nenhuma impressora escolhida' : `Não conectou: ${err.message}` })
    if (err.name !== 'NotFoundError') throw err
  }
}

async function enviar(bytes: Uint8Array) {
  const comResposta = !car.properties.writeWithoutResponse
  const TAM = comResposta ? 180 : 120
  for (let i = 0; i < bytes.length; i += TAM) {
    const parte = bytes.subarray(i, i + TAM)
    if (comResposta) await car.writeValueWithResponse(parte)
    else { await car.writeValueWithoutResponse(parte); if ((i / TAM) % 8 === 7) await new Promise((r) => setTimeout(r, 25)) }
    if ((i / TAM) % 40 === 0) mudar({ texto: `Enviando etiqueta: ${Math.round((i / bytes.length) * 100)}%` })
  }
}

// Laço: só trabalha com a conexão "ble" escolhida e a impressora ligada ao Chrome.
// conectorNativo: o conector-bluetooth do Mac já fala com a impressora; aí o Chrome não religa
// sozinho (os dois disputariam a mesma impressora). Só liga quando a pessoa escolhe na tela.
export function useBleNavegador(tipoConexao?: string, conectorNativo?: boolean) {
  useEffect(() => {
    if (!temWebBluetooth() || conectorNativo !== false) return
    const nav = navigator as any
    // ao abrir o app, volta à impressora já autorizada antes
    if (!car && nav.bluetooth.getDevices) {
      nav.bluetooth.getDevices().then(async (lista: any[]) => {
        for (const d of lista) { try { await conectar(d); break } catch { mudar({ texto: 'Clique em Escolher impressora para religar' }) } }
      }).catch(() => {})
    }
  }, [conectorNativo])
  useEffect(() => {
    if (tipoConexao !== 'ble') return
    const id = setInterval(async () => {
      if (!car || ocupado) return
      ocupado = true
      try {
        const t = await api<{ id?: number; dados?: string }>('/api/ble/proximo')
        if (t.id && t.dados) {
          try {
            await enviar(Uint8Array.from(atob(t.dados), (ch) => ch.charCodeAt(0)))
            await api('/api/ble/feito', { id: t.id, ok: true })
            mudar({ texto: 'Etiqueta enviada pelo Chrome' })
          } catch (e) {
            await api('/api/ble/feito', { id: t.id, ok: false, erro: (e as Error).message })
            mudar({ texto: `Falhou ao enviar: ${(e as Error).message}` })
          }
        }
      } catch { /* ponte fora do ar: o aviso geral já aparece */ }
      ocupado = false
    }, 1000)
    return () => clearInterval(id)
  }, [tipoConexao])
}

export const useEstadoBle = () => useSyncExternalStore((f) => { ouvintes.add(f); return () => ouvintes.delete(f) }, () => estado)
