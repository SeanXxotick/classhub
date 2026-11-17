/**
 * ClassHub files: uploads for Contents, kept private in the R2 bucket `classhub-files`.
 *
 *   POST   /classes/{classId}/files          upload (raw body, X-File-Name header); "Manage contents" only
 *   GET    /classes/{classId}/files/{fileId} the file, for members of the class
 *   DELETE /classes/{classId}/files/{fileId} "Manage contents" only
 *   GET    /classes/{classId}/usage          bytes used of the class limit, for members
 *   POST   /classes/{classId}/files/{fileId}/view   a 10-minute link to a Word, PowerPoint or Excel file, for
 *                                                   members, so Microsoft's Office viewer can show it
 *   GET    /v/{classId}/{fileId}/{expires}/{signature}/{name}   that link (no sign-in: the signature is the key)
 *
 * Every request carries the caller's Firebase sign-in (Authorization: Bearer <ID token>). The token's signature
 * is checked against Google's public keys, then membership and role are read from Firestore with the caller's
 * own token, so the Firestore security rules decide what they may see. Objects are stored as
 * classes/{classId}/{fileId}. A daily clean-up removes files whose content item or class is gone.
 */

const TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** The first bytes each type must start with, so a renamed web page or program is refused. */
const SIGNATURES = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
  gif: [[0x47, 0x49, 0x46, 0x38]], // GIF8
  webp: [[0x52, 0x49, 0x46, 0x46]], // RIFF (WEBP at byte 8, checked below)
  docx: [[0x50, 0x4b, 0x03, 0x04]], // zip
  pptx: [[0x50, 0x4b, 0x03, 0x04]],
  xlsx: [[0x50, 0x4b, 0x03, 0x04]],
  doc: [[0xd0, 0xcf, 0x11, 0xe0]], // old Office
  ppt: [[0xd0, 0xcf, 0x11, 0xe0]],
  xls: [[0xd0, 0xcf, 0x11, 0xe0]],
};

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const FILE_ID = /^[A-Za-z0-9]{20}$/;
/** Files uploaded but never saved in a content item are removed after a day. */
const UNUSED_GRACE_MS = 24 * 3600_000;

/** Office files can be shown by Microsoft's viewer through a short-lived link. PDFs and pictures never get one. */
const OFFICE_TYPES = new Set([TYPES.doc, TYPES.docx, TYPES.ppt, TYPES.pptx, TYPES.xls, TYPES.xlsx]);
const VIEW_LINK_MS = 10 * 60_000;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------- Requests

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    try {
      const res = await route(request, env);
      for (const [k, v] of Object.entries(cors ?? {})) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(String(e?.stack ?? e));
      return json({ error: e instanceof HttpError ? e.code : 'SERVER', message: e instanceof HttpError ? e.message : 'Something went wrong.' }, status, cors);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweep(env).then((s) => console.log(JSON.stringify(s)), (e) => console.error(String(e?.message ?? e))));
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  // Local testing only: run the clean-up now.
  if (env.EMULATOR_FIRESTORE && request.method === 'POST' && url.pathname === '/__sweep') return json(await sweep(env));
  if (parts[0] === 'v' && request.method === 'GET') return viewByLink(env, parts);
  if (parts[0] !== 'classes' || !ID.test(parts[1] ?? '')) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  const classId = parts[1];
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const user = await verifyIdToken(token, env);
  const access = await classAccess(env, token, user.uid, classId);
  if (!access.member) throw new HttpError(403, 'NOT_MEMBER', 'You are not in this class.');

  if (parts[2] === 'usage' && parts.length === 3 && request.method === 'GET') {
    return json({ usedBytes: await usedBytes(env, classId), limitBytes: Number(env.CLASS_LIMIT_BYTES) });
  }
  if (parts[2] !== 'files') throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  if (parts.length === 3 && request.method === 'POST') {
    if (!access.manage) throw new HttpError(403, 'NOT_ALLOWED', 'Your role cannot upload files.');
    if (!access.open) throw new HttpError(403, 'CLASS_CLOSING', 'This class is being deleted.');
    return upload(request, env, classId, user.uid);
  }
  const fileId = parts[3] ?? '';
  if (parts.length === 5 && parts[4] === 'view' && FILE_ID.test(fileId) && request.method === 'POST') {
    return makeViewLink(env, url, classId, fileId);
  }
  if (parts.length !== 4 || !FILE_ID.test(fileId)) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  const key = `classes/${classId}/${fileId}`;
  if (request.method === 'GET') {
    const object = await env.FILES.get(key);
    if (!object) throw new HttpError(404, 'NOT_FOUND', 'This file is no longer there.');
    const name = object.customMetadata?.name ?? 'file';
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'Content-Length': String(object.size),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        // Opened by itself, a file can never run anything.
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'X-Content-Type-Options': 'nosniff',
        // Files never change (a new upload gets a new id), so phones may keep them.
        'Cache-Control': 'private, max-age=31536000, immutable',
        ETag: object.httpEtag,
      },
    });
  }
  if (request.method === 'DELETE') {
    if (!access.manage) throw new HttpError(403, 'NOT_ALLOWED', 'Your role cannot delete files.');
    await env.FILES.delete(key);
    return json({ deleted: fileId });
  }
  throw new HttpError(405, 'METHOD', 'Not allowed.');
}

// ---------------------------------------------------------------- Office viewer links

/** HMAC-SHA256 of "classId/fileId/expires" with the VIEW_SECRET, as base64url. */
async function viewSignature(env, classId, fileId, expires) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.VIEW_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${classId}/${fileId}/${expires}`)));
}

/** For a member: a link to one Office file that works without signing in, for the next 10 minutes. */
async function makeViewLink(env, url, classId, fileId) {
  if (!env.VIEW_SECRET) throw new HttpError(501, 'VIEW_OFF', 'Viewing in ClassHub is not set up yet.');
  const object = await env.FILES.head(`classes/${classId}/${fileId}`);
  if (!object) throw new HttpError(404, 'NOT_FOUND', 'This file is no longer there.');
  if (!OFFICE_TYPES.has(object.httpMetadata?.contentType)) throw new HttpError(400, 'NOT_OFFICE', 'Only Word, PowerPoint and Excel files open this way.');
  const expires = Date.now() + VIEW_LINK_MS;
  const signature = await viewSignature(env, classId, fileId, expires);
  // The name ends the address, so the viewer can tell the file type from it.
  const name = encodeURIComponent(object.customMetadata?.name ?? 'file');
  return json({ url: `${url.origin}/v/${classId}/${fileId}/${expires}/${signature}/${name}`, expiresAtMillis: expires });
}

/** The link above: checks the signature and the time, then sends the file. */
async function viewByLink(env, parts) {
  const [, classId, fileId, expiresText, signature] = parts;
  const expires = Number(expiresText);
  const valid =
    !!env.VIEW_SECRET &&
    parts.length === 6 &&
    ID.test(classId ?? '') &&
    FILE_ID.test(fileId ?? '') &&
    /^\d{13}$/.test(expiresText ?? '') &&
    expires > Date.now() &&
    expires <= Date.now() + VIEW_LINK_MS &&
    sameText(signature ?? '', await viewSignature(env, classId, fileId, expires));
  if (!valid) throw new HttpError(403, 'LINK_EXPIRED', 'This link has expired. Open the file again from ClassHub.');
  const object = await env.FILES.get(`classes/${classId}/${fileId}`);
  if (!object) throw new HttpError(404, 'NOT_FOUND', 'This file is no longer there.');
  if (!OFFICE_TYPES.has(object.httpMetadata?.contentType)) throw new HttpError(403, 'NOT_OFFICE', 'Not available.');
  const name = object.customMetadata?.name ?? 'file';
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata.contentType,
      'Content-Length': String(object.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  });
}

/** Compares two strings in constant time, so a signature cannot be guessed one character at a time. */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function upload(request, env, classId, uid) {
  const limit = Number(env.FILE_LIMIT_BYTES);
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > limit) throw new HttpError(413, 'TOO_BIG', 'Files can be up to 10 MB.');
  let name = '';
  try {
    name = decodeURIComponent(request.headers.get('X-File-Name') ?? '');
  } catch {
    throw new HttpError(400, 'BAD_NAME', 'The file name could not be read.');
  }
  name = name.replace(/[\u0000-\u001f\u007f/\\]/g, ' ').trim().slice(-150);
  const ext = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? '').toLowerCase();
  if (!name || !TYPES[ext]) throw new HttpError(415, 'BAD_TYPE', 'Only PDF, image, Word, PowerPoint and Excel files can be uploaded.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) throw new HttpError(400, 'EMPTY', 'This file is empty.');
  if (bytes.length > limit) throw new HttpError(413, 'TOO_BIG', 'Files can be up to 10 MB.');
  if (!matchesSignature(ext, bytes)) throw new HttpError(415, 'BAD_TYPE', `This file is not a real .${ext} file.`);
  const used = await usedBytes(env, classId);
  const classLimit = Number(env.CLASS_LIMIT_BYTES);
  if (used + bytes.length > classLimit) {
    throw new HttpError(507, 'CLASS_FULL', `This class has used ${mb(used)} of its ${mb(classLimit)} for files. Delete some files first.`);
  }
  const fileId = randomId();
  await env.FILES.put(`classes/${classId}/${fileId}`, bytes, {
    httpMetadata: { contentType: TYPES[ext] },
    customMetadata: { name, uploaderUid: uid },
  });
  return json({ key: fileId, name, sizeBytes: bytes.length, mimeType: TYPES[ext], usedBytes: used + bytes.length, limitBytes: classLimit }, 201);
}

function matchesSignature(ext, bytes) {
  const ok = SIGNATURES[ext].some((sig) => sig.every((b, i) => bytes[i] === b));
  if (!ok) return false;
  if (ext === 'webp') return String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return true;
}

const mb = (bytes) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.ceil(bytes / 1024 ** 2)} MB`);

function randomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function usedBytes(env, classId) {
  let total = 0;
  let cursor;
  do {
    const page = await env.FILES.list({ prefix: `classes/${classId}/`, cursor, limit: 1000 });
    for (const o of page.objects) total += o.size;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return total;
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extra ?? {}) } });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  if (!allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name',
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// ---------------------------------------------------------------- Who is asking

let keyCache = { keys: null, expires: 0 };

async function googleKeys() {
  if (keyCache.keys && keyCache.expires > Date.now()) return keyCache.keys;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error(`Google keys: ${res.status}`);
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1] ?? 3600);
  keyCache = { keys: (await res.json()).keys, expires: Date.now() + maxAge * 1000 };
  return keyCache.keys;
}

const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Checks a Firebase ID token and returns its user. With the emulators (local testing), unsigned tokens pass. */
async function verifyIdToken(token, env) {
  const refuse = () => new HttpError(401, 'SIGNED_OUT', 'Sign in again, then try once more.');
  const parts = token.split('.');
  if (parts.length !== 3) throw refuse();
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
  } catch {
    throw refuse();
  }
  const now = Math.floor(Date.now() / 1000);
  const project = env.PROJECT_ID;
  if (claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`) throw refuse();
  if (!(claims.exp > now) || !(claims.iat <= now + 300) || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw refuse();
  if (!env.EMULATOR_FIRESTORE) {
    if (header.alg !== 'RS256') throw refuse();
    const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
    if (!jwk) throw refuse();
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) throw refuse();
  }
  return { uid: claims.sub };
}

function firestoreBase(env) {
  return `${env.EMULATOR_FIRESTORE ?? 'https://firestore.googleapis.com'}/v1/projects/${env.PROJECT_ID}/databases/(default)/documents`;
}

/** The caller's place in the class, read with their own sign-in so the security rules apply. */
async function classAccess(env, token, uid, classId) {
  const base = firestoreBase(env);
  const read = async (path) => {
    const res = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Firestore ${path}: ${res.status}`);
    return (await res.json()).fields ?? {};
  };
  const member = await read(`classes/${classId}/members/${uid}`);
  if (!member) return { member: false, manage: false, open: false };
  const roleId = member.roleId?.stringValue ?? '';
  const [role, room] = await Promise.all([ID.test(roleId) ? read(`classes/${classId}/roles/${roleId}`) : null, read(`classes/${classId}`)]);
  const permissions = (role?.permissions?.arrayValue?.values ?? []).map((v) => v.stringValue);
  const locked = role?.locked?.booleanValue === true;
  const deleting = Number(room?.deletingAtMillis?.integerValue ?? 0);
  return { member: true, manage: locked || permissions.includes('CONTENTS_MANAGE'), open: !!room && deleting === 0 };
}

// ---------------------------------------------------------------- Daily clean-up

let cachedAccess = { token: '', expires: 0 };

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (text) => b64url(new TextEncoder().encode(text));

/** An access token for Firestore from the service account (as in the sender), reused until it nearly expires. */
async function adminToken(env) {
  if (env.EMULATOR_FIRESTORE) return 'owner';
  const now = Date.now();
  if (cachedAccess.token && cachedAccess.expires > now + 120_000) return cachedAccess.token;
  const account = JSON.parse(env.SERVICE_ACCOUNT);
  const seconds = Math.floor(now / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(
    JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: seconds, exp: seconds + 3600 }),
  )}`;
  const pem = account.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${b64url(signature)}`,
  });
  if (!res.ok) throw new Error(`Google sign-in failed: ${res.status}`);
  const body = await res.json();
  cachedAccess = { token: body.access_token, expires: now + body.expires_in * 1000 };
  return cachedAccess.token;
}

/**
 * Removes files no content item uses any more (after a day, so an upload still being saved is kept),
 * and every file of a class that has been deleted.
 */
async function sweep(env) {
  if (!env.EMULATOR_FIRESTORE && !env.SERVICE_ACCOUNT) return { skipped: 'SERVICE_ACCOUNT is not set yet.' };
  const headers = { Authorization: `Bearer ${await adminToken(env)}` };
  const base = firestoreBase(env);
  const byClass = new Map();
  let cursor;
  do {
    const page = await env.FILES.list({ prefix: 'classes/', cursor, limit: 1000 });
    for (const o of page.objects) {
      const [, classId, fileId] = o.key.split('/');
      if (!byClass.has(classId)) byClass.set(classId, []);
      byClass.get(classId).push({ key: o.key, fileId, uploaded: o.uploaded.getTime() });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  let removed = 0;
  for (const [classId, objects] of byClass) {
    const room = await fetch(`${base}/classes/${classId}`, { headers });
    let keep = new Set();
    if (room.status === 404) {
      keep = null; // the class is gone: remove everything
    } else if (!room.ok) {
      continue; // not sure: try again tomorrow
    } else {
      let token = '';
      do {
        const res = await fetch(`${base}/classes/${classId}/contents?pageSize=300${token ? `&pageToken=${token}` : ''}`, { headers });
        if (!res.ok) throw new Error(`contents of ${classId}: ${res.status}`);
        const page = await res.json();
        for (const d of page.documents ?? []) {
          const key = d.fields?.file?.mapValue?.fields?.key?.stringValue;
          if (key) keep.add(key);
        }
        token = page.nextPageToken ?? '';
      } while (token);
    }
    const now = Date.now();
    const grace = env.UNUSED_GRACE_MS !== undefined ? Number(env.UNUSED_GRACE_MS) : UNUSED_GRACE_MS;
    const doomed = objects.filter((o) => (keep === null ? true : !keep.has(o.fileId) && now - o.uploaded >= grace));
    for (let i = 0; i < doomed.length; i += 1000) await env.FILES.delete(doomed.slice(i, i + 1000).map((o) => o.key));
    removed += doomed.length;
  }
  return { classes: byClass.size, removed };
}
