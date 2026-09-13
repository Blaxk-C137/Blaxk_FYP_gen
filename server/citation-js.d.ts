/**
 * Minimal ambient declaration for `citation-js` (v0.8), which ships no
 * TypeScript types and has no @types package. Its CommonJS entry assigns
 * the `Cite` class to `module.exports`, so ESM code must default-import it
 * (`import Cite from 'citation-js'`).
 */
declare module 'citation-js' {
  export default class Cite {
    constructor(data: unknown, options?: unknown)
    format(type: string, options?: { format?: string; template?: string }): string
  }
}
