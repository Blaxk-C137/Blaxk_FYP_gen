/** Parses an SSE Response body; `extract` maps each data payload to text (or undefined to skip). */
export async function* parseSSE(
  response: Response,
  extract: (data: string) => string | undefined
): AsyncGenerator<string> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    // The SSE spec allows CRLF, LF, or CR line terminators; Google APIs emit
    // CRLF. Normalize to LF so events separate correctly regardless of provider.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      for (const line of event.split('\n')) {
        if (line.startsWith('data: ')) {
          const text = extract(line.slice(6))
          if (text !== undefined) yield text
        }
      }
    }
  }
}
