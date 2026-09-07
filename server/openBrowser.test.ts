import { describe, it, expect } from 'vitest'
import { commandFor } from './openBrowser.js'

describe('openBrowser', () => {
  it('uses xdg-open on linux', () => {
    expect(commandFor('linux')).toEqual(['xdg-open'])
  })
  it('uses open on darwin', () => {
    expect(commandFor('darwin')).toEqual(['open'])
  })
  it('uses cmd /c start on win32', () => {
    expect(commandFor('win32')).toEqual(['cmd', '/c', 'start', ''])
  })
})
