import type { ContentItem, ContentKind, Course } from '../data/models';

export const CONTENT_SORTS = [
  { id: 'OLDEST', label: 'Oldest first' },
  { id: 'NEWEST', label: 'Newest first' },
  { id: 'A_Z', label: 'Title A to Z' },
  { id: 'Z_A', label: 'Title Z to A' },
] as const;
export type ContentSort = (typeof CONTENT_SORTS)[number]['id'];

const FILE_EXTENSIONS = ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.zip'];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export const ContentRules = {
  MAX_TITLE: 80,

  /** Adds "https://" when the link has no scheme, so "drive.google.com/..." works when pasted. */
  normalizeUrl(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;
    return trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  },

  /** Only web links (http or https) with a real host name are accepted. */
  isValidUrl(url: string): boolean {
    if (/\s/.test(url)) return false;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const scheme = parsed.protocol.replace(':', '').toLowerCase();
    const host = parsed.hostname;
    if (!host) return false;
    return (scheme === 'https' || scheme === 'http') && host.includes('.') && !host.startsWith('.') && !host.endsWith('.');
  },

  /** Guesses the kind from the link: Google Drive and Docs are files, YouTube is video, anything else is a website. */
  guessKind(url: string): ContentKind {
    const host = (hostOf(url) ?? '').toLowerCase();
    if (host.endsWith('drive.google.com') || host.endsWith('docs.google.com')) return 'FILE';
    if (host.endsWith('youtube.com') || host === 'youtu.be' || host.endsWith('vimeo.com')) return 'VIDEO';
    const path = url.split('?')[0].toLowerCase();
    if (FILE_EXTENSIONS.some((ext) => path.endsWith(ext))) return 'FILE';
    return 'WEBSITE';
  },

  /** Returns an error message, or null when the item can be saved. */
  check(title: string, url: string): string | null {
    if (!title.trim()) return 'Give the content a title, for example "Unit 1 Module 3".';
    if (title.trim().length > ContentRules.MAX_TITLE) return `Keep the title under ${ContentRules.MAX_TITLE} characters.`;
    if (!url.trim()) return 'Paste the link, for example a Google Drive share link.';
    if (!ContentRules.isValidUrl(ContentRules.normalizeUrl(url))) {
      return 'That does not look like a web link. Copy the share link from Google Drive or the website.';
    }
    return null;
  },

  /** Matches the search text against the title and the note, ignoring case. */
  matches(item: ContentItem, query: string): boolean {
    const q = query.trim().toLowerCase();
    return !q || item.title.toLowerCase().includes(q) || item.note.toLowerCase().includes(q);
  },

  /** Items added at the same moment fall back to title order, and titles that tie fall back to the order they were added. */
  comparator(sort: ContentSort): (a: ContentItem, b: ContentItem) => number {
    const byTitle = (a: ContentItem, b: ContentItem) => ContentRules.naturalCompare(a.title, b.title);
    switch (sort) {
      case 'OLDEST':
        return (a, b) => a.createdAtMillis - b.createdAtMillis || byTitle(a, b);
      case 'NEWEST':
        return (a, b) => b.createdAtMillis - a.createdAtMillis || byTitle(a, b);
      case 'A_Z':
        return (a, b) => byTitle(a, b) || a.createdAtMillis - b.createdAtMillis;
      case 'Z_A':
        return (a, b) => byTitle(b, a) || a.createdAtMillis - b.createdAtMillis;
    }
  },

  /** Compares titles ignoring case, with runs of digits compared by value, so "Module 2" comes before "Module 10". */
  naturalCompare(a: string, b: string): number {
    const x = a.trim().toLowerCase();
    const y = b.trim().toLowerCase();
    const isDigit = (c: string) => c >= '0' && c <= '9';
    let i = 0;
    let j = 0;
    while (i < x.length && j < y.length) {
      if (isDigit(x[i]) && isDigit(y[j])) {
        const startX = i;
        const startY = j;
        while (i < x.length && isDigit(x[i])) i++;
        while (j < y.length && isDigit(y[j])) j++;
        const numX = x.substring(startX, i).replace(/^0+/, '');
        const numY = y.substring(startY, j).replace(/^0+/, '');
        if (numX.length !== numY.length) return numX.length - numY.length;
        if (numX !== numY) return numX < numY ? -1 : 1;
      } else {
        if (x[i] !== y[j]) return x.charCodeAt(i) - y.charCodeAt(j);
        i++;
        j++;
      }
    }
    return x.length - i - (y.length - j);
  },

  /**
   * Groups items under their course, in the class's course order, with general material (no course) first.
   * Items whose course was deleted also go under general. Courses with no items are left out.
   */
  grouped(items: ContentItem[], courses: Course[], sort: ContentSort = 'OLDEST'): [Course | null, ContentItem[]][] {
    const known = new Set(courses.map((c) => c.id));
    const general = items.filter((it) => !it.courseId || !known.has(it.courseId));
    const groups: [Course | null, ContentItem[]][] = [[null, general], ...courses.map((c): [Course, ContentItem[]] => [c, items.filter((it) => it.courseId === c.id)])];
    return groups.filter(([, list]) => list.length > 0).map(([course, list]) => [course, [...list].sort(ContentRules.comparator(sort))]);
  },
};
