/**
 * RENAPO official CURP verification algorithm.
 * https://www.gob.mx/curp (checksum spec from Registro Nacional de Población)
 */

const CHAR_VALUES: Record<string, number> = {
  '0': 0,  '1': 1,  '2': 2,  '3': 3,  '4': 4,
  '5': 5,  '6': 6,  '7': 7,  '8': 8,  '9': 9,
  'A': 10, 'B': 11, 'C': 12, 'D': 13, 'E': 14,
  'F': 15, 'G': 16, 'H': 17, 'I': 18, 'J': 19,
  'K': 20, 'L': 21, 'M': 22, 'N': 23, 'Ñ': 24,
  'O': 25, 'P': 26, 'Q': 27, 'R': 28, 'S': 29,
  'T': 30, 'U': 31, 'V': 32, 'W': 33, 'X': 34,
  'Y': 35, 'Z': 36,
}

// Positions 1-4: letters; 5-10: digits YYMMDD; 11: H/M; 12-13: state; 14-16: consonants; 17: alphanumeric; 18: check digit
const FORMAT_REGEX = /^[A-Z]{4}\d{6}[HM][A-Z]{2}[A-Z]{3}[A-Z0-9]\d$/

export function isCurpFormatValid(curp: string): boolean {
  return FORMAT_REGEX.test(curp)
}

export function validateCurpChecksum(curp: string): boolean {
  const c = curp.trim().toUpperCase()
  if (!isCurpFormatValid(c)) return false

  let sum = 0
  for (let i = 0; i < 17; i++) {
    const val = CHAR_VALUES[c[i]]
    if (val === undefined) return false
    sum += val * (18 - i)
  }

  const expected = (10 - (sum % 10)) % 10
  return expected === parseInt(c[17], 10)
}
