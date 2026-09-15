import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProviderId } from '@shared/constants'
import type { TrackId } from '../ai/tracks'
import type { ThemeId } from '../export/themes'

export interface Settings { provider: ProviderId; apiKey: string; model?: string }
export type LengthPreset = 'compact' | 'standard' | 'detailed'
export interface ProjectInfo {
  topic: string; studentName: string; matric: string; university: string
  department: string; supervisor: string; degree: string; session: string
  fieldOfStudy?: string; courseOfStudy?: string; track?: TrackId
  lengthPreset?: LengthPreset
  /** Data-URL of a manually uploaded university logo; wins over the scrape. */
  logoDataUrl?: string
}
export interface Section { heading: string; description: string }
export type ChapterStatus = 'pending' | 'streaming' | 'done'
export interface Chapter {
  number: number; title: string; sections: Section[]
  status: ChapterStatus; text: string
}

export const EMPTY_PROJECT: ProjectInfo = {
  topic: '', studentName: '', matric: '', university: '',
  department: '', supervisor: '', degree: '', session: '',
}

export interface ReferenceEntry { key: string; apa: string; verified: boolean; doi?: string }

/** One real, Crossref-sourced work the model may cite. The pool is fetched
 *  before generation; chapters cite only from it. */
export interface PoolEntry {
  key: string          // "(Author, 2020)" citation key exactly as cited
  authors: string      // "Family, F. & Family, F."
  year: string
  title: string
  container?: string
  apa: string          // fully formatted APA line
  doi?: string
}

export const STANDARD_CHAPTERS = [
  'INTRODUCTION', 'LITERATURE REVIEW', 'METHODOLOGY',
  'RESULTS AND ANALYSIS', 'CONCLUSION AND RECOMMENDATIONS',
]

export function initialChapterState(): Chapter[] {
  return STANDARD_CHAPTERS.map((title, i) => ({
    number: i + 1, title, sections: [], status: 'pending' as ChapterStatus, text: '',
  }))
}

interface AppState {
  settings: Settings
  project: ProjectInfo
  chapters: Chapter[]
  abstract: string
  references: ReferenceEntry[]
  referencePool: PoolEntry[]
  poolLoaded: boolean
  slideTheme: ThemeId
  setSettings: (s: Settings) => void
  setProject: (p: Partial<ProjectInfo>) => void
  setOutline: (chapters: Chapter[], abstract: string) => void
  setChapters: (chapters: Chapter[]) => void
  updateChapter: (number: number, patch: Partial<Chapter>) => void
  appendChapterText: (number: number, chunk: string) => void
  setReferences: (refs: ReferenceEntry[]) => void
  setReferencePool: (pool: PoolEntry[]) => void
  setSlideTheme: (t: ThemeId) => void
  reset: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      settings: { provider: 'gemini', apiKey: '' },
      project: EMPTY_PROJECT,
      chapters: initialChapterState(),
      abstract: '',
      references: [],
      referencePool: [],
      poolLoaded: false,
      slideTheme: 'forest',
      setSettings: (s) => set({ settings: s }),
      setProject: (p) => set((st) => ({ project: { ...st.project, ...p } })),
      setOutline: (chapters, abstract) => set({ chapters, abstract }),
      setChapters: (chapters) => set({ chapters }),
      updateChapter: (number, patch) =>
        set((st) => ({
          chapters: st.chapters.map((c) => (c.number === number ? { ...c, ...patch } : c)),
        })),
      appendChapterText: (number, chunk) =>
        set((st) => ({
          chapters: st.chapters.map((c) => (c.number === number ? { ...c, text: c.text + chunk } : c)),
        })),
      setReferences: (refs) => set({ references: refs }),
      setReferencePool: (pool) => set({ referencePool: pool, poolLoaded: true }),
      setSlideTheme: (t) => set({ slideTheme: t }),
      reset: () =>
        set({
          project: EMPTY_PROJECT, chapters: initialChapterState(), abstract: '',
          references: [], referencePool: [], poolLoaded: false,
        }),
    }),
    {
      name: 'fypgen-state',
      version: 2,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Record<string, unknown>
        return {
          ...state,
          references: Array.isArray(state.references)
            ? (state.references as unknown[]).map((r) =>
                typeof r === 'string' ? { key: '', apa: r, verified: false } : r)
            : [],
        }
      },
    }
  )
)

export const useSettings = () => useAppStore((s) => s.settings)
export const useProject = () => useAppStore((s) => s.project)
export const useChapters = () => useAppStore((s) => s.chapters)
export const useAbstract = () => useAppStore((s) => s.abstract)
