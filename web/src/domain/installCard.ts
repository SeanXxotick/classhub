/** Which "get the app" card the Account screen shows on this device. */
export type InstallCard = 'iphone' | 'android' | 'none';

export interface DeviceInfo {
  userAgent: string;
  /** navigator.maxTouchPoints: iPads report a Mac user agent but have touch. */
  maxTouchPoints: number;
  /** Opened from the home screen (an installed web app). */
  standalone: boolean;
  /** Inside the ClassHub Android app. */
  androidApp: boolean;
}

export function isAppleTouchDevice(d: Pick<DeviceInfo, 'userAgent' | 'maxTouchPoints'>): boolean {
  return /iPhone|iPad|iPod/.test(d.userAgent) || (/Macintosh/.test(d.userAgent) && d.maxTouchPoints > 1);
}

/** iPhone and iPad: how to add ClassHub to the home screen, unless it already runs from there. Elsewhere: the Android download. */
export function installCard(d: DeviceInfo): InstallCard {
  if (d.androidApp) return 'none';
  if (isAppleTouchDevice(d)) return d.standalone ? 'none' : 'iphone';
  return 'android';
}
