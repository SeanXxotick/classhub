import { auth } from './firebase';
import type { ContentFile } from './models';

/**
 * Uploaded files for Contents, kept private by the files Worker (files/src/worker.js) in Cloudflare R2.
 * Every call carries the user's Firebase sign-in; the Worker checks class membership and the
 * "Manage contents" permission. A file opened once is kept on the device (Cache API) and opens offline.
 */

/** The Worker's address (VITE_FILES_URL). Empty: uploads are not set up, and the form offers links only. */
export const FILES_URL = String(import.meta.env.VITE_FILES_URL ?? '').replace(/\/+$/, '');
export const filesEnabled = FILES_URL !== '';

export const FILE_LIMIT_BYTES = 10 * 1024 * 1024;

/** Extensions the Worker accepts (it also checks each file's first bytes). */
export const FILE_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'] as const;
/** For the file picker. */
export const FILE_ACCEPT = FILE_EXTENSIONS.map((e) => `.${e}`).join(',');

const CACHE = 'classhub-files-v1';

export type FileView = 'PDF' | 'IMAGE' | 'OTHER';

/** How the app shows a file: PDFs and pictures inside ClassHub, the rest in another app. */
export function viewOf(file: Pick<ContentFile, 'mimeType'>): FileView {
  if (file.mimeType === 'application/pdf') return 'PDF';
  if (file.mimeType.startsWith('image/')) return 'IMAGE';
  return 'OTHER';
}

/** "2.4 MB", "830 KB". */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A message when the file cannot be uploaded, before sending it; null when it can. */
export function checkFile(file: { name: string; size: number }): string | null {
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (!(FILE_EXTENSIONS as readonly string[]).includes(ext)) return 'Only PDF, image, Word, PowerPoint and Excel files can be uploaded.';
  if (file.size === 0) return 'This file is empty.';
  if (file.size > FILE_LIMIT_BYTES) return `This file is ${sizeText(file.size)}. Files can be up to 10 MB. Save it as a smaller PDF, or share it as a Google Drive link.`;
  return null;
}

async function idToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in again, then try once more.');
  return user.getIdToken();
}

const fileUrl = (classId: string, key: string) => `${FILES_URL}/classes/${encodeURIComponent(classId)}/files/${encodeURIComponent(key)}`;

async function failure(res: Response): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(typeof body?.message === 'string' ? body.message : `The file service answered ${res.status}. Try again.`);
}

export interface Usage {
  usedBytes: number;
  limitBytes: number;
}

export interface Uploaded extends ContentFile, Usage {}

/** Sends a file; onProgress gets 0 to 1. Rejects with a message to show. */
export async function uploadFile(classId: string, file: File, onProgress: (fraction: number) => void): Promise<Uploaded> {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const token = await idToken();
  return new Promise((resolve, reject) => {
    // XMLHttpRequest, because fetch cannot report upload progress.
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${FILES_URL}/classes/${encodeURIComponent(classId)}/files`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new Error('The upload stopped. Check your connection, then try again.'));
    xhr.onload = () => {
      let body: (Partial<Uploaded> & { message?: string }) | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // handled below
      }
      if (xhr.status === 201 && body?.key) resolve(body as Uploaded);
      else reject(new Error(body?.message ?? `The upload failed (${xhr.status}). Try again.`));
    };
    xhr.send(file);
  });
}

/** How much of the class's 1 GB is used. */
export async function classUsage(classId: string): Promise<Usage> {
  const res = await fetch(`${FILES_URL}/classes/${encodeURIComponent(classId)}/usage`, { headers: { Authorization: `Bearer ${await idToken()}` } });
  if (!res.ok) throw await failure(res);
  return res.json();
}

export async function deleteFile(classId: string, key: string): Promise<void> {
  const res = await fetch(fileUrl(classId, key), { method: 'DELETE', headers: { Authorization: `Bearer ${await idToken()}` } });
  if (!res.ok && res.status !== 404) throw await failure(res);
  await caches.open(CACHE).then((c) => c.delete(fileUrl(classId, key))).catch(() => undefined);
}

/** The file's contents: from this device when it was opened before, otherwise downloaded (and kept). */
export async function readFile(classId: string, file: ContentFile): Promise<Blob> {
  const url = fileUrl(classId, file.key);
  const cache = await caches.open(CACHE).catch(() => null);
  const kept = await cache?.match(url).catch(() => undefined);
  if (kept) return kept.blob();
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${await idToken()}` } });
  } catch {
    throw new Error('This file has not been opened on this device yet, so it needs internet the first time.');
  }
  if (!res.ok) throw await failure(res);
  // Kept without the sign-in, keyed by the address; files never change (a new upload gets a new key).
  await cache?.put(url, res.clone()).catch(() => undefined);
  return new Blob([await res.blob()], { type: file.mimeType });
}

/** Whether the file is already on this device (so it opens offline). */
export async function isKept(classId: string, key: string): Promise<boolean> {
  const cache = await caches.open(CACHE).catch(() => null);
  return !!(await cache?.match(fileUrl(classId, key)).catch(() => undefined));
}
