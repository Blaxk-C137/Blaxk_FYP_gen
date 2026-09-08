import { describe, it, expect, afterEach } from 'vitest'
import { getGlobalDispatcher } from 'undici'

import { describeNetworkError, configureNetworking } from './net.js'

function errWithCause(code: string, message: string): TypeError {
  const e = new TypeError('fetch failed') as TypeError & { cause?: { code: string; message: string } }
  e.cause = { code, message }
  return e
}

describe('describeNetworkError', () => {
  it('classifies DNS failures', () => {
    const { hint } = describeNetworkError(errWithCause('ENOTFOUND', 'getaddrinfo ENOTFOUND generativelanguage.googleapis.com'))
    expect(hint).toMatch(/DNS/i)
  })

  it('classifies TLS certificate failures as possible antivirus/firewall interception', () => {
    for (const code of ['CERT_HAS_EXPIRED', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']) {
      const { hint } = describeNetworkError(errWithCause(code, 'certificate'))
      expect(hint).toMatch(/certificate|antivirus|firewall/i)
    }
  })

  it('classifies connect timeouts and resets as proxy-or-blocked', () => {
    for (const code of ['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT']) {
      const { hint } = describeNetworkError(errWithCause(code, 'Connect Timeout'))
      expect(hint).toMatch(/proxy|VPN|blocked|timed? ?out/i)
    }
  })

  it('falls back to the generic internet hint when there is no cause', () => {
    const { hint, detail } = describeNetworkError(new TypeError('fetch failed'))
    expect(hint).toMatch(/internet connection/i)
    expect(detail).toBe('')
  })

  it('includes the underlying code and message as detail', () => {
    const { detail } = describeNetworkError(errWithCause('ENOTFOUND', 'getaddrinfo failed'))
    expect(detail).toContain('ENOTFOUND')
    expect(detail).toContain('getaddrinfo failed')
  })
})

describe('configureNetworking', () => {
  const hadProxy = 'HTTPS_PROXY' in process.env
  const original = process.env.HTTPS_PROXY

  afterEach(() => {
    if (hadProxy) process.env.HTTPS_PROXY = original
    else delete process.env.HTTPS_PROXY
    configureNetworking() // restore non-proxy dispatcher when env is clear
  })

  it('installs a proxy dispatcher when HTTPS_PROXY is set', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.example:8080'
    configureNetworking()
    const { EnvHttpProxyAgent } = await import('undici')
    expect(getGlobalDispatcher()).toBeInstanceOf(EnvHttpProxyAgent)
  })
})
