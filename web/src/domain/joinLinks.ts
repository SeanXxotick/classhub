import { InviteCode } from './inviteCode';

/**
 * Invite links: https://classhub-975eb.web.app/join/K7M4QX opens ClassHub on the Join screen with the
 * code filled in. The web app also accepts its own address (https://classhub-web.web.app/join/K7M4QX).
 * classhub://join/K7M4QX is a fallback that only the Android app handles.
 */
export const JoinLinks = {
  HOST: 'classhub-975eb.web.app',
  WEB_HOST: 'classhub-web.web.app',
  APP_SCHEME: 'classhub',

  linkFor(code: string): string {
    return `https://${JoinLinks.HOST}/join/${InviteCode.normalize(code)}`;
  },

  /** The message the Share code button sends. */
  shareText(className: string, code: string): string {
    return (
      `Join ${className} on ClassHub: ${JoinLinks.linkFor(code)}\n\n` +
      `Or open ClassHub, tap Add a class, then Join with a code, and enter ${InviteCode.normalize(code)}.`
    );
  },

  /** The invite code inside a ClassHub join link, or null when the link is not one (or the code is malformed). */
  codeFrom(link: string): string | null {
    let url: URL;
    try {
      url = new URL(link.trim());
    } catch {
      return null;
    }
    const scheme = url.protocol.replace(':', '').toLowerCase();
    let segments: string[];
    if (scheme === 'https' || scheme === 'http') {
      const host = url.hostname.toLowerCase();
      if (host !== JoinLinks.HOST && host !== JoinLinks.WEB_HOST) return null;
      segments = url.pathname.split('/').filter((s) => s.length > 0);
    } else if (scheme === JoinLinks.APP_SCHEME) {
      segments = [url.hostname, ...url.pathname.split('/')].filter((s) => s.length > 0);
    } else {
      return null;
    }
    if (segments.length !== 2 || segments[0].toLowerCase() !== 'join') return null;
    const code = InviteCode.normalize(segments[1]);
    return InviteCode.isValid(code) ? code : null;
  },
};
