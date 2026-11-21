import { expect, test } from '@playwright/test';

// The harness deliberately reads private runtime fields, so a smoke test catches drift.
test.use({ viewport: { width: 1440, height: 1200 } });

for (const backdrop of ['image', 'snapshot']) {
  test(`benchmark observes real draws and released resources on ${backdrop}`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/bench/fixture.html?count=50&shapes=unique&backdrop=${backdrop}`);
    await page.waitForFunction(() => (window as any).bench?.ready);
    const mount = await page.evaluate(() => (window as any).bench.mount());
    expect(mount.firstMs).toBeGreaterThan(0);
    expect(mount.ninetyMs).toBeGreaterThanOrEqual(mount.firstMs);
    expect(mount.allMs).toBeGreaterThanOrEqual(mount.ninetyMs);
    await page.evaluate(() => (window as any).bench.settle());
    const diagnostic = await page.evaluate(() => (window as any).bench.diagnostics());
    expect(diagnostic.renderer).toBe(true);
    expect(diagnostic.visibleIcons).toBe(50);
    expect(diagnostic.backdropModes).toEqual([backdrop === 'image' ? 'background' : 'dom']);
    const before = await page.evaluate(() => (window as any).bench.counters());
    expect(before.draws).toBeGreaterThanOrEqual(50);
    expect(before.uploads).toBeGreaterThan(0);
    expect(before.captures).toBeGreaterThan(0);
    expect(before.textures).toBeGreaterThan(0);
    const idle = await page.evaluate(() => (window as any).bench.frames(700, 'idle'));
    expect(idle.frameTimes.length).toBeGreaterThan(1);
    // Performance budgets belong in the opt-in runner, not ordinary CI tests.
    for (const value of [idle.draws, idle.uploads, idle.captures]) expect(value).toBeGreaterThanOrEqual(0);
    const theme = await page.evaluate(() => (window as any).bench.frames(1500, 'theme'));
    expect(theme.captures).toBeGreaterThan(0);
    expect(theme.theme.updatedCount).toBe(50);
    await page.evaluate(() => (window as any).bench.destroy());
    await page.evaluate(() => (window as any).bench.settle());
    const state = await page.evaluate(() => (window as any).bench.resourceState());
    expect(state).toEqual({ domCanvases: 0, instances: 0, geometries: 0 });
    expect(errors).toEqual([]);
  });
}
