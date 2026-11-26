import { describe, expect, it } from 'vitest'
import { conferirCampo, paraNumero } from './calibracao'

describe('Calibração: limites', () => {
  it('aceita vírgula e confere o limite', () => {
    expect(conferirCampo('1,5', [-20, 20])).toBe('')
    expect(paraNumero('1,5')).toBe(1.5)
    expect(conferirCampo('25', [-20, 20])).toBe('Entre -20 e 20')
    expect(conferirCampo('abc', [0, 15])).toBe('Use só números (ex.: 1,5)')
    expect(conferirCampo('', [0, 15])).toBe('Preencha um número')
  })
})
