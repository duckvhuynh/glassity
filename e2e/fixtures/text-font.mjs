// Original test-only outlines, distributed under the repository's MIT licence.
// Rebuild with: node e2e/fixtures/text-font.mjs
// "home" is a standard GSUB liga substitution; U+E000 maps to the same glyph.
import { writeFile } from 'node:fs/promises';

const u16 = (...values) => {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((value, i) => out.writeUInt16BE(value & 0xffff, i * 2));
  return out;
};
const u32 = (...values) => {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => out.writeUInt32BE(value >>> 0, i * 4));
  return out;
};
const join = (...parts) => Buffer.concat(parts);
const tag = (value) => Buffer.from(value, 'ascii');
const pad = (data) => join(data, Buffer.alloc((4 - data.length % 4) % 4));
const checksum = (data) => {
  const full = pad(data);
  let sum = 0;
  for (let i = 0; i < full.length; i += 4) sum = (sum + full.readUInt32BE(i)) >>> 0;
  return sum;
};

function glyph(contours) {
  if (!contours.length) return Buffer.alloc(0);
  const points = contours.flat();
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  let count = 0;
  const ends = contours.map((contour) => (count += contour.length) - 1);
  let x = 0, y = 0;
  const dx = [], dy = [];
  for (const point of points) {
    dx.push(point[0] - x);
    dy.push(point[1] - y);
    [x, y] = point;
  }
  return pad(join(
    u16(contours.length, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)),
    u16(...ends), u16(0), Buffer.alloc(points.length, 1), u16(...dx), u16(...dy),
  ));
}

const box = [[40, 0], [40, 700], [240, 700], [240, 0]];
const house = [
  [100, 0], [100, 420], [0, 420], [500, 800], [1000, 420],
  [900, 420], [900, 0], [600, 0], [600, 300], [400, 300], [400, 0],
];
const outlines = [glyph([box]), glyph([]), glyph([box]), glyph([box]), glyph([box]), glyph([box]), glyph([house])];
const advances = [300, 300, 300, 300, 300, 300, 1000];
let offset = 0;
const locations = outlines.map((outline) => {
  const start = offset;
  offset += outline.length;
  return start;
});
locations.push(offset);

const head = join(
  u32(0x00010000, 0x00010000, 0, 0x5f0f3cf5), u16(3, 1000),
  Buffer.alloc(16), u16(0, 0, 1000, 800, 0, 8, 2, 1, 0),
);
const hhea = join(
  u32(0x00010000), u16(800, -200, 0, 1000, 0, 0, 1000, 1, 0, 0),
  Buffer.alloc(8), u16(0, outlines.length),
);
const maxp = join(u32(0x00010000), u16(outlines.length, 11, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0));
const hmtx = join(...advances.map((advance, i) => u16(advance, i === 1 || i === 6 ? 0 : 40)));
const mappings = [[0x20, 1], [0x65, 2], [0x68, 3], [0x6d, 4], [0x6f, 5], [0xe000, 6], [0xffff, 0]];
const segments = mappings.length;
const power = 2 ** Math.floor(Math.log2(segments));
const cmap4 = join(
  u16(4, 16 + segments * 8, 0, segments * 2, power * 2, Math.log2(power), segments * 2 - power * 2),
  u16(...mappings.map(([code]) => code)), u16(0),
  u16(...mappings.map(([code]) => code)),
  u16(...mappings.map(([code, id]) => id - code)),
  u16(...mappings.map(() => 0)),
);
const cmap = join(u16(0, 1, 3, 1), u32(12), cmap4);

const names = [
  [1, 'Glassity Test Icons'], [2, 'Regular'], [3, 'Glassity-Test-Icons-1'],
  [4, 'Glassity Test Icons Regular'], [5, 'Version 1.000'], [6, 'GlassityTestIcons-Regular'],
];
let stringOffset = 0;
const nameData = names.map(([id, value]) => {
  const data = u16(...Array.from(value, (c) => c.charCodeAt(0)));
  const record = u16(3, 1, 0x409, id, data.length, stringOffset);
  stringOffset += data.length;
  return { record, data };
});
const name = join(u16(0, names.length, 6 + names.length * 12), ...nameData.map((n) => n.record), ...nameData.map((n) => n.data));
const post = join(u32(0x00030000, 0), u16(-100, 50), u32(0, 0, 0, 0, 0));
const os2 = Buffer.alloc(96);
os2.writeUInt16BE(4, 0);
os2.writeInt16BE(400, 2);
os2.writeUInt16BE(400, 4);
os2.writeUInt16BE(5, 6);
os2.writeInt16BE(650, 10);
os2.writeInt16BE(600, 12);
os2.writeInt16BE(75, 16);
os2.writeInt16BE(650, 18);
os2.writeInt16BE(600, 20);
os2.writeInt16BE(350, 24);
os2.writeInt16BE(50, 26);
os2.writeInt16BE(300, 28);
os2.writeUInt32BE(1, 42);
tag('GLST').copy(os2, 58);
os2.writeUInt16BE(0x40, 62);
os2.writeUInt16BE(0x20, 64);
os2.writeUInt16BE(0xe000, 66);
os2.writeInt16BE(800, 68);
os2.writeInt16BE(-200, 70);
os2.writeUInt16BE(800, 74);
os2.writeUInt16BE(200, 76);
os2.writeUInt32BE(1, 78);
os2.writeInt16BE(700, 86);
os2.writeInt16BE(800, 88);
os2.writeUInt16BE(0x20, 92);
os2.writeUInt16BE(4, 94);

// One DFLT script, one liga feature, one type-4 lookup: h + o m e -> house.
const scriptList = join(u16(1), tag('DFLT'), u16(8), u16(4, 0), u16(0, 0xffff, 1, 0));
const featureList = join(u16(1), tag('liga'), u16(8), u16(0, 1, 0));
const coverage = u16(1, 1, 3);
const ligatureSet = join(u16(1, 4), u16(6, 4, 5, 4, 2));
const ligature = join(u16(1, 8, 1, 14), coverage, ligatureSet);
const lookup = join(u16(4, 0, 1, 8), ligature);
const lookupList = join(u16(1, 4), lookup);
const gsub = join(
  u32(0x00010000), u16(10, 10 + scriptList.length, 10 + scriptList.length + featureList.length),
  scriptList, featureList, lookupList,
);
const tables = new Map([
  ['OS/2', os2], ['cmap', cmap], ['glyf', join(...outlines)], ['head', head],
  ['hhea', hhea], ['hmtx', hmtx], ['loca', u32(...locations)], ['maxp', maxp],
  ['name', name], ['post', post], ['GSUB', gsub],
]);
const entries = [...tables].sort(([a], [b]) => a < b ? -1 : 1);
const tablePower = 2 ** Math.floor(Math.log2(entries.length));
const header = join(u32(0x00010000), u16(entries.length, tablePower * 16, Math.log2(tablePower), entries.length * 16 - tablePower * 16));
let tableOffset = 12 + entries.length * 16;
let headOffset = 0;
const directory = entries.map(([name, data]) => {
  const record = join(tag(name), u32(checksum(data), tableOffset, data.length));
  if (name === 'head') headOffset = tableOffset;
  tableOffset += pad(data).length;
  return record;
});
const font = join(header, ...directory, ...entries.map(([, data]) => pad(data)));
font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8);
await writeFile(new URL('./text-icons.ttf', import.meta.url), font);
