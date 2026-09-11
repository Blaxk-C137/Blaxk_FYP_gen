// Discipline track archetypes — Layer 0 of the chapter-guardrails design
// (docs/superpowers/specs/2026-09-10-chapter-guardrails-design.md).
// Patterns derived from the real-project corpus in docs/Projects/.

export type TrackId = 'science-lab' | 'social-survey' | 'computing-engineering'

export interface Track {
  id: TrackId
  label: string
  chapterTitles: [string, string, string, string, string]
  chapter1Sections: string[]
  chapter2Sections: string[]
  chapter3Sections: string[]
  chapter4Sections: string[]
  chapter4Steering: string
  questionnaireAppendix: boolean
}

export const TRACKS: Record<TrackId, Track> = {
  'science-lab': {
    id: 'science-lab',
    label: 'Science (lab-based)',
    chapterTitles: [
      'INTRODUCTION',
      'LITERATURE REVIEW',
      'MATERIAL AND METHODS',
      'RESULTS AND ANALYSIS',
      'SUMMARY, CONCLUSION AND RECOMMENDATIONS',
    ],
    chapter1Sections: [
      'Background of the Study',
      'Statement of the Problem',
      'Aims and Objectives',
      'Significance of the Study',
      'Scope and Limitations',
    ],
    chapter2Sections: [
      'Conceptual Overview',
      'Theoretical Framework',
      'Empirical Review',
      'Summary of Literature Review',
    ],
    chapter3Sections: [
      'Materials',
      'Media and Reagent Preparation',
      'Sterilization',
      'Enumeration and Analyses',
      'Procedures',
    ],
    chapter4Sections: [
      'Presentation of Results',
      'Analysis of Results',
      'Discussion of Findings',
    ],
    chapter4Steering:
      'Present measured results as tables of values with standard deviations where applicable. ' +
      'Every empirical value (measurements, counts, percentages, yields) must be a visible placeholder ' +
      'such as [INSERT ACTUAL VALUE] for the student to fill from real experiments — never an invented number.',
    questionnaireAppendix: false,
  },
  'social-survey': {
    id: 'social-survey',
    label: 'Social science (survey-based)',
    chapterTitles: [
      'INTRODUCTION',
      'LITERATURE REVIEW',
      'RESEARCH METHODOLOGY',
      'DATA ANALYSIS AND RESULTS',
      'SUMMARY, CONCLUSION AND RECOMMENDATIONS',
    ],
    chapter1Sections: [
      'Background of the Study',
      'Statement of the Problem',
      'Objectives of the Study',
      'Research Questions',
      'Research Hypotheses',
      'Significance of the Study',
      'Scope and Limitations',
      'Definition of Terms',
    ],
    chapter2Sections: [
      'Conceptual Framework',
      'Theoretical Framework',
      'Empirical Review',
      'Summary of Literature Review',
    ],
    chapter3Sections: [
      'Research Design',
      'Population of the Study',
      'Sample Size and Sampling Technique',
      'Instrument for Data Collection',
      'Validity and Reliability of the Instrument',
      'Method of Data Collection',
      'Method of Data Analysis',
    ],
    chapter4Sections: [
      'Respondents’ Demographic Profile',
      'Data Analysis per Objective',
      'Test of Hypotheses',
      'Discussion of Findings',
    ],
    chapter4Steering:
      'Present analysis as frequency and percentage tables per objective, with a chart (bar or pie) for key distributions. ' +
      'Every empirical value (frequencies, percentages, N, statistical test results) must be a visible placeholder ' +
      'such as [INSERT ACTUAL N] or [INSERT ACTUAL %] for the student to fill from real data — never an invented number.',
    questionnaireAppendix: true,
  },
  'computing-engineering': {
    id: 'computing-engineering',
    label: 'Computing / Engineering',
    chapterTitles: [
      'INTRODUCTION',
      'LITERATURE REVIEW',
      'SYSTEM ANALYSIS AND DESIGN',
      'IMPLEMENTATION AND TESTING',
      'SUMMARY, CONCLUSION AND RECOMMENDATIONS',
    ],
    chapter1Sections: [
      'Background of the Study',
      'Statement of the Problem',
      'Aim and Objectives',
      'Significance of the Study',
      'Scope and Limitations',
    ],
    chapter2Sections: [
      'Conceptual Overview',
      'Review of Related Works',
      'Review of Enabling Technologies',
      'Summary of Literature Review',
    ],
    chapter3Sections: [
      'System Requirements',
      'System Architecture',
      'Design of the Proposed System',
      'Tools and Technologies',
      'Algorithms',
    ],
    chapter4Sections: [
      'System Implementation',
      'Testing and Test Results',
      'Discussion of Results',
    ],
    chapter4Steering:
      'Describe implementation and testing outcomes; illustrate architecture or data flow with diagrams (figure blocks). ' +
      'Every empirical value (accuracy, precision, recall, response times, test pass rates) must be a visible placeholder ' +
      'such as [INSERT ACTUAL ACCURACY] for the student to fill from real runs — never an invented metric.',
    questionnaireAppendix: false,
  },
}

// Two-level NUC course list. Track resolution: known course → its track,
// unknown course → keyword inference over the course string, else field default.
export interface CourseEntry { course: string; track: TrackId }
export type CourseCatalog = Record<string, CourseEntry[]> // field → courses

import { COURSE_CATALOG, FIELDS_OF_STUDY } from '../data/courses'

const KEYWORD_RULES: Array<[RegExp, TrackId]> = [
  [/engineer|comput|software|information technolog|cyber|robot|mechatronic|electrical|mechanical|computer/i, 'computing-engineering'],
  [/laborator|microbiolog|biochem|chemistr|physic|biolog|pharmac|physiolog|anatom|science lab/i, 'science-lab'],
  [/sociolog|psycholog|political|econom|mass comm|journalis|educat|law|administ|management|account|market|nursing|public health|social work|geograph|criminolog|anthropolog|linguistic|histor|philosoph|religio/i, 'social-survey'],
]

const FIELD_DEFAULTS: Record<string, TrackId> = {
  Agriculture: 'science-lab',
  Arts: 'social-survey',
  'Basic Medical Sciences': 'science-lab',
  Education: 'social-survey',
  'Engineering & Technology': 'computing-engineering',
  'Environmental Sciences': 'computing-engineering',
  Law: 'social-survey',
  'Management Sciences': 'social-survey',
  'Medicine & Health Sciences': 'science-lab',
  Pharmacy: 'science-lab',
  Sciences: 'science-lab',
  'Social Sciences': 'social-survey',
  'Veterinary Medicine': 'science-lab',
}

export function fieldsOfStudy(): readonly string[] {
  return FIELDS_OF_STUDY
}

export function coursesForField(field: string): CourseEntry[] {
  return COURSE_CATALOG[field] ?? []
}

/** Known course → its assigned track (deterministic); otherwise undefined. */
export function trackForCourse(course: string, field: string): TrackId {
  const normalized = course.trim().toLowerCase()
  const known = (COURSE_CATALOG[field] ?? []).find((c) => c.course.toLowerCase() === normalized)
  if (known) return known.track
  // Search across all fields too — course strings are fairly unique.
  for (const list of Object.values(COURSE_CATALOG)) {
    const hit = list.find((c) => c.course.toLowerCase() === normalized)
    if (hit) return hit.track
  }
  for (const [pattern, track] of KEYWORD_RULES) {
    if (pattern.test(course)) return track
  }
  return FIELD_DEFAULTS[field] ?? 'social-survey'
}

export function trackFor(id: TrackId | undefined, course: string | undefined, field: string | undefined): Track {
  if (id && TRACKS[id]) return TRACKS[id]
  return TRACKS[trackForCourse(course ?? '', field ?? '')]
}
