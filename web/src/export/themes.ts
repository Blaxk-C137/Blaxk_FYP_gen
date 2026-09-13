/** Slide themes as plain data — no pptxgenjs import here so the store can
 *  reference ThemeId cheaply. Token structure and the forest colors are taken
 *  verbatim from the reference deck (docs/test run/…Defense_Slides.pptx). */

export type ThemeId = 'forest' | 'navy' | 'night' | 'slate'

export interface SlideTheme {
  tc: string        // content slide title + body text
  acc: string       // accent: lead-in labels, thick footer strip
  accLight: string  // thin footer strip
  muted: string     // secondary text on the title slide
  att: string       // attention red ([VERIFY] on references slides)
}

export const THEMES: Record<ThemeId, SlideTheme> = {
  forest: { tc: '2F3D32', acc: '548C2F', accLight: '9CC85D', muted: '637369', att: 'C00000' },
  navy:   { tc: '0A2342', acc: '1F6F8B', accLight: '9CC3D5', muted: '5A6B7F', att: 'C00000' },
  night:  { tc: '1a1a2e', acc: 'e94560', accLight: 'F2A0B0', muted: '637369', att: 'C00000' },
  slate:  { tc: '1e293b', acc: '0E7490', accLight: '9DD3E0', muted: '64748B', att: 'C00000' },
}

export const THEME_OPTIONS: { id: ThemeId; name: string; preview: { primary: string; accent: string } }[] = [
  { id: 'forest', name: 'Forest Green', preview: { primary: '#2F3D32', accent: '#548C2F' } },
  { id: 'navy',   name: 'Deep Navy',    preview: { primary: '#0A2342', accent: '#1F6F8B' } },
  { id: 'night',  name: 'Midnight Red', preview: { primary: '#1a1a2e', accent: '#e94560' } },
  { id: 'slate',  name: 'Slate & Teal', preview: { primary: '#1e293b', accent: '#0E7490' } },
]
