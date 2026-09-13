/** Post-processes the packed DOCX: injects cached result paragraphs into the
 *  TOC field (between its separate and end markers), the way Word caches a
 *  TOC. Viewers that never update fields (LibreOffice, Google Docs, previews)
 *  then show a real TOC; Word still refreshes to exact numbers on open. */
import JSZip from 'jszip'
import type { TocEntry } from './tocPages'

// jsdom's Blob lacks arrayBuffer(); read bytes through FileReader there.
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as ArrayBuffer)
    fr.onerror = () => reject(fr.error)
    fr.readAsArrayBuffer(blob)
  })
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function tocParagraphXml(e: TocEntry): string {
  return (
    `<w:p><w:pPr>` +
    (e.level === 2 ? `<w:ind w:left="240"/>` : '') +
    `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/></w:tabs>` +
    `<w:spacing w:line="360" w:lineRule="auto"/>` +
    `</w:pPr>` +
    `<w:r><w:t xml:space="preserve">${esc(e.text)}</w:t></w:r>` +
    `<w:r><w:tab/></w:r>` +
    `<w:r><w:t>${e.page}</w:t></w:r>` +
    `</w:p>`
  )
}

export async function injectTocCache(blob: Blob, entries: TocEntry[]): Promise<Blob> {
  if (!entries.length) return blob
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob))
  const file = zip.file('word/document.xml')
  if (!file) return blob
  const doc = await file.async('string')
  const injected = entries.map(tocParagraphXml).join('')
  // Inject between the begin-paragraph (which closes right after the separate
  // fldChar) and the end-paragraph — cached entries must be sibling <w:p>
  // elements inside sdtContent, never nested inside the begin run's <w:r>.
  // Function replacer: entry text may contain '$' sequences that a string
  // replacement would otherwise interpret as capture-group references.
  const patched = doc.replace(
    /(<w:fldChar w:fldCharType="separate"[^/]*\/>[\s\S]*?<\/w:p>)(<w:p><w:r><w:fldChar w:fldCharType="end"\/>)/,
    (_m, beginParagraph: string, endParagraph: string) => `${beginParagraph}${injected}${endParagraph}`
  )
  if (patched === doc) return blob // no TOC field found — leave untouched
  zip.file('word/document.xml', patched)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}
