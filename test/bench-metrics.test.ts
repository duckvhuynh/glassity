import { describe, expect, it } from 'vitest';

import { percentile, median, frameStats, attributeProfile, cpuFrames, attributeLongTasks, aggregateRuns, evaluateBudgets, markdownReport } from '../bench/metrics.mjs';

describe('benchmark metrics', () => {
  it('uses nearest rank, preserves empty samples, and counts only intervals over 33 ms', () => {
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(median([9, 1, 3])).toBe(3);
    expect(median([1, 3])).toBe(2);
    expect(percentile([], 95)).toBeNull();
    expect(frameStats([0, 16, 49, 83])).toEqual({ count: 3, p50Ms: 33, p95Ms: 34, over33MsPercent: 1 / 3 * 100 });
    expect(() => percentile([NaN], 95)).toThrow();
    expect(() => attributeProfile({ nodes: [], samples: [], timeDeltas: [] }, 0)).toThrow();
  });

  it('attributes native descendants and splits sampled time across frame boundaries', () => {
    const profile = {
      nodes: [
        { id: 1, callFrame: { url: '' }, children: [2, 4] },
        { id: 2, callFrame: { url: 'http://localhost/dist/index.js' }, children: [3] },
        { id: 3, callFrame: { url: '' } },
        { id: 4, callFrame: { url: 'http://localhost/bench/fixture.mjs' } },
      ],
      samples: [4, 3, 2],
      timeDeltas: [1000, 4000, 1000],
    };
    const intervals = attributeProfile(profile, 10);
    expect(intervals).toEqual([{ start: 11, end: 15 }, { start: 15, end: 16 }]);
    expect(cpuFrames(intervals, [10, 12, 16, 20])).toEqual({ samplesMs: [1, 4, 0], p50Ms: 1, p95Ms: 4 });
    expect(attributeLongTasks([{ startTime: 0, duration: 60 }, { startTime: 100, duration: 80 }], intervals))
      .toEqual([{ startTime: 0, duration: 60, glassitySampledMs: 5 }]);
  });

  it('does not turn missing observations or failed runs into passing budgets', () => {
    const summary = aggregateRuns([{ fixture: { id: 'missing', count: 77 }, error: 'WebGL unavailable' }])[0];
    expect(Object.values(evaluateBudgets(summary))).toEqual(Array(6).fill('INCOMPLETE'));
    expect(markdownReport({ metadata: { renderer: 'unknown' }, runs: [{ fixture: summary.fixture, error: 'WebGL unavailable' }] }))
      .toContain('WebGL unavailable');
  });

  it('shows every unmeasured target when startup is blocked', () => {
    const report = markdownReport({ metadata: { fatalError: 'spawn EPERM', expectedRunCount: 72, fullMatrix: true }, runs: [] });
    expect(report).toContain('spawn EPERM');
    expect(report).toContain('**0/72**');
    expect(report).toContain('INCOMPLETE MATRIX');
    expect(report.match(/\| NOT MEASURED \|/g)).toHaveLength(6);
  });

  it('medians per-run percentiles and paired resource deltas before applying strict budgets', () => {
    const runs = [0, 1, 2].map((index) => ({
      fixture: { id: '77-image-1', count: 77 },
      mount: { firstMs: 100, ninetyMs: [400, 600, 550][index], allMs: 900 },
      scenarios: {
        idle: { draws: 0, uploads: 0, captures: 0, cpu: { p95Ms: 0 } },
        scroll: { frames: { count: 100, p50Ms: 16, p95Ms: 20, over33MsPercent: 1 }, cpu: { p95Ms: [2, 3, 9][index] } },
        pointer: { cpu: { p95Ms: 4 } },
        theme: { cpu: { p95Ms: 4 } },
      },
      longTasks: index === 0 ? [{ duration: 100 }] : [],
      resources: {
        cycles: 100,
        before: { heapBytes: [100, 200, 300][index], canvases: 1, textures: 0, domCanvases: 0, instances: 0, geometries: 0 },
        after: { heapBytes: [110, 190, 305][index], canvases: 1, textures: 0, domCanvases: 0, instances: 0, geometries: 0 },
      },
    }));
    const summary = aggregateRuns(runs)[0];
    expect(summary.scenarios.scroll.cpuP95Ms).toBe(3);
    expect(summary.resources.heapBytes.delta).toBe(5);
    expect(evaluateBudgets(summary)).toEqual({ cpu: 'PASS', scrolling: 'PASS', idle: 'PASS', longTasks: 'PASS', mount: 'FAIL', resources: 'FAIL' });
    expect(markdownReport({ metadata: { renderer: 'local' }, runs })).toContain('550.00');
  });
});
