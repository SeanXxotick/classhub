/*
 * ClassHub notification sender (docs/PLAN-V2.md, "Notifications"). A Cloudflare Worker on a cron trigger.
 *
 * Every minute: reads classes/{classId}/outbox, works out who each notice is for, finds their devices
 * (devices/{id}) and sends through Firebase Cloud Messaging. Once a day it also queues "due tomorrow".
 *
 * The free plan allows 50 outside requests per run, so one run does a limited amount and leaves the rest
 * in the queue: a notice remembers how far it got (cursor) and is deleted when everyone has it.
 *
 * Secrets (set with "wrangler secret put", never in the repo): SERVICE_ACCOUNT, the service account JSON.
 * runOnce takes its endpoints as arguments so local.mjs can run the same code against the emulator.
 */

const BUDGET = 44; // outside requests per run, under the limit of 50
const DAY = 86_400_000;

// ---------------------------------------------------------------- Firestore values

function decode(v) {
  if (v === undefined || v === null) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decode);
  if ('mapValue' in v) return fromFields(v.mapValue.fields ?? {});
  return undefined;
}

const fromFields = (fields) => Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, decode(v)]));
const docOf = (d) => ({ name: d.name, id: d.name.split('/').pop(), ...fromFields(d.fields) });

function encode(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return { integerValue: String(Math.trunc(v)) };
  if (typeof v === 'boolean') return { booleanValue: v };
  throw new Error('unsupported value');
}
const toFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, encode(v)]));

// ---------------------------------------------------------------- Who gets a notice

/** The uids a notice is for, without the person who caused it. members and roles are the class's documents. */
export function audienceOf(notice, members, roles, doneUids = new Set()) {
  let list = members;
  if (notice.audience === 'COURSE') list = members.filter((m) => !(m.excludedCourseIds ?? []).includes(notice.audienceId));
  else if (notice.audience === 'USER') list = members.filter((m) => m.id === notice.audienceId);
  else if (notice.audience === 'PERMISSION') {
    const allowed = new Set(roles.filter((r) => r.locked === true || (r.permissions ?? []).includes(notice.audienceId)).map((r) => r.id));
    list = members.filter((m) => allowed.has(m.roleId));
  }
  return list.map((m) => m.id).filter((uid) => uid !== notice.createdByUid && !doneUids.has(uid));
}

/** The device tokens to send to, in a fixed order so a notice can continue where it stopped. */
export function tokensFor(kind, devices) {
  const seen = new Set();
  return devices
    .filter((d) => typeof d.token === 'string' && d.token && !(d.muted ?? []).includes(kind))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .filter((d) => !seen.has(d.token) && seen.add(d.token));
}

/** Where a tap on the notification opens. */
export function linkOf(notice, classId) {
  const tab = { ANNOUNCEMENT: 'NEWS', COMMENT: 'NEWS', SCHEDULE_NEW: 'SCHEDULE', DUE_TOMORROW: 'SCHEDULE', NO_CLASS: 'SCHEDULE', CLAIM_SENT: 'LEDGER', CLAIM_DECIDED: 'LEDGER', JOIN_REQUEST: 'MEMBERS' }[notice.kind];
  return `/class/${classId}${tab ? `?tab=${tab}` : ''}`;
}

// ---------------------------------------------------------------- One run

/**
 * cfg: { projectId, firestore (base URL), fcm (base URL or null to only log), authHeader, fetch, log, appUrl, now }
 * Returns a summary for the log.
 */
export async function runOnce(cfg) {
  const base = `${cfg.firestore}/v1/projects/${cfg.projectId}/databases/(default)/documents`;
  let spent = 0;
  const call = async (url, init = {}) => {
    spent++;
    return cfg.fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...cfg.authHeader, ...(init.headers ?? {}) } });
  };
  const json = async (url, init) => {
    const res = await call(url, init);
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url.split('/documents')[1] ?? url}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  const list = async (path) => ((await json(`${base}/${path}?pageSize=300`)).documents ?? []).map(docOf);
  const remove = (name) => call(`${cfg.firestore}/v1/${name}`, { method: 'DELETE' });

  const found = await json(`${base}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'outbox', allDescendants: true }], limit: 8 } }),
  });
  const queue = found.filter((r) => r.document).map((r) => docOf(r.document));
  const summary = { queued: queue.length, sent: 0, finished: 0, dropped: 0 };

  for (const notice of queue) {
    if (spent > BUDGET - 6) break;
    const classId = notice.name.split('/classes/')[1].split('/')[0];
    // Older than two days: nobody needs it any more.
    if ((notice.createdAtMillis ?? 0) < cfg.now - 2 * DAY) {
      await remove(notice.name);
      summary.dropped++;
      continue;
    }
    const members = await list(`classes/${classId}/members`);
    const roles = notice.audience === 'PERMISSION' ? await list(`classes/${classId}/roles`) : [];
    let done = new Set();
    if (notice.kind === 'DUE_TOMORROW' && notice.refId) {
      done = new Set((await list(`classes/${classId}/progress`)).filter((p) => p.done && p.done[notice.refId]).map((p) => p.id));
    }
    const uids = audienceOf(notice, members, roles, done);

    const devices = [];
    for (let i = 0; i < uids.length; i += 30) {
      const rows = await json(`${base}:runQuery`, {
        method: 'POST',
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'devices' }],
            where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'IN', value: { arrayValue: { values: uids.slice(i, i + 30).map((u) => ({ stringValue: u })) } } } },
          },
        }),
      });
      devices.push(...rows.filter((r) => r.document).map((r) => docOf(r.document)));
    }
    const targets = tokensFor(notice.kind, devices);

    let cursor = notice.cursor ?? 0;
    while (cursor < targets.length && spent < BUDGET - 2) {
      const device = targets[cursor++];
      if (!cfg.fcm) {
        cfg.log(`would send "${notice.title}" to ${device.uid} (${device.platform})`);
        summary.sent++;
        continue;
      }
      const link = linkOf(notice, classId);
      const res = await call(`${cfg.fcm}/v1/projects/${cfg.projectId}/messages:send`, {
        method: 'POST',
        body: JSON.stringify({
          message: {
            token: device.token,
            notification: { title: notice.title, body: notice.body ?? '' },
            data: { url: link, kind: notice.kind, classId },
            webpush: { fcm_options: { link: `${cfg.appUrl}${link}` } },
            android: { notification: { channel_id: 'classhub' } },
          },
        }),
      });
      if (res.ok) summary.sent++;
      else if (res.status === 404 || res.status === 400) await remove(device.name); // the app was removed or the token is no longer valid
      else cfg.log(`send failed: ${res.status} ${(await res.text()).slice(0, 160)}`);
    }

    if (cursor >= targets.length) {
      await remove(notice.name);
      summary.finished++;
    } else {
      await call(`${cfg.firestore}/v1/${notice.name}?updateMask.fieldPaths=cursor`, { method: 'PATCH', body: JSON.stringify({ fields: toFields({ cursor }) }) });
    }
  }
  return { ...summary, requests: spent };
}

/**
 * Once a day, in the evening: one DUE_TOMORROW notice for every schedule item due tomorrow (Philippine time).
 * Students who marked the item done are skipped when the notice is sent.
 */
export async function queueDueTomorrow(cfg) {
  const base = `${cfg.firestore}/v1/projects/${cfg.projectId}/databases/(default)/documents`;
  const headers = { 'Content-Type': 'application/json', ...cfg.authHeader };
  const manilaMidnight = Math.floor((cfg.now + 8 * 3_600_000) / DAY) * DAY - 8 * 3_600_000;
  const from = manilaMidnight + DAY;
  const classes = ((await (await cfg.fetch(`${base}/classes?pageSize=40&mask.fieldPaths=name`, { headers })).json()).documents ?? []).map(docOf);
  let queued = 0;
  for (const room of classes.slice(0, 40)) {
    const rows = await (
      await cfg.fetch(`${base}/classes/${room.id}:runQuery`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'schedule' }],
            where: {
              compositeFilter: {
                op: 'AND',
                filters: [
                  { fieldFilter: { field: { fieldPath: 'dueMillis' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(from) } } },
                  { fieldFilter: { field: { fieldPath: 'dueMillis' }, op: 'LESS_THAN', value: { integerValue: String(from + DAY) } } },
                ],
              },
            },
          },
        }),
      })
    ).json();
    for (const item of rows.filter((r) => r.document).map((r) => docOf(r.document))) {
      if (item.status === 'CANCELLED') continue;
      const notice = {
        kind: 'DUE_TOMORROW',
        audience: item.courseId ? 'COURSE' : 'CLASS',
        audienceId: item.courseId ?? '',
        title: `Due tomorrow: ${item.title}`.slice(0, 120),
        body: room.name ?? '',
        refId: item.id,
        createdByUid: '',
        createdAtMillis: cfg.now,
      };
      // The id is fixed per item and day, so a second run on the same evening does not queue it twice.
      await cfg.fetch(`${base}/classes/${room.id}/outbox?documentId=due-${item.id}-${from}`, { method: 'POST', headers, body: JSON.stringify({ fields: toFields(notice) }) });
      queued++;
    }
  }
  return { classes: classes.length, queued };
}

// ---------------------------------------------------------------- Signing in to Google

let cached = { token: '', expires: 0 };

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (text) => b64url(new TextEncoder().encode(text));

/** An access token for Firestore and Cloud Messaging from the service account, reused until it is about to expire. */
async function accessToken(account, now) {
  if (cached.token && cached.expires > now + 120_000) return cached.token;
  const seconds = Math.floor(now / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: seconds,
      exp: seconds + 3600,
    }),
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
  cached = { token: body.access_token, expires: now + body.expires_in * 1000 };
  return cached.token;
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.SERVICE_ACCOUNT) return console.log('SERVICE_ACCOUNT is not set yet: nothing to do.');
    const account = JSON.parse(env.SERVICE_ACCOUNT);
    const now = Date.now();
    const cfg = {
      projectId: account.project_id,
      firestore: 'https://firestore.googleapis.com',
      fcm: 'https://fcm.googleapis.com',
      authHeader: { Authorization: `Bearer ${await accessToken(account, now)}` },
      fetch: (url, init) => fetch(url, init),
      log: (line) => console.log(line),
      appUrl: env.APP_URL,
      now,
    };
    // 10:00 UTC is 6 in the evening in the Philippines (the second cron in wrangler.toml).
    const work = event.cron === '0 10 * * *' ? queueDueTomorrow(cfg) : runOnce(cfg);
    ctx.waitUntil(work.then((summary) => console.log(JSON.stringify(summary)), (e) => console.error(String(e?.message ?? e))));
  },
};
