// web/src/export/themes.ts
/** Slide themes as plain data — no pptxgenjs import here so the store can
 *  reference ThemeId cheaply. Colors copied from docs/test run/PPTgen.html. */

export type ThemeId = 'navy' | 'night' | 'forest' | 'slate'

export interface SlideTheme {
  sbg: string   // title/thank-you slide background
  acc: string   // accent
  stxt: string  // title-slide heading text
  ssub: string  // title-slide secondary text
  cbg: string   // content slide background
  tc: string    // content slide title color
  bc: string    // bullet color
  sec: string   // section-head color inside bullet groups
  ft: string    // footer text
  sf: string    // methodology step number square fill
  sx: string    // methodology step number text
  dt: string    // methodology detail text
}

export const THEMES: Record<ThemeId, SlideTheme> = {
  navy:   { sbg: '0A2342', acc: 'C9A227', stxt: 'FFFFFF', ssub: 'A0B4C8', cbg: 'FFFFFF', tc: '0A2342', bc: '1A2E4A', sec: '0A2342', ft: '94A3B8', sf: '0A2342', sx: 'FFFFFF', dt: '475569' },
  night:  { sbg: '1a1a2e', acc: 'e94560', stxt: 'FFFFFF', ssub: 'CCBBDD', cbg: 'FFFFFF', tc: '1a1a2e', bc: '2D2040', sec: '1a1a2e', ft: '94A3B8', sf: '1a1a2e', sx: 'FFFFFF', dt: '475569' },
  forest: { sbg: '1B4332', acc: '52B788', stxt: 'FFFFFF', ssub: 'AACCBB', cbg: 'FFFFFF', tc: '1B4332', bc: '2D6A4F', sec: '1B4332', ft: '94A3B8', sf: '1B4332', sx: 'FFFFFF', dt: '475569' },
  slate:  { sbg: '1e293b', acc: '38bdf8', stxt: 'FFFFFF', ssub: 'AABBCC', cbg: 'FFFFFF', tc: '1e293b', bc: '334155', sec: '1e293b', ft: '94A3B8', sf: '1e293b', sx: 'FFFFFF', dt: '475569' },
}

export const THEME_OPTIONS: { id: ThemeId; name: string; preview: { primary: string; accent: string } }[] = [
  { id: 'navy',   name: 'Navy & Gold',  preview: { primary: '#0A2342', accent: '#C9A227' } },
  { id: 'night',  name: 'Midnight Red', preview: { primary: '#1a1a2e', accent: '#e94560' } },
  { id: 'forest', name: 'Forest Green', preview: { primary: '#1B4332', accent: '#52B788' } },
  { id: 'slate',  name: 'Slate & Sky',  preview: { primary: '#1e293b', accent: '#38bdf8' } },
]
