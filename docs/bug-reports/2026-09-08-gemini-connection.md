# Bug report: Gemini calls fail with misleading "check your internet connection"

**Date:** 2026-09-08
**Severity:** High — blocks onboarding for affected users; message misleads troubleshooting
**Status:** Open

## Summary

On a machine where the browser can reach Google, `fypgen`'s server-side calls to the
Gemini API fail, and the UI shows the generic message
*"Could not reach gemini. Check your internet connection and try again."*
The real failure reason is captured by Node but **discarded by our error handling**,
so the user cannot distinguish a proxy problem from DNS, TLS interception, or an
actual connectivity problem.

## Environment

- fypgen @ `86deb85` (post dev-proxy fix — the request **does** reach the local server)
- Node v22.23.2 (bundled undici `fetch`)
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`

## Reproduction

1. `npm run dev:api` + `npm run dev`, open the app (or `node bin/fypgen.js` on the built app)
2. Onboarding → paste a Gemini API key → **Test key & start**
3. UI shows: `Could not reach gemini. Check your internet connection and try again.`

(The exact network condition that triggers it is machine-specific — see root cause.
Any condition where Node's `fetch` cannot complete the connection reproduces it.)

## Integration trace (where the error travels)

```
Onboarding.tsx:15  testKey()                      browser
  → api.ts:11      POST /api/test-key             via local server / vite proxy
  → routes.ts:24   provider.testKey(apiKey)       server
  → gemini.ts:12   fetch(generativelanguage…)     Node undici  ← FAILS HERE
  → routes.ts:26   catch → generic 502 message    err.cause DISCARDED
  → Onboarding     "check your internet connection"
```

## Root cause analysis

### Proximate bug — error classification destroys the diagnostic

Node's `fetch` (undici) throws `TypeError: fetch failed` for **every** network-level
failure, with the actual reason nested in `err.cause`. `server/routes.ts:26` catches
and maps any `TypeError` to the same generic connection hint. Measured on this
machine (`Node v22.23.2`):

| Condition                    | `err.name` | `err.message` | `err.cause.code`            |
| ---------------------------- | ---------- | ------------- | --------------------------- |
| Connect blocked / timeout    | TypeError  | fetch failed  | `UND_ERR_CONNECT_TIMEOUT`   |
| TLS connection reset         | TypeError  | fetch failed  | `ECONNRESET`                |
| DNS failure                  | TypeError  | fetch failed  | `ENOTFOUND`                 |
| MITM / bad certificate       | TypeError  | fetch failed  | `CERT_HAS_EXPIRED`, `SELF_SIGNED_CERT_IN_CHAIN`, … |

All four collapse into one message. The user is told to fix their internet when the
problem may be something else entirely.

### Why Node's fetch can fail while the browser works — candidates, by likelihood

1. **System proxy not honored (most likely).** undici's global `fetch` **ignores
   `HTTP_PROXY` / `HTTPS_PROXY` env vars and OS proxy settings by default**. If the
   machine reaches the internet only through a proxy (campus network, VPN, ISP
   transparent proxy — common in Nigeria), Chrome succeeds and fypgen's server-side
   fetch fails with `UND_ERR_CONNECT_TIMEOUT` / `ECONNRESET`.
2. **TLS interception.** Antivirus web-shields or firewalls that re-sign TLS
   connections produce certificate errors (`SELF_SIGNED_CERT_IN_CHAIN`,
   `UNABLE_TO_VERIFY_LEAF_SIGNATURE`). Browsers may trust the re-signed chain via
   the system/AV-installed root; Node's trust store check fails.
3. **Broken IPv6 path.** If the network advertises IPv6 but the route is dead,
   connections can time out during address attempts (`UND_ERR_CONNECT_TIMEOUT`,
   cause lists "attempted addresses").
4. **DNS.** `ENOTFOUND` — resolver works for the browser's cache but not for the
   Node process (uncommon, but distinct and currently indistinguishable).
5. **Genuine connectivity loss** — the only case the current message is correct for.

### Secondary findings in the Gemini integration

- **No explicit timeout** on `testKey` / `stream` fetches (`gemini.ts:12`, `gemini.ts:24`).
  undici defaults apply (10 s connect timeout, 300 s headers timeout); a stalled
  stream can hang for minutes with no feedback.
- `routes.ts:61` (`/api/generate`) has the same `TypeError` → generic-message mapping,
  so chapter generation hits the identical wall with the identical unhelpful message.
- Nothing logs the underlying `cause` server-side. (The cause contains no key
  material — only host/code/message — so surfacing it is safe under the
  "never log the key" constraint.)

## Impact

- Users on proxied/intercepted networks cannot onboard at all and are given a
  wrong instruction ("check your internet") that wastes their time.
- We cannot remotely diagnose which of the five failure classes a report belongs to.

## Recommended fix

1. **Surface the real cause.** In both route catches, read `err.cause.code` /
   `err.cause.message` and include it in the JSON error (e.g.
   `"Could not reach gemini (ECONNRESET: connection reset during TLS handshake)"`).
   Classify: `ENOTFOUND` → DNS hint; `CERT_*` → TLS/antivirus hint;
   `UND_ERR_CONNECT_TIMEOUT` / `ECONNRESET` → proxy-or-blocked hint.
2. **Support proxies** with `undici.EnvHttpProxyAgent` (or `ProxyAgent`) as the
   global dispatcher when `HTTPS_PROXY`/`HTTP_PROXY` is set — makes fypgen behave
   like the browser on proxied networks.
3. Add an AbortSignal timeout (e.g. 20 s) to `testKey`, and log `cause` server-side.

## Self-diagnosis for the affected machine (run now)

```bash
# 1. Does curl reach Google? (curl honors HTTP(S)_PROXY, Node fetch does not)
curl -s -o /dev/null -w "%{http_code}\n" https://generativelanguage.googleapis.com/v1beta

# 2. Does Node's fetch reach Google? (what fypgen actually does)
node -e "fetch('https://generativelanguage.googleapis.com/v1beta').then(r=>console.log('OK',r.status)).catch(e=>console.log('FAIL',e.cause?.code,e.cause?.message))"

# 3. Any proxy env vars set?
env | grep -i proxy
```

- curl OK + node FAIL → proxy or TLS-interception candidate (causes 1–2)
- both FAIL → genuine connectivity/DNS (causes 4–5)
- node prints `OK 404` → the endpoint is reachable; the problem is elsewhere
  (re-test with the API key path in the app and capture the new server-side log)
