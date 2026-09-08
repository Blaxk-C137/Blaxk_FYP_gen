import { Agent, EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

export interface NetworkFailure {
  hint: string
  detail: string
}

/**
 * Turn a Node `fetch` network failure (`TypeError: fetch failed`) into a
 * user-facing hint. Node hides the real reason in `err.cause`; without it every
 * failure looks identical. The cause contains no key material — only host,
 * code, and message — so it is safe to surface and log.
 */
export function describeNetworkError(err: unknown): NetworkFailure {
  const cause = (err as { cause?: { code?: string; message?: string } } | null)?.cause
  const code = cause?.code ?? ''
  const detail = cause?.message ? ` (${code}: ${cause.message})` : ''
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return { hint: 'could not resolve the provider host name — this looks like a DNS problem, not an API key problem', detail }
  if (/CERT|SSL|TLS/.test(code) || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
    return { hint: 'the TLS certificate was rejected — an antivirus or firewall may be intercepting the connection', detail }
  if (['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET'].includes(code))
    return {
      hint: 'the connection timed out or was blocked — your network or ISP may be blocking this provider. If you use a proxy or VPN, set the HTTPS_PROXY environment variable and restart fypgen; otherwise try a different network or another provider',
      detail,
    }
  return { hint: 'check your internet connection and try again', detail }
}

/** True when an error carries a classified network cause (vs a plain provider error). */
export function hasNetworkCause(err: unknown): boolean {
  return !!(err as { cause?: { code?: string } } | null)?.cause?.code
}

/** Log the underlying cause server-side for diagnosis. Safe: no key material. */
export function logNetworkError(route: string, providerId: string, err: unknown): void {
  const cause = (err as { cause?: unknown } | null)?.cause
  console.error(`[fypgen] ${route}: could not reach ${providerId}`, cause ?? err)
}

let proxyAgent: EnvHttpProxyAgent | null = null

/**
 * Node's global `fetch` (undici) ignores HTTP_PROXY/HTTPS_PROXY by default, so
 * on proxied networks the browser works while fypgen's server calls fail.
 * When a proxy env var is set, route all fetches through it — same behaviour
 * as the browser. Idempotent.
 */
export function configureNetworking(): void {
  const proxy =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  if (proxy) {
    if (!proxyAgent) {
      proxyAgent = new EnvHttpProxyAgent()
      setGlobalDispatcher(proxyAgent)
      console.log('[fypgen] using proxy from HTTPS_PROXY/HTTP_PROXY for AI provider requests')
    }
    return
  }
  if (proxyAgent) {
    proxyAgent = null
    setGlobalDispatcher(new Agent())
  }
}
