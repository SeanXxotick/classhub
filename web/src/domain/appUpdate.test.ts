import { describe, expect, it } from 'vitest';
import { installedVersion, updateState, type LatestRelease } from './appUpdate';

const latest = (versionCode: number, minVersionCode = 0, downloadUrl = 'https://example.com/app.apk'): LatestRelease => ({
  versionCode,
  versionName: '2.0.' + versionCode,
  downloadUrl,
  notes: '',
  minVersionCode,
});

describe('installedVersion', () => {
  it('reads the version from the app marker', () => {
    expect(installedVersion('Mozilla/5.0 (Linux; Android 11) Chrome/120 ClassHubAndroid/9', true)).toBe(9);
  });
  it('takes an Android app without a marker to be 2.0.0', () => {
    expect(installedVersion('Mozilla/5.0 (Linux; Android 11) Chrome/120', true)).toBe(7);
  });
  it('is null in a normal browser, even with a marker', () => {
    expect(installedVersion('ClassHubAndroid/9', false)).toBeNull();
  });
});

describe('updateState', () => {
  it('offers a newer version', () => {
    expect(updateState(7, latest(8), null)).toBe('available');
  });
  it('says nothing when the app is up to date or newer', () => {
    expect(updateState(8, latest(8), null)).toBe('none');
    expect(updateState(9, latest(8), null)).toBe('none');
  });
  it('says nothing in a browser or when nothing is published', () => {
    expect(updateState(null, latest(8), null)).toBe('none');
    expect(updateState(7, null, null)).toBe('none');
  });
  it('stays quiet after Later, until the next version', () => {
    expect(updateState(7, latest(8), 8)).toBe('none');
    expect(updateState(7, latest(9), 8)).toBe('available');
  });
  it('requires the update below the minimum version, even after Later', () => {
    expect(updateState(7, latest(9, 8), 9)).toBe('required');
  });
  it('ignores a link that is not https', () => {
    expect(updateState(7, latest(8, 0, 'http://example.com/app.apk'), null)).toBe('none');
  });
});
