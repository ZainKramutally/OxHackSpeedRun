export const fmtHex = (v: number, digits = 8) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(digits, '0');

export const toSigned = (v: number) => v | 0;

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
