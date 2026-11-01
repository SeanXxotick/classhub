import type { ContentKind, ScheduleKind } from '../data/models';

/** The icons and colors officers can choose from, shared by the schedule and contents types. */
export const IconLibrary = {
  /** Every icon key, in the order the picker shows them. */
  ICONS: [
    'document', 'pencil', 'clipboard', 'mic', 'flag',
    'play', 'file', 'globe', 'link', 'folder', 'image',
    'book', 'calculator', 'laptop', 'presentation', 'flask', 'lightbulb', 'group', 'star',
    'calendar', 'clock', 'trophy', 'chat', 'cap', 'ruler', 'code', 'video',
  ],

  /** Color choices as #RRGGBB, including every default color. */
  COLORS: [
    '#3730A3', '#2563EB', '#0369A1', '#0F766E', '#15803D',
    '#CA8A04', '#B45309', '#EA580C', '#B91C1C', '#DC2626',
    '#BE123C', '#DB2777', '#7C3AED', '#A21CAF', '#475569',
  ],

  /** The choice for the kind when it is allowed, otherwise the default. */
  pick(kindName: string, chosen: Record<string, string>, allowed: string[], fallback: string): string {
    const value = chosen[kindName];
    return value !== undefined && allowed.includes(value) ? value : fallback;
  },

  /**
   * What gets saved: only known types with allowed values, and nothing for types left on their
   * default (so a later change to a default still reaches those classes).
   */
  sanitize(chosen: Record<string, string>, defaults: Record<string, string>, allowed: string[]): Record<string, string> {
    return Object.fromEntries(
      Object.entries(chosen).filter(([kind, value]) => kind in defaults && allowed.includes(value) && value !== defaults[kind]),
    );
  },
};

function styleSet<K extends string>(defaults: Record<K, string>, defaultColors: Record<K, string>) {
  return {
    DEFAULTS: defaults,
    DEFAULT_COLORS: defaultColors,
    iconFor: (kind: K, chosen: Record<string, string>) => IconLibrary.pick(kind, chosen, IconLibrary.ICONS, defaults[kind]),
    colorFor: (kind: K, chosen: Record<string, string>) => IconLibrary.pick(kind, chosen, IconLibrary.COLORS, defaultColors[kind]),
    sanitize: (chosen: Record<string, string>) => IconLibrary.sanitize(chosen, defaults, IconLibrary.ICONS),
    sanitizeColors: (chosen: Record<string, string>) => IconLibrary.sanitize(chosen, defaultColors, IconLibrary.COLORS),
  };
}

/** Icon and color for each schedule type. Defaults are the original look. */
export const ScheduleIcons = styleSet<ScheduleKind>(
  { DEADLINE: 'document', QUIZ: 'pencil', EXAM: 'clipboard', RECITATION: 'mic', FCO: 'flag' },
  { DEADLINE: '#2563EB', QUIZ: '#B45309', EXAM: '#B91C1C', RECITATION: '#0F766E', FCO: '#7C3AED' },
);

/** Icon and color for each class contents type. */
export const ContentIcons = styleSet<ContentKind>(
  { FILE: 'file', VIDEO: 'play', WEBSITE: 'globe' },
  { FILE: '#2563EB', VIDEO: '#DC2626', WEBSITE: '#0F766E' },
);
