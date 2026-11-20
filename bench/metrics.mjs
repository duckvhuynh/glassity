/** Nearest-rank percentile; missing observations stay missing in the report. */
export function percentile(values, p) {
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new RangeError('Percentile must be between 0 and 100');
  if (!values.length) return null;
  if (values.some((value) => !Number.isFinite(value))) throw new TypeError('Expected finite observations');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p / 100 * sorted.length) - 1)];
}

export function median(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function frameStats(frameTimes) {
  const intervals = frameTimes.slice(1).map((time, index) => time - frameTimes[index]);
  return {
    count: intervals.length,
    p50Ms: percentile(intervals, 50),
    p95Ms: percentile(intervals, 95),
    over33MsPercent: intervals.length ? intervals.filter((duration) => duration > 33).length / intervals.length * 100 : null,
  };
}

/** originMs is performance.now() at profile.startTime, not at the first sample. */
export function attributeProfile(profile, originMs) {
  if (!Number.isFinite(originMs) || !profile.samples?.length) throw new Error('CPU profile has no samples or clock origin');
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const library = new Map();
  function belongsToLibrary(id) {
    if (library.has(id)) return library.get(id);
    const node = nodes.get(id);
    const own = /\/dist\//.test(node?.callFrame?.url ?? '');
    const parent = parents.get(id);
    const result = own || (parent !== undefined && belongsToLibrary(parent));
    library.set(id, result);
    return result;
  }
  let timestamp = originMs;
  const intervals = [];
  for (let i = 0; i < (profile.samples ?? []).length; i++) {
    const duration = profile.timeDeltas?.[i] / 1000;
    if (!Number.isFinite(duration) || duration < 0) throw new Error('CPU profile has an invalid sample delta');
    const end = timestamp + duration;
    if (belongsToLibrary(profile.samples[i])) intervals.push({ start: timestamp, end });
    timestamp = end;
  }
  return intervals;
}

function overlap(start, end, intervals) {
  let total = 0;
  for (const interval of intervals) {
    if (interval.start >= end) break;
    total += Math.max(0, Math.min(end, interval.end) - Math.max(start, interval.start));
  }
  return total;
}

export function cpuFrames(intervals, frameTimes) {
  const samplesMs = frameTimes.slice(1).map((end, index) => overlap(frameTimes[index], end, intervals));
  return { samplesMs, p50Ms: percentile(samplesMs, 50), p95Ms: percentile(samplesMs, 95) };
}

/** Charge the whole task conservatively when any sample has a library ancestor. */
export function attributeLongTasks(tasks, intervals) {
  return tasks.map((task) => ({
    startTime: task.startTime,
    duration: task.duration,
    glassitySampledMs: overlap(task.startTime, task.startTime + task.duration, intervals),
  })).filter((task) => task.glassitySampledMs > 0);
}

function medianAt(runs, select) {
  return median(runs.map(select));
}

export function aggregateRuns(runs) {
  const groups = new Map();
  for (const run of runs) {
    const id = run.fixture.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(run);
  }
  return [...groups.values()].map((group) => {
    const successful = group.filter((run) => !run.error);
    const scenarios = {};
    for (const name of ['mount', 'idle', 'scroll', 'pointer', 'theme']) {
      const select = (run) => run.scenarios?.[name];
      scenarios[name] = {
        draws: medianAt(successful, (run) => select(run)?.draws),
        uploads: medianAt(successful, (run) => select(run)?.uploads),
        captures: medianAt(successful, (run) => select(run)?.captures),
        frameCount: medianAt(successful, (run) => select(run)?.frames?.count),
        frameP50Ms: medianAt(successful, (run) => select(run)?.frames?.p50Ms),
        frameP95Ms: medianAt(successful, (run) => select(run)?.frames?.p95Ms),
        over33MsPercent: medianAt(successful, (run) => select(run)?.frames?.over33MsPercent),
        cpuP95Ms: medianAt(successful, (run) => select(run)?.cpu?.p95Ms),
        firstUpdatedMs: medianAt(successful, (run) => select(run)?.firstUpdatedMs),
        allUpdatedMs: medianAt(successful, (run) => select(run)?.allUpdatedMs),
      };
    }
    const resources = {};
    for (const key of ['heapBytes', 'canvases', 'textures', 'domCanvases', 'instances', 'geometries']) {
      resources[key] = {
        before: medianAt(successful, (run) => run.resources?.before?.[key]),
        after: medianAt(successful, (run) => run.resources?.after?.[key]),
        // Median the paired differences, not the difference of independently sorted medians.
        delta: medianAt(successful, (run) => run.resources?.after?.[key] - run.resources?.before?.[key]),
      };
    }
    return {
      fixture: group[0].fixture,
      runs: group.length,
      successfulRuns: successful.length,
      errors: group.filter((run) => run.error).map((run) => String(run.error)),
      mount: {
        firstMs: medianAt(successful, (run) => run.mount?.firstMs),
        ninetyMs: medianAt(successful, (run) => run.mount?.ninetyMs),
        allMs: medianAt(successful, (run) => run.mount?.allMs),
      },
      scenarios,
      longTaskMaxMs: medianAt(successful, (run) => run.longTasks ? Math.max(0, ...run.longTasks.map((task) => task.duration)) : undefined),
      longTaskCount: medianAt(successful, (run) => run.longTasks?.length),
      resources,
      cycles: medianAt(successful, (run) => run.resources?.cycles),
    };
  });
}

function verdict(values, test, complete) {
  if (!complete || values.some((value) => !Number.isFinite(value))) return 'INCOMPLETE';
  return test(values) ? 'PASS' : 'FAIL';
}

export function evaluateBudgets(summary) {
  const complete = summary.successfulRuns === 3 && summary.runs === 3;
  const activeCpu = ['idle', 'scroll', 'pointer', 'theme'].map((name) => summary.scenarios[name].cpuP95Ms);
  const idle = summary.scenarios.idle;
  const resourceDeltas = ['heapBytes', 'canvases', 'textures', 'domCanvases', 'instances', 'geometries'].map((key) => summary.resources[key].delta);
  return {
    cpu: summary.fixture.count === 77 ? verdict(activeCpu, (values) => values.every((value) => value <= 4), complete) : 'N/A',
    scrolling: verdict([summary.scenarios.scroll.over33MsPercent], ([value]) => value <= 1, complete),
    idle: verdict([idle.draws, idle.uploads, idle.captures], (values) => values.every((value) => value === 0), complete),
    longTasks: verdict([summary.longTaskMaxMs], ([value]) => value <= 50, complete),
    mount: verdict([summary.mount.ninetyMs], ([value]) => value <= 500, complete),
    resources: verdict([...resourceDeltas, summary.cycles], (values) => values.at(-1) === 100 && values.slice(0, -1).every((value) => value <= 0), complete),
  };
}

const number = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : 'N/A';
const safe = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

export function markdownReport({ metadata, runs }) {
  const summaries = aggregateRuns(runs);
  const lines = [
    '# glassity performance baseline',
    '',
    'Baseline protocol: median of three independent runs per fixture. Each percentile is calculated within a run, then the three percentiles are medianed. Missing or failed runs never pass a budget.',
    '',
    '## Environment',
    '',
    ...Object.entries(metadata).map(([key, value]) => `- **${safe(key)}:** ${safe(typeof value === 'object' ? JSON.stringify(value) : value)}`),
    '',
    ...(metadata.fullMatrix === false ? ['**Smoke run:** this is a selected fixture/repeat/cycle subset, not the complete baseline.', ''] : []),
    ...(metadata.fatalError || !runs.length ? ['**BLOCKED / NOT MEASURED:** ' + safe(metadata.fatalError ?? 'No measurements completed.'), '', 'All six budgets (CPU, scrolling, idle, long tasks, mount, resources) are INCOMPLETE. No pass or failure can be inferred.', ''] : []),
    `Completed measurements: **${runs.filter((run) => !run.error).length}/${metadata.expectedRunCount ?? runs.length}** (${runs.length} attempted).`,
    '',
    ...(Number.isFinite(metadata.expectedRunCount) && runs.filter((run) => !run.error).length < metadata.expectedRunCount ? ['**INCOMPLETE MATRIX:** the full requested baseline has not completed. Individual fixture verdicts below do not constitute a complete baseline.', ''] : []),
    ...(!runs.length ? [
      '## Unmeasured budgets',
      '',
      '| Budget | Target | Result |',
      '| --- | --- | --- |',
      '| CPU (77 visible icons) | p95 ≤4 ms/frame | NOT MEASURED |',
      '| Scrolling | ≤1% frames over 33 ms | NOT MEASURED |',
      '| Settled idle | 0 draws, 0 uploads, 0 captures | NOT MEASURED |',
      '| Attributable main-thread tasks | No task over 50 ms | NOT MEASURED |',
      '| Initial visible glass | 90% drawn within 500 ms | NOT MEASURED |',
      '| Resources | No growth after 100 cycles | NOT MEASURED |',
      '',
    ] : []),
    '## Budgets',
    '',
    '| Fixture | CPU ≤4 ms (77 icons) | Scroll >33 ms ≤1% | Idle 0 draws/uploads/captures | Tasks ≤50 ms | 90% ≤500 ms | No growth / 100 cycles |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...summaries.map((summary) => `| ${safe(summary.fixture.id)} | ${Object.values(evaluateBudgets(summary)).join(' | ')} |`),
    '',
    '## Mount and scrolling',
    '',
    '| Fixture | Runs | First glass ms | 90% glass ms | All glass ms | Scroll frames | Frame p50 ms | Frame p95 ms | >33 ms % | Glassity CPU p95 ms (idle / scroll / pointer / theme) | Long-task max ms / count |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...summaries.map((summary) => {
      const scroll = summary.scenarios.scroll;
      const cpu = ['idle', 'scroll', 'pointer', 'theme'].map((name) => number(summary.scenarios[name].cpuP95Ms)).join(' / ');
      return `| ${safe(summary.fixture.id)} | ${summary.successfulRuns}/${summary.runs} | ${number(summary.mount.firstMs)} | ${number(summary.mount.ninetyMs)} | ${number(summary.mount.allMs)} | ${number(scroll.frameCount, 0)} | ${number(scroll.frameP50Ms)} | ${number(scroll.frameP95Ms)} | ${number(scroll.over33MsPercent)} | ${cpu} | ${number(summary.longTaskMaxMs)} / ${number(summary.longTaskCount, 0)} |`;
    }),
    '',
    '## Idle and resources',
    '',
    '| Fixture | Idle draws / uploads / captures | Heap before / after / delta (bytes) | Canvases before / after / delta | Textures before / after / delta | DOM canvases / instances / geometries delta | Completed cycles |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...summaries.map((summary) => {
      const idle = summary.scenarios.idle;
      const resources = ['heapBytes', 'canvases', 'textures'].map((key) => ['before', 'after', 'delta'].map((field) => number(summary.resources[key][field], 0)).join(' / '));
      return `| ${safe(summary.fixture.id)} | ${[idle.draws, idle.uploads, idle.captures].map((value) => number(value, 0)).join(' / ')} | ${resources.join(' | ')} | ${['domCanvases', 'instances', 'geometries'].map((key) => number(summary.resources[key].delta, 0)).join(' / ')} | ${number(summary.cycles, 0)} |`;
    }),
    '',
    '## Theme change diagnostics',
    '',
    '| Fixture | Draws | Uploads | Captures | First updated glass ms | All updated glass ms |',
    '| --- | --- | --- | --- | --- | --- |',
    ...summaries.map((summary) => {
      const theme = summary.scenarios.theme;
      return `| ${safe(summary.fixture.id)} | ${number(theme.draws, 0)} | ${number(theme.uploads, 0)} | ${number(theme.captures, 0)} | ${number(theme.firstUpdatedMs)} | ${number(theme.allUpdatedMs)} |`;
    }),
    '',
    'Theme latencies require an actual backdrop-version change; N/A is not a successful redraw.',
    '',
    '## Interpretation',
    '',
    '- CPU is sampled main-thread time with a `/dist/` script anywhere in the CDP profile stack, including native descendants. It excludes unrelated fixture code. Sampling estimates can miss short work; these are not exact CPU timings or GPU timings.',
    '- Frame intervals use consecutive requestAnimationFrame timestamps during scripted scrolling. A long task is conservatively attributed when it overlaps a library sample; the table charges its entire duration, not just the sampled portion. Unattributed long tasks remain available in raw results when collected.',
    '- CPU is checked at 77 visible icons for idle, scrolling, pointer movement and theme change. Cold mounting is checked separately by the 90% and long-task budgets. Scroll, idle, mount and resource budgets apply to every fixture.',
    '- Resource before/after columns are independent medians; delta is the median of paired changes, so it need not equal subtraction of the displayed columns. Heap and canvas counts are taken after forced garbage collection. Any positive median paired resource delta fails the strict no-growth target; a heap increase alone does not prove a leak. Native GPU allocation is not measured by JS heap. Texture counts track explicit WebGL creation and deletion.',
    '- Local scheduling, display refresh rate, browser instrumentation and GPU driver behavior affect results. Compare on the same machine and renderer; software rendering is not representative of a desktop GPU.',
  ];
  for (const summary of summaries) {
    if (summary.errors.length) lines.push('', `### ${safe(summary.fixture.id)} errors`, '', ...summary.errors.map((error) => `- ${safe(error)}`));
  }
  return lines.join('\n') + '\n';
}
