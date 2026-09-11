import { describe, it, expect } from 'vitest'
import {
  TRACKS,
  trackForCourse,
  trackFor,
  fieldsOfStudy,
  coursesForField,
} from './tracks'
import { COURSE_CATALOG, FIELDS_OF_STUDY } from '../data/courses'
import type { TrackId } from './tracks'

const VALID_TRACKS: TrackId[] = ['science-lab', 'social-survey', 'computing-engineering']

describe('trackForCourse', () => {
  it('maps known courses deterministically', () => {
    expect(trackForCourse('Mechatronics Engineering', 'Engineering & Technology')).toBe('computing-engineering')
    expect(trackForCourse('Psychology', 'Social Sciences')).toBe('social-survey')
    expect(trackForCourse('Medical Laboratory Science', 'Basic Medical Sciences')).toBe('science-lab')
    expect(trackForCourse('Mass Communication', 'Social Sciences')).toBe('social-survey')
  })

  it('resolves each corpus department correctly', () => {
    // docs/Projects corpus: Microbiology, Sociology, Public Health
    expect(trackForCourse('Microbiology', 'Sciences')).toBe('science-lab')
    expect(trackForCourse('Sociology', 'Social Sciences')).toBe('social-survey')
    expect(trackForCourse('Public Health', 'Medicine & Health Sciences')).toBe('social-survey')
  })

  it('is case-insensitive over known courses', () => {
    expect(trackForCourse('psychology', 'Social Sciences')).toBe('social-survey')
    expect(trackForCourse('MECHATRONICS ENGINEERING', 'Engineering & Technology')).toBe('computing-engineering')
  })

  it('falls back to keyword inference for unknown courses', () => {
    expect(trackForCourse('Marine Engineering Technology', 'Engineering & Technology')).toBe('computing-engineering')
    expect(trackForCourse('Petroleum Chemistry', 'Sciences')).toBe('science-lab')
    expect(trackForCourse('Criminology and Security Studies', 'Social Sciences')).toBe('social-survey')
  })

  it('falls back to the field default when no keyword matches', () => {
    expect(trackForCourse('Something Novel', 'Engineering & Technology')).toBe('computing-engineering')
    expect(trackForCourse('Something Novel', 'Sciences')).toBe('science-lab')
    expect(trackForCourse('Something Novel', 'Arts')).toBe('social-survey')
    expect(trackForCourse('Something Novel', '')).toBe('social-survey') // global default
  })

  it('an explicit track in the store overrides course and field', () => {
    // A Sociology student doing a computational project can force computing-engineering
    expect(trackFor('computing-engineering', 'Sociology', 'Social Sciences').id).toBe('computing-engineering')
    expect(trackFor('science-lab', 'Psychology', 'Social Sciences').id).toBe('science-lab')
  })

  it('resolves from course+field when no explicit track is stored', () => {
    expect(trackFor(undefined, 'Microbiology', 'Sciences').id).toBe('science-lab')
    expect(trackFor(undefined, undefined, 'Engineering & Technology').id).toBe('computing-engineering')
  })
})

describe('course catalog integrity', () => {
  it('every course has a valid track and sits under a known field', () => {
    for (const [field, courses] of Object.entries(COURSE_CATALOG)) {
      expect(FIELDS_OF_STUDY).toContain(field)
      expect(courses.length).toBeGreaterThan(0)
      for (const { course, track } of courses) {
        expect(course.trim()).toBe(course)
        expect(course.length).toBeGreaterThan(0)
        expect(VALID_TRACKS).toContain(track)
      }
    }
  })

  it('fieldsOfStudy lists all NUC fields present in the catalog', () => {
    expect(fieldsOfStudy()).toEqual([...FIELDS_OF_STUDY])
    for (const field of FIELDS_OF_STUDY) {
      expect(coursesForField(field).length).toBeGreaterThan(0)
    }
  })
})

describe('tracks', () => {
  it('every track has non-empty section skeletons', () => {
    for (const track of Object.values(TRACKS)) {
      expect(track.label).toBeTruthy()
      expect(track.chapterTitles).toHaveLength(5)
      for (const key of [
        'chapter1Sections',
        'chapter2Sections',
        'chapter3Sections',
        'chapter4Sections',
      ] as const) {
        expect(track[key].length).toBeGreaterThan(0)
      }
      expect(track.chapter4Steering).toBeTruthy()
    }
  })

  it('chapter titles follow corpus conventions', () => {
    for (const track of Object.values(TRACKS)) {
      // Chapter 1 is always the introduction; Chapter 5 always summarizes/concludes
      expect(track.chapterTitles[0]).toBe('INTRODUCTION')
      expect(track.chapterTitles[4]).toMatch(/SUMMARY/)
      expect(track.chapterTitles[4]).toMatch(/RECOMMEND/)
      // Chapter 2 is always a literature review
      expect(track.chapterTitles[1]).toMatch(/LITERATURE/)
    }
    // Per-corpus discipline shapes for Chapter 3
    expect(TRACKS['science-lab'].chapterTitles[2]).toMatch(/MATERIAL AND METHODS/)
    expect(TRACKS['social-survey'].chapterTitles[2]).toMatch(/RESEARCH METHODOLOGY/)
    expect(TRACKS['computing-engineering'].chapterTitles[2]).toMatch(/SYSTEM ANALYSIS AND DESIGN/)
  })

  it('only the social-survey track gets a questionnaire appendix', () => {
    expect(TRACKS['social-survey'].questionnaireAppendix).toBe(true)
    expect(TRACKS['science-lab'].questionnaireAppendix).toBe(false)
    expect(TRACKS['computing-engineering'].questionnaireAppendix).toBe(false)
  })
})
