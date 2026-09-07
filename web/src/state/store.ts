import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProviderId } from '@shared/constants'

export interface Settings { provider: ProviderId; apiKey: string; model?: string }
export interface ProjectInfo {
  topic: string; studentName: string; matric: string; university: string
  department: string; supervisor: string; degree: string; session: string
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
  setSettings: (s: Settings) => void
  setProject: (p: Partial<ProjectInfo>) => void
  setOutline: (chapters: Chapter[], abstract: string) => void
  updateChapter: (number: number, patch: Partial<Chapter>) => void
  appendChapterText: (number: number, chunk: string) => void
  reset: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      settings: { provider: 'gemini', apiKey: '' },
      project: EMPTY_PROJECT,
      chapters: initialChapterState(),
      abstract: '',
      setSettings: (s) => set({ settings: s }),
      setProject: (p) => set((st) => ({ project: { ...st.project, ...p } })),
      setOutline: (chapters, abstract) => set({ chapters, abstract }),
      updateChapter: (number, patch) =>
        set((st) => ({
          chapters: st.chapters.map((c) => (c.number === number ? { ...c, ...patch } : c)),
        })),
      appendChapterText: (number, chunk) =>
        set((st) => ({
          chapters: st.chapters.map((c) => (c.number === number ? { ...c, text: c.text + chunk } : c)),
        })),
      reset: () =>
        set({ project: EMPTY_PROJECT, chapters: initialChapterState(), abstract: '' }),
    }),
    { name: 'fypgen-state' }
  )
)

export const useSettings = () => useAppStore((s) => s.settings)
export const useProject = () => useAppStore((s) => s.project)
export const useChapters = () => useAppStore((s) => s.chapters)
export const useAbstract = () => useAppStore((s) => s.abstract)
