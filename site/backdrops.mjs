// Turns the full-size backdrop images in site/backdrops/raw/ into what the site serves:
// <name>.webp (2560 px wide) and <name>-thumb.webp (160 px). Needs ffmpeg.
// The raw files are generated images and stay out of git; the .webp files are committed.
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'backdrops');
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

for (const file of await readdir(join(dir, 'raw'))) {
  const match = file.match(/^([a-z0-9-]+)\.(png|jpe?g|webp)$/i);
  if (!match) continue;
  const name = match[1];
  const input = join(dir, 'raw', file);
  ffmpeg('-i', input, '-vf', "scale='min(2560,iw)':-2:flags=lanczos", '-c:v', 'libwebp', '-q:v', '82', join(dir, `${name}.webp`));
  ffmpeg('-i', input, '-vf', 'scale=160:-2:flags=lanczos', '-c:v', 'libwebp', '-q:v', '80', join(dir, `${name}-thumb.webp`));
  console.log(name);
}
