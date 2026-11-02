import type { ContentItem, ContentKind, Course } from '../data/models';

export const CONTENT_SORTS = [
  { id: 'NEWEST', label: 'Newest first' },
  { id: 'OLDEST', label: 'Oldest first' },
  { id: 'A_Z', label: 'Title A to Z' },
  { id: 'Z_A', label: 'Title Z to A' },
] as const;
export type ContentSort = (typeof CONTENT_SORTS)[number]['id'];

const FILE_EXTENSIONS = ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.zip'];

/** What a link holds, for its subtitle ("PDF", "Slides"...), with a matching icon key when there is one. */
export interface ContentFormat {
  label: string;
  icon: string | null;
}

const PDF: ContentFormat = { label: 'PDF', icon: null };
const SLIDES: ContentFormat = { label: 'Slides', icon: 'presentation' };
const DOCUMENT: ContentFormat = { label: 'Document', icon: null };
const SPREADSHEET: ContentFormat = { label: 'Spreadsheet', icon: null };
const FOLDER: ContentFormat = { label: 'Folder', icon: 'folder' };
const VIDEO: ContentFormat = { label: 'Video', icon: 'play' };

/** Google Docs links by the part after the host. */
const GOOGLE_FORMATS: Record<string, ContentFormat> = {
  presentation: SLIDES,
  document: DOCUMENT,
  spreadsheets: SPREADSHEET,
  forms: { label: 'Form', icon: null },
};

/** OneDrive and SharePoint share links start with a letter for the file type, as in "/:v:/" for a video. */
const SHAREPOINT_FORMATS: Record<string, ContentFormat> = { v: VIDEO, f: FOLDER, p: SLIDES, w: DOCUMENT, x: SPREADSHEET, b: PDF };

/** File name endings, as found in titles such as "Unit 1 Module 1.pdf". */
const EXTENSION_FORMATS: Record<string, ContentFormat> = {
  pdf: PDF,
  ppt: SLIDES,
  pptx: SLIDES,
  doc: DOCUMENT,
  docx: DOCUMENT,
  xls: SPREADSHEET,
  xlsx: SPREADSHEET,
  csv: SPREADSHEET,
  ipynb: { label: 'Notebook', icon: 'code' },
  tex: { label: 'LaTeX', icon: 'code' },
  zip: { label: 'ZIP', icon: 'folder' },
  png: { label: 'Image', icon: 'image' },
  jpg: { label: 'Image', icon: 'image' },
  jpeg: { label: 'Image', icon: 'image' },
  mp4: VIDEO,
  mov: VIDEO,
};

const KIND_FORMATS: Record<ContentKind, ContentFormat> = {
  FILE: { label: 'File', icon: null },
  VIDEO: { label: 'Video', icon: null },
  WEBSITE: { label: 'Website', icon: null },
};

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

  /**
   * What the item is: from the link when it says (Google Slides, a OneDrive folder...), otherwise from the
   * first file name ending in the title or the link, otherwise the item's kind.
   */
  formatOf(item: Pick<ContentItem, 'title' | 'url' | 'kind'>): ContentFormat {
    const host = (hostOf(item.url) ?? '').toLowerCase();
    const path = item.url.split(/[?#]/)[0].toLowerCase();
    if (host === 'docs.google.com') {
      const part = path.split('/')[3] ?? '';
      if (GOOGLE_FORMATS[part]) return GOOGLE_FORMATS[part];
    }
    if (host === 'drive.google.com' && path.includes('/folders/')) return FOLDER;
    if (host.endsWith('.sharepoint.com')) {
      const letter = path.match(/^https?:\/\/[^/]+\/:([a-z]):\//)?.[1] ?? '';
      if (SHAREPOINT_FORMATS[letter]) return SHAREPOINT_FORMATS[letter];
    }
    for (const text of [item.title.toLowerCase(), path.replace(/^https?:\/\/[^/]*/, '')]) {
      for (const match of text.matchAll(/\.([a-z0-9]{2,5})\b/g)) {
        if (EXTENSION_FORMATS[match[1]]) return EXTENSION_FORMATS[match[1]];
      }
    }
    return KIND_FORMATS[item.kind];
  },

  /** Where the link lives, for the subtitle: "Google Drive", "OneDrive", "YouTube" or the site's name. */
  sourceOf(url: string): string {
    const host = (hostOf(url) ?? '').toLowerCase().replace(/^www\./, '');
    if (host === 'drive.google.com' || host === 'docs.google.com') return 'Google Drive';
    if (host.endsWith('-my.sharepoint.com')) return 'OneDrive';
    if (host.endsWith('.sharepoint.com')) return 'SharePoint';
    if (host === 'teams.microsoft.com') return 'Teams';
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'YouTube';
    return host;
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
