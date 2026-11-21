import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type BenchServer } from '../bench/server.mjs';

let server: BenchServer;
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server?.close(); });

describe('benchmark server', () => {
  it('serves package metadata needed to attach the versioned engine probe', async () => {
    const response = await fetch(server.url + '/package.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toMatchObject({ name: 'glassity' });
  });

  it.each([
    ['/bench/fixture.html', 'text/html'],
    ['/bench/fixture.mjs', 'text/javascript'],
    ['/bench/probe.mjs', 'text/javascript'],
    ['/bench/wallpaper.svg', 'image/svg+xml'],
  ])('serves %s with its browser MIME type', async (path, contentType) => {
    const response = await fetch(server.url + path);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(contentType);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.text()).length).toBeGreaterThan(0);
  });

  it.each(['/src/engine.ts', '/bench/..%5csrc%5cengine.ts', '/dist/..%5cREADME.md'])('refuses files outside its resolved allowlist: %s', async (path) => {
    const response = await fetch(server.url + path);
    // Backslashes are separators on Windows and nonexistent filenames on POSIX.
    expect([403, 404]).toContain(response.status);
    expect(await response.text()).toBe('');
  });
});
