import { describe, expect, it } from 'vitest';
import { installCard } from './installCard';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15';
const android = 'Mozilla/5.0 (Linux; Android 11) Chrome/120 Mobile Safari/537.36';
const device = (userAgent: string, more: Partial<{ maxTouchPoints: number; standalone: boolean; androidApp: boolean }> = {}) => ({
  userAgent,
  maxTouchPoints: 0,
  standalone: false,
  androidApp: false,
  ...more,
});

describe('installCard', () => {
  it('shows the iPhone steps in Safari on an iPhone', () => {
    expect(installCard(device(iphone, { maxTouchPoints: 5 }))).toBe('iphone');
  });
  it('treats an iPad, which reports a Mac, as Apple', () => {
    expect(installCard(device(ipad, { maxTouchPoints: 5 }))).toBe('iphone');
  });
  it('shows the Android download on a real Mac and other devices', () => {
    expect(installCard(device(ipad))).toBe('android');
    expect(installCard(device(android))).toBe('android');
  });
  it('shows nothing once ClassHub is on the home screen or in the Android app', () => {
    expect(installCard(device(iphone, { maxTouchPoints: 5, standalone: true }))).toBe('none');
    expect(installCard(device(android, { androidApp: true }))).toBe('none');
  });
});
