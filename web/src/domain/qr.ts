import qrcode from 'qrcode-generator';

/** The QR code of a text as rows of dark (true) and light modules, without the quiet zone. */
export function qrMatrix(text: string): boolean[][] {
  // Level M survives a scuffed screen or a blurry photo, and an invite link still fits a small code.
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** An SVG path drawing every dark module as a 1 by 1 square, offset by the quiet zone. */
export function qrPath(matrix: boolean[][], quiet: number): string {
  let d = '';
  matrix.forEach((row, r) => row.forEach((dark, c) => dark && (d += `M${c + quiet},${r + quiet}h1v1h-1z`)));
  return d;
}
