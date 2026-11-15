import { clockText } from '../../data/features';
import { courseShortName, layoutWeek } from '../../domain/weekGrid';

/*
 * The full week timetable drawn as a PNG, for "Save as image". It is drawn on a canvas at a fixed size
 * (not a screenshot of the screen), so the picture is the same on a phone and a computer: a column per
 * day, the hours down the side, and a block per meeting in its course colour with the full name.
 */

export interface ImageMeeting {
  id: string;
  courseId: string;
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
  room?: string;
  instructor?: string;
}

export interface WeekImageInput {
  title: string;
  subtitle: string;
  meetings: ImageMeeting[];
  course: (id: string) => { name: string; color?: string } | undefined;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SCALE = 2;
const PAD = 28;
const TOP = 76;
const TIME_W = 58;
const COL_W = 184;
const HEAD_H = 34;
const HOUR = 84;
const FOOT = 40;
const INK = '#1b1d21';
const MUTED = '#5f6368';
const LINE = '#e3e5e8';
const COLUMN = '#f7f8fa';

/**
 * Splits text into lines no wider than maxWidth, at most maxLines (the last one ends in "…" when text
 * is left over). A word too long for a line is broken inside.
 */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const tryLine = line ? `${line} ${word}` : word;
    if (measure(tryLine) <= maxWidth) {
      line = tryLine;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    // Break a long word over lines.
    let rest = word;
    while (measure(rest) > maxWidth && rest.length > 1) {
      let n = rest.length - 1;
      while (n > 1 && measure(rest.slice(0, n)) > maxWidth) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  let last = kept[kept.length - 1];
  while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[kept.length - 1] = `${last.replace(/\s+$/, '')}…`;
  return kept;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** The timetable picture as a PNG. */
export async function weekImage({ title, subtitle, meetings, course }: WeekImageInput): Promise<Blob> {
  const week = layoutWeek(meetings);
  const root = getComputedStyle(document.documentElement);
  const family = root.getPropertyValue('--ch-font').trim() || 'system-ui, sans-serif';
  const fallbackColor = root.getPropertyValue('--ch-accent').trim() || '#0F766E';
  await document.fonts?.ready;

  const gridH = ((week.toMinutes - week.fromMinutes) / 60) * HOUR;
  const width = PAD * 2 + TIME_W + week.days.length * COL_W;
  const height = PAD + TOP + HEAD_H + gridH + FOOT + PAD - 12;
  const canvas = document.createElement('canvas');
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the image.');
  ctx.scale(SCALE, SCALE);
  const font = (weight: number, size: number) => `${weight} ${size}px ${family}`;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Title and subtitle.
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = font(700, 24);
  ctx.fillText(wrapLines(title, width - PAD * 2, (s) => ctx.measureText(s).width, 1)[0] ?? '', PAD, PAD + 26);
  ctx.fillStyle = MUTED;
  ctx.font = font(400, 14);
  ctx.fillText(subtitle, PAD, PAD + 50);

  const gx = PAD + TIME_W;
  const gy = PAD + TOP + HEAD_H;

  // Day names over the columns, and the column backgrounds.
  week.days.forEach((d, i) => {
    const x = gx + i * COL_W;
    ctx.fillStyle = INK;
    ctx.font = font(600, 14);
    ctx.textAlign = 'center';
    ctx.fillText(DAYS[d], x + COL_W / 2, gy - 12);
    ctx.fillStyle = COLUMN;
    roundRect(ctx, x + 2, gy, COL_W - 4, gridH, 8);
    ctx.fill();
  });

  // Hour lines and labels.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = font(500, 12);
  for (let t = week.fromMinutes; t <= week.toMinutes; t += 60) {
    const y = Math.round(gy + ((t - week.fromMinutes) / 60) * HOUR) + 0.5;
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx + week.days.length * COL_W, y);
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.fillText(clockText(t).replace(':00', ''), gx - 8, y);
  }

  // The meetings.
  week.days.forEach((d, i) => {
    for (const b of week.byDay[d]) {
      const m = b.item;
      const info = course(m.courseId);
      const laneW = COL_W / b.lanes;
      const x = gx + i * COL_W + b.lane * laneW + 4;
      const y = gy + ((b.startMinutes - week.fromMinutes) / 60) * HOUR + 2;
      const w = laneW - 8;
      const h = ((b.endMinutes - b.startMinutes) / 60) * HOUR - 4;
      ctx.save();
      ctx.fillStyle = info?.color || fallbackColor;
      roundRect(ctx, x, y, w, h, 8);
      ctx.fill();
      ctx.clip();

      const inner = w - 12;
      const narrow = inner < 90;
      const name = info?.name ?? 'Course';
      const time = narrow
        ? `${clockText(m.startMinutes).split(' ')[0]}–${clockText(m.endMinutes).split(' ')[0]}`
        : `${clockText(m.startMinutes)} to ${clockText(m.endMinutes)}`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = font(700, 13);
      const measure = (s: string) => ctx.measureText(s).width;
      const label = narrow && measure(name) > inner * 2 ? courseShortName(name) : name;
      // The name gets up to two lines first: drop the instructor, then the room, when the block is too short.
      const wanted = Math.min(2, wrapLines(label, inner, measure, 99).length);
      const room = (n: number) => Math.floor((h - 10 - n * 14) / 16);
      let details = [time, m.room, m.instructor].filter((s): s is string => !!s);
      while (details.length > 1 && room(details.length) < wanted) details = details.slice(0, -1);
      const nameLines = Math.max(1, room(details.length));
      const lines = wrapLines(label, inner, measure, nameLines);
      const used = lines.length * 16 + details.length * 14;
      // Centre the text in the block, or start at the top when it fills the block.
      let ty = y + Math.max(6, (h - used) / 2);
      for (const line of lines) {
        ctx.fillText(line, x + w / 2, ty);
        ty += 16;
      }
      ctx.font = font(400, 11.5);
      ctx.globalAlpha = 0.92;
      for (const detail of details) {
        ctx.fillText(wrapLines(detail, inner, measure, 1)[0] ?? '', x + w / 2, ty + 1);
        ty += 14;
      }
      ctx.restore();
    }
  });

  // Footer.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = MUTED;
  ctx.font = font(400, 12);
  const made = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
  ctx.fillText(`ClassHub · Saved ${made}`, PAD, height - PAD + 4);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be made.'))), 'image/png'));
}
