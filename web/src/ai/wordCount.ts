/** Word count used for length-budget checks — trims and splits on whitespace. */
export function wordCount(text: string): number {
  const t = text?.trim()
  return t ? t.split(/\s+/).length : 0
}
