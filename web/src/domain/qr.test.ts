import { describe, expect, it } from 'vitest';
import { JoinLinks } from './joinLinks';
import { qrMatrix, qrPath } from './qr';

describe('qrMatrix', () => {
  const matrix = qrMatrix(JoinLinks.linkFor('K7M4QX'));
  const n = matrix.length;

  it('makes a square code small enough to scan from a phone screen', () => {
    expect(matrix.every((row) => row.length === n)).toBe(true);
    // Version 3 (29 modules) holds the 42-character invite link at level M.
    expect(n).toBe(29);
  });

  it('has the three finder squares in the corners', () => {
    const finder = (top: number, left: number) =>
      [0, 6].every((i) => [0, 1, 2, 3, 4, 5, 6].every((j) => matrix[top + i][left + j] && matrix[top + j][left + i])) &&
      matrix[top + 3][left + 3] &&
      !matrix[top + 1][left + 1];
    expect([finder(0, 0), finder(0, n - 7), finder(n - 7, 0)]).toEqual([true, true, true]);
  });

  it('draws one square per dark module', () => {
    const dark = matrix.flat().filter(Boolean).length;
    expect(qrPath(matrix, 4).split('M').length - 1).toBe(dark);
  });
});
