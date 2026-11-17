// Writes the icon library of the playground: every icon of 21 open icon sets, from the
// Iconify JSON packages (devDependencies). Each set is split into small files so the page
// only downloads what it shows:
//   sets/index.json            the sets: name, licence, author, count, samples
//   sets/<prefix>/names.json   every icon name, in order
//   sets/<prefix>/<n>.json     icons n*CHUNK .. (n+1)*CHUNK-1: [name, body, width?, height?, left?, top?]
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
export const CHUNK = 300;

/** In the order they are listed; the most used general-purpose sets first. */
export const SETS = [
  'lucide', 'ph', 'tabler', 'mdi', 'material-symbols', 'heroicons', 'bi', 'ri', 'fa6-solid', 'fa6-regular',
  'fa6-brands', 'ion', 'bx', 'feather', 'iconoir', 'radix-icons', 'octicon', 'solar', 'mingcute', 'carbon', 'simple-icons',
];

export async function writeLibrary(out) {
  const dir = join(out, 'sets');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const index = [];
  for (const prefix of SETS) {
    const data = require(`@iconify-json/${prefix}/icons.json`);
    const info = require(`@iconify-json/${prefix}/info.json`);
    const width = data.width ?? 16;
    const height = data.height ?? 16;
    const names = Object.keys(data.icons).filter((name) => !data.icons[name].hidden).sort();
    const rows = names.map((name) => {
      const icon = data.icons[name];
      const row = [name, icon.body];
      const w = icon.width ?? width;
      const h = icon.height ?? height;
      if (w !== width || h !== height || icon.left || icon.top) row.push(w, h, icon.left ?? 0, icon.top ?? 0);
      return row;
    });
    await mkdir(join(dir, prefix), { recursive: true });
    await writeFile(join(dir, prefix, 'names.json'), JSON.stringify(names));
    for (let c = 0; c * CHUNK < rows.length; c++)
      await writeFile(join(dir, prefix, `${c}.json`), JSON.stringify(rows.slice(c * CHUNK, (c + 1) * CHUNK)));
    index.push({
      prefix,
      name: info.name,
      total: names.length,
      width,
      height,
      license: info.license?.spdx ?? info.license?.title ?? '',
      licenseUrl: info.license?.url ?? '',
      author: info.author?.name ?? '',
      authorUrl: info.author?.url ?? '',
      samples: (info.samples ?? []).filter((name) => names.includes(name)),
    });
  }
  await writeFile(join(dir, 'index.json'), JSON.stringify(index));
  return index;
}
