import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * The Android app's own features (ClassHubNativePlugin.java, from APK 2.0.2): Android's share sheet and saving
 * files to Downloads. The web view cannot do either by itself. Null on the website and in older APKs.
 */
type ClassHubNative = {
  share(options: { text: string; title: string; subject?: string }): Promise<void>;
  saveFile(options: { name: string; mimeType: string; data: string }): Promise<{ where: 'downloads' | 'shared' }>;
  shareFile(options: { name: string; mimeType: string; data: string; title: string }): Promise<void>;
};

const plugin = registerPlugin<ClassHubNative>('ClassHubNative');

export function nativeApp(): ClassHubNative | null {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ClassHubNative') ? plugin : null;
}

/** The blob as base64 without the "data:...;base64," prefix, the way the plugin takes files. */
export function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** The MIME type without parameters ("text/csv;charset=utf-8" becomes "text/csv"). */
export const baseMime = (type: string): string => type.split(';')[0].trim() || 'application/octet-stream';
