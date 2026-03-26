/** Beursnamen; jaar wordt in de UI achter elke optie gezet. */
export const BEURS_BASE_NAMES = [
  'NHBEURS',
  'HORECAVA',
  'GOES',
  'HARDERWIJK',
  'LEEUWARDEN',
  'ASSEN',
  'GASTVRIJROTTERDAM',
] as const

export const SOURCE_STORAGE_KEY = 'roux-formulier-last-source'

export function beursOptionsForYear(year: number): string[] {
  return [...BEURS_BASE_NAMES.map(n => `${n} ${year}`), 'Overig']
}

export function defaultBeursSource(year: number): string {
  return `${BEURS_BASE_NAMES[0]} ${year}`
}
