/** Layout of the weekly timetable grid: which days get a column, the hours shown, and side-by-side lanes for clashes. */

export interface GridMeeting {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
}

export interface GridBlock<T> {
  item: T;
  startMinutes: number;
  /** Always after the start, even when the saved end time is not. */
  endMinutes: number;
  /** Position among meetings that overlap: 0 is the leftmost of `lanes`. */
  lane: number;
  lanes: number;
}

export interface WeekLayout<T> {
  /** Days that have meetings, Monday first and Sunday last (0 = Sunday, as in the data). */
  days: number[];
  /** Whole hours around the earliest start and the latest end. */
  fromMinutes: number;
  toMinutes: number;
  byDay: Record<number, GridBlock<T>[]>;
}

const SHORTEST = 30;

export function layoutWeek<T extends GridMeeting>(meetings: T[]): WeekLayout<T> {
  const blocks: GridBlock<T>[] = meetings.map((item) => ({
    item,
    startMinutes: item.startMinutes,
    endMinutes: Math.max(item.endMinutes, item.startMinutes + SHORTEST),
    lane: 0,
    lanes: 1,
  }));
  const days = [...new Set(blocks.map((b) => b.item.dayOfWeek))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const byDay: Record<number, GridBlock<T>[]> = {};
  for (const day of days) {
    const list = blocks.filter((b) => b.item.dayOfWeek === day).sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
    // A cluster is a run of meetings that overlap one another directly or through a shared neighbour.
    let cluster: GridBlock<T>[] = [];
    let clusterEnd = -1;
    const close = () => {
      const lanes = Math.max(0, ...cluster.map((b) => b.lane)) + 1;
      for (const b of cluster) b.lanes = lanes;
      cluster = [];
    };
    for (const block of list) {
      if (cluster.length > 0 && block.startMinutes >= clusterEnd) close();
      const taken = new Set(cluster.filter((b) => b.endMinutes > block.startMinutes).map((b) => b.lane));
      let lane = 0;
      while (taken.has(lane)) lane++;
      block.lane = lane;
      cluster.push(block);
      clusterEnd = Math.max(clusterEnd, block.endMinutes);
    }
    if (cluster.length > 0) close();
    byDay[day] = list;
  }
  const fromMinutes = blocks.length === 0 ? 0 : Math.floor(Math.min(...blocks.map((b) => b.startMinutes)) / 60) * 60;
  const toMinutes = blocks.length === 0 ? 0 : Math.ceil(Math.max(...blocks.map((b) => b.endMinutes)) / 60) * 60;
  return { days, fromMinutes, toMinutes, byDay };
}

const SMALL_WORDS = /^(of|and|the|in|to|for|a|an|on|with)$/i;

// A number or a Roman numeral ("Thesis I", or "Thesis l" typed with a small L).
const NUMBER_WORD = /\d|^(i|ii|iii|iv|v|vi|vii|viii|ix|x|l)$/i;
// The letters of a course code, as "MAT" in "Real Analysis, MAT 308".
const CODE_LETTERS = /^\p{Lu}{2,5}$/u;

/**
 * A short label for a narrow block: initials for several words ("Operations Research" is "OR"), else the
 * first letters. Course codes are left out, in brackets ("Specialization 1 DBA (IT 304D)") or not
 * ("The Entrepreneurial Mind, SSP 101D" is "EM"), and so are numbers, which read like codes in a label.
 */
export function courseShortName(name: string): string {
  const lettersOnly = (text: string) => text.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  // A name that is nothing but a bracketed code keeps the code.
  const plain = lettersOnly(name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')) || lettersOnly(name) || name;
  const all = plain.trim().split(/\s+/).filter((w) => w && !SMALL_WORDS.test(w));
  const words = all.filter((w, i) => !NUMBER_WORD.test(w) && !(CODE_LETTERS.test(w) && /\d/.test(all[i + 1] ?? '')));
  // Nothing left but a code ("PE 3", "CC107"): show the code itself.
  if (words.length === 0) return all.length > 0 ? all.join('').slice(0, 5) : name.trim().slice(0, 4);
  if (words.length === 1) return words[0].length <= 5 ? words[0] : words[0].slice(0, 4);
  return words.map((w) => w[0].toUpperCase()).join('').slice(0, 5);
}
