// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { puterAvailable, puterImage } from './puterImages'

function imgWithData(src: string): HTMLImageElement {
  const img = document.createElement('img')
  img.src = src
  return img
}

afterEach(() => {
  delete (window as { puter?: unknown }).puter
})

describe('puterImages', () => {
  it('is unavailable (and returns null) when the Puter script is not loaded', async () => {
    expect(puterAvailable()).toBe(false)
    expect(await puterImage('a chart')).toBeNull()
  })

  it('returns the raw base64 from a data-URI image element', async () => {
    ;(window as { puter?: unknown }).puter = {
      ai: { txt2img: async () => imgWithData('data:image/png;base64,aGVsbG8=') },
    }
    expect(await puterImage('a diagram')).toBe('aGVsbG8=')
  })

  it('accepts any result object exposing a .src data URI', async () => {
    ;(window as { puter?: unknown }).puter = {
      ai: { txt2img: async () => ({ src: 'data:image/jpeg;base64,anRoZWc=' }) },
    }
    expect(await puterImage('x')).toBe('anRoZWc=')
  })

  it('returns null when txt2img rejects (cancelled sign-in, quota, error)', async () => {
    ;(window as { puter?: unknown }).puter = {
      ai: { txt2img: async () => { throw new Error('user cancelled') } },
    }
    expect(await puterImage('x')).toBeNull()
  })

  it('returns null for a result it cannot normalize', async () => {
    ;(window as { puter?: unknown }).puter = {
      ai: { txt2img: async () => ({ nope: true }) },
    }
    expect(await puterImage('x')).toBeNull()
  })

  it('returns null when the returned image never loads (blob URL jsdom cannot decode)', async () => {
    vi.useFakeTimers()
    try {
      ;(window as { puter?: unknown }).puter = {
        ai: { txt2img: async () => imgWithData('blob:https://api.puter.com/xyz') },
      }
      const pending = expect(puterImage('x')).resolves.toBeNull()
      await vi.advanceTimersByTimeAsync(10_000) // trip the load timeout
      await pending
    } finally {
      vi.useRealTimers()
    }
  })
})
