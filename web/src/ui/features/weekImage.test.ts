import { describe, expect, it } from 'vitest';
import { resolveMeetingColor, wrapLines } from './weekImage';

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

describe('resolveMeetingColor', () => {
  it('keeps a custom or preset course color when set', () => {
    expect(resolveMeetingColor('#C76FA7', '#CC4A0A')).toBe('#C76FA7');
    expect(resolveMeetingColor(' #4F46E5 ', '#CC4A0A')).toBe('#4F46E5');
  });

  it('falls back to the class or device accent when the course has no color', () => {
    expect(resolveMeetingColor('', '#CC4A0A')).toBe('#CC4A0A');
    expect(resolveMeetingColor(undefined, '#585BE8')).toBe('#585BE8');
  });
});
