import { describe, expect, it } from 'vitest';
import { crc32, sheetNames, xlsxFile, zipStored } from './xlsx';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('sheetNames', () => {
  it('removes the characters Excel refuses and keeps names within 31 characters', () => {
    expect(sheetNames(['System Analysis and Design (IT 303*)'])).toEqual(['System Analysis and Design (IT']);
    expect(sheetNames(['A/B: [draft]?'])).toEqual(['A B draft']);
  });

  it('tells apart names that would be the same', () => {
    expect(sheetNames(['Math', 'math', 'Math'])).toEqual(['Math', 'math (2)', 'Math (3)']);
  });

  it('names an empty one by its position', () => {
    expect(sheetNames(['', '***'])).toEqual(['Sheet 1', 'Sheet 2']);
  });
});

describe('zipStored', () => {
  it('writes each file once in the data and once in the directory', () => {
    const zip = zipStored([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1);
    expect(zip.length).toBe(30 + 5 + 5 + 46 + 5 + 22);
    expect(text(zip.slice(35, 40))).toBe('hello');
  });
});

describe('xlsxFile', () => {
  it('has one worksheet per sheet, with numbers as numbers and text escaped', () => {
    const all = text(xlsxFile([
      { name: 'Operations Research', rows: [['Student', 'Absent'], ['Lim, Ana <3 & "co"', 2]] },
      { name: 'Software Engineering', rows: [['Student']] },
    ]));
    expect(all).toContain('xl/worksheets/sheet1.xml');
    expect(all).toContain('xl/worksheets/sheet2.xml');
    expect(all).toContain('<sheet name="Operations Research" sheetId="1" r:id="rId1"/>');
    expect(all).toContain('<c r="B2"><v>2</v></c>');
    expect(all).toContain('Lim, Ana &lt;3 &amp; &quot;co&quot;');
    expect(all).toContain('<c r="A1" s="1" t="inlineStr">');
  });

  it('refuses an empty workbook', () => {
    expect(() => xlsxFile([])).toThrow();
  });
});
