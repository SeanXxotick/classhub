import { useMemo, useState } from 'react';
import { friendlyMessage } from '../../data/errors';
import { blobBase64, nativeApp } from '../../data/native';
import { InviteCode } from '../../domain/inviteCode';
import { JoinLinks } from '../../domain/joinLinks';
import { qrMatrix, qrPath } from '../../domain/qr';
import { Dialog, inAndroidApp, saveFile } from '../common';

const QUIET = 4;

/**
 * Invite students: a QR code classmates nearby scan with their phone camera, the code and the link to copy,
 * and Share, which opens the phone's share sheet (Messenger, Gmail and so on). In the Android app that sheet
 * comes from the APK (2.0.2); older APKs and computers without one copy the message instead.
 */
export function InviteDialog({
  className,
  code,
  roleName,
  notify,
  onClose,
}: {
  className: string;
  code: string;
  roleName: string;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const shown = InviteCode.normalize(code);
  const link = JoinLinks.linkFor(code);
  const text = JoinLinks.shareText(className, code);
  const matrix = useMemo(() => qrMatrix(link), [link]);
  const size = matrix.length + QUIET * 2;
  const [busy, setBusy] = useState(false);

  const native = nativeApp();
  const canShare = !!native || (!inAndroidApp() && typeof navigator.share === 'function');

  async function copy(value: string, done: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify(done);
    } catch {
      notify(`Copying did not work here. The invite link is ${link}`);
    }
  }

  async function share() {
    try {
      if (native) return await native.share({ text, title: 'Share invite', subject: `Join ${className} on ClassHub` });
      if (canShare) return await navigator.share({ title: `Join ${className} on ClassHub`, text });
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
    }
    await copy(
      text,
      inAndroidApp()
        ? 'The invite message was copied. Update ClassHub to share straight to Messenger and other apps.'
        : 'The invite message was copied. Paste it in your class group chat.',
    );
  }

  async function qrImage() {
    setBusy(true);
    try {
      const blob = await inviteImage(className, shown, link, matrix);
      const name = `${className} invite QR.png`;
      // In the app, the image goes to the share sheet, ready for the group chat. Elsewhere it is saved.
      if (native) await native.shareFile({ name, mimeType: 'image/png', data: await blobBase64(blob), title: 'Share QR image' });
      else await saveFile(name, blob, notify);
    } catch (e) {
      notify(friendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Invite students"
      onClose={onClose}
      actions={
        <>
          <button className="btn text" onClick={onClose}>
            Close
          </button>
          <button className="btn solid" onClick={() => void share()}>
            {canShare ? 'Share invite' : 'Copy invite message'}
          </button>
        </>
      }
    >
      <div className="invite-panel">
        <svg className="invite-qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={`QR code of the invite link for ${className}`}>
          <rect width={size} height={size} fill="#ffffff" />
          <path d={qrPath(matrix, QUIET)} fill="#0f172a" />
        </svg>
        <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
          Classmates can scan this with their phone camera to join. They join as {roleName}.
        </p>
        <button className="btn text small" disabled={busy} onClick={() => void qrImage()}>
          {native ? 'Share QR image' : 'Save QR image'}
        </button>

        <div className="invite-line">
          <div>
            <div className="small muted">Code</div>
            <div className="invite-code small-code">{shown}</div>
          </div>
          <button className="btn outline" onClick={() => void copy(shown, 'Code copied.')}>
            Copy
          </button>
        </div>
        <div className="invite-line">
          <div style={{ minWidth: 0 }}>
            <div className="small muted">Link</div>
            <div className="invite-link">{link.replace('https://', '')}</div>
          </div>
          <button className="btn outline" onClick={() => void copy(link, 'Link copied.')}>
            Copy
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** A picture for the group chat: the class name, the QR code, the code and the link on a white card. */
async function inviteImage(className: string, code: string, link: string, matrix: boolean[][]): Promise<Blob> {
  const SCALE = 2;
  const W = 360;
  const MODULE = Math.floor(240 / (matrix.length + QUIET * 2));
  const qrSize = MODULE * (matrix.length + QUIET * 2);
  const H = 120 + qrSize + 110;
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This browser cannot make pictures.');
  g.scale(SCALE, SCALE);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#0f766e';
  g.fillRect(0, 0, W, 8);
  g.textAlign = 'center';
  g.fillStyle = '#475569';
  g.font = '600 15px system-ui, sans-serif';
  g.fillText('Join our class on ClassHub', W / 2, 44);
  g.fillStyle = '#0f172a';
  g.font = '800 22px system-ui, sans-serif';
  let title = className;
  while (g.measureText(title).width > W - 40 && title.length > 4) title = title.slice(0, -2);
  if (title !== className) title = `${title.trimEnd()}…`;
  g.fillText(title, W / 2, 78);
  const left = (W - qrSize) / 2;
  const top = 100;
  g.fillStyle = '#0f172a';
  matrix.forEach((row, r) => row.forEach((dark, c) => dark && g.fillRect(left + (c + QUIET) * MODULE, top + (r + QUIET) * MODULE, MODULE, MODULE)));
  g.fillStyle = '#475569';
  g.font = '500 13px system-ui, sans-serif';
  g.fillText('Scan with your phone camera, or enter the code', W / 2, top + qrSize + 26);
  g.fillStyle = '#0f766e';
  g.font = '800 30px ui-monospace, Consolas, monospace';
  g.fillText(code.split('').join(' '), W / 2, top + qrSize + 66);
  g.fillStyle = '#64748b';
  g.font = '12px system-ui, sans-serif';
  g.fillText(link.replace('https://', ''), W / 2, top + qrSize + 92);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'));
}
