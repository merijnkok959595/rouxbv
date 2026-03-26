/** Build E.164 for Netherlands from what the user typed (national digits, optional leading 0). */
export function nationalDigitsToE164NL(input: string): string {
  let d = input.replace(/\D/g, '')
  if (d.startsWith('31')) d = d.slice(2)
  if (d.startsWith('0')) d = d.slice(1)
  return `+31${d}`
}

export function countNlNationalDigits(input: string): number {
  let d = input.replace(/\D/g, '')
  if (d.startsWith('31')) d = d.slice(2)
  if (d.startsWith('0')) d = d.slice(1)
  return d.length
}
