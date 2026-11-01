/** A person's name as the account screen edits it. middleInitial is one or two letters, or empty. */
export interface PersonName {
  first: string;
  middleInitial: string;
  last: string;
}

export const personName = (first = '', middleInitial = '', last = ''): PersonName => ({ first, middleInitial, last });

/** Building, splitting and checking names. Shown as "Juan D. Dela Cruz" everywhere in the app. */
export const NameRules = {
  MAX_PART_LENGTH: 40,
  MAX_INITIAL_LETTERS: 2,

  /** "Juan", "d", "Santos" becomes "Juan D. Santos"; "DC" becomes "Juan D.C. Santos". */
  display(name: PersonName): string {
    const initial = NameRules.cleanInitial(name.middleInitial);
    const dotted = initial ? [...initial].map((c) => `${c}.`).join('') : '';
    return [tidy(name.first), dotted, tidy(name.last)].filter((p) => p.length > 0).join(' ');
  },

  /**
   * A best guess at the parts of a name saved as one line. Words before an initial ("D." or "D.C.")
   * are the first name and words after it the last name. Without an initial, the last word is the last name.
   */
  split(displayName: string): PersonName {
    const words = tidy(displayName).split(' ').filter((w) => w.length > 0);
    if (words.length === 0) return personName();
    // The first word is never the initial, so a first name like "Ma." is not mistaken for one.
    let initialAt = -1;
    for (let i = 1; i < words.length - 1; i++) {
      if (INITIAL.test(words[i])) {
        initialAt = i;
        break;
      }
    }
    if (initialAt >= 0) {
      return personName(
        words.slice(0, initialAt).join(' '),
        NameRules.cleanInitial(words[initialAt]),
        words.slice(initialAt + 1).join(' '),
      );
    }
    if (words.length === 1) return personName(words[0]);
    return personName(words.slice(0, -1).join(' '), '', words[words.length - 1]);
  },

  /** Returns what to fix, or null when the name can be saved. */
  check(name: PersonName): string | null {
    if (!tidy(name.first)) return 'Enter your first name.';
    if (!tidy(name.last)) return 'Enter your last name.';
    if (tidy(name.first).length > NameRules.MAX_PART_LENGTH || tidy(name.last).length > NameRules.MAX_PART_LENGTH) {
      return `Names can be at most ${NameRules.MAX_PART_LENGTH} characters.`;
    }
    if (name.middleInitial.trim() && !NameRules.cleanInitial(name.middleInitial)) return 'The middle initial must be letters only.';
    return null;
  },

  /** The cleaned parts to save: single spaces, and the initial as one or two capital letters. */
  cleaned(name: PersonName): PersonName {
    return personName(tidy(name.first), NameRules.cleanInitial(name.middleInitial), tidy(name.last));
  },

  /** Keeps the first two letters typed into the middle initial box, capitalized ("d.c." becomes "DC"). */
  cleanInitial(text: string): string {
    return [...text].filter((c) => /\p{L}/u.test(c)).slice(0, NameRules.MAX_INITIAL_LETTERS).join('').toUpperCase();
  },
};

function tidy(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

// "D.", "D.C." or "DC."
const INITIAL = /^(?:\p{L}\.(?:\p{L}\.)?|\p{L}{2}\.)$/u;
