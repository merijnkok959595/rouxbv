/** Beursnamen zonder jaar — jaar wordt apart getoond en automatisch toegevoegd bij opslaan. */
export const BEURS_BASE_NAMES = [
  'NHBEURS',
  'HORECAVA',
  'GOES',
  'HARDERWIJK',
  'LEEUWARDEN',
  'ASSEN',
  'GASTVRIJROTTERDAM',
] as const

export const BEURS_OPTIONS: string[] = [...BEURS_BASE_NAMES, 'OVERIG']

export const SOURCE_STORAGE_KEY = 'roux-formulier-last-source-name'

/** Geeft de volledige source-string: "NHBEURS 2026" of "Overig" */
export function buildSource(name: string, year: number): string {
  return name === 'OVERIG' ? 'OVERIG' : `${name} ${year}`
}

export function defaultBeursName(): string {
  return BEURS_BASE_NAMES[0]
}

// Legacy — nog gebruikt in andere plekken
export function beursOptionsForYear(year: number): string[] {
  return [...BEURS_BASE_NAMES.map(n => `${n} ${year}`), 'Overig']
}
export function defaultBeursSource(year: number): string {
  return `${BEURS_BASE_NAMES[0]} ${year}`
}
