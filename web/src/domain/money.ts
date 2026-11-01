/** 425000 -> "₱4,250.00", -800 -> "-₱8.00" */
export function formatMoney(centavos: number): string {
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100).toLocaleString('en-US');
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}₱${pesos}.${cents}`;
}

/** "100" -> 10000, "1,250.50" -> 125050. Returns null for empty, negative, zero or invalid text. */
export function parsePesos(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, '');
  const m = /^\+?(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!cleaned || !m || (m[1] === '' && (m[2] ?? '') === '')) return null;
  const value = Number(m[1] || '0') * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}
