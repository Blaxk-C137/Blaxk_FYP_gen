import { createServer } from 'node:net'

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.once('error', reject)
    srv.listen(0, () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') resolve(addr.port)
      else reject(new Error('no port'))
      srv.close()
    })
  })
}
