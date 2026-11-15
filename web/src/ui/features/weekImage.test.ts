import { describe, expect, it } from 'vitest';
import { wrapLines } from './weekImage';

// Every character is 1 wide, so widths are lengths.
const measure = (s: string) => s.length;

describe('wrapLines', () => {
  it('keeps short text on one line', () => {
    expect(wrapLines('Real Analysis', 20, measure, 3)).toEqual(['Real Analysis']);
  });

  it('wraps at spaces', () => {
    expect(wrapLines('Graph Theory and Applications', 14, measure, 4)).toEqual(['Graph Theory', 'and', 'Applications']);
  });

  it('ends the last line in an ellipsis when lines run out', () => {
    expect(wrapLines('Automata Theory and Formal Languages', 16, measure, 2)).toEqual(['Automata Theory', 'and Formal…']);
  });

  it('breaks a word longer than a line', () => {
    expect(wrapLines('Specialization', 6, measure, 5)).toEqual(['Specia', 'lizati', 'on']);
  });
});
