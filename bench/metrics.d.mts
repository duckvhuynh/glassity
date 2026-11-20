export interface Interval { start: number; end: number }
export interface FrameStats { count: number; p50Ms: number | null; p95Ms: number | null; over33MsPercent: number | null }
export interface CpuStats { samplesMs?: number[]; p50Ms?: number | null; p95Ms: number | null }
export interface CpuProfile {
  nodes: { id: number; children?: number[]; callFrame?: { url?: string } }[];
  samples?: number[];
  timeDeltas?: number[];
}
export interface Fixture { id: string; count: number; shapes?: string; backdrop?: string; dpr?: number }
export interface LongTask { startTime: number; duration: number; glassitySampledMs?: number }
export interface Scenario {
  draws?: number;
  uploads?: number;
  captures?: number;
  frames?: FrameStats;
  cpu?: CpuStats;
  firstUpdatedMs?: number | null;
  allUpdatedMs?: number | null;
}
export interface ResourceSnapshot { heapBytes: number; canvases: number; textures: number; domCanvases: number; instances: number; geometries: number }
export interface Run {
  fixture: Fixture;
  repeat?: number;
  mount?: { firstMs: number | null; ninetyMs: number | null; allMs: number | null };
  scenarios?: Partial<Record<'mount' | 'idle' | 'scroll' | 'pointer' | 'theme', Scenario>>;
  longTasks?: { duration: number }[];
  resources?: { before: ResourceSnapshot; after: ResourceSnapshot; cycles: number };
  error?: string;
}
export interface SummaryScenario {
  draws: number | null; uploads: number | null; captures: number | null;
  frameCount: number | null; frameP50Ms: number | null; frameP95Ms: number | null;
  over33MsPercent: number | null; cpuP95Ms: number | null;
  firstUpdatedMs: number | null; allUpdatedMs: number | null;
}
export interface Summary {
  fixture: Fixture;
  runs: number;
  successfulRuns: number;
  errors: string[];
  mount: { firstMs: number | null; ninetyMs: number | null; allMs: number | null };
  scenarios: Record<'mount' | 'idle' | 'scroll' | 'pointer' | 'theme', SummaryScenario>;
  longTaskMaxMs: number | null;
  longTaskCount: number | null;
  resources: Record<keyof ResourceSnapshot, { before: number | null; after: number | null; delta: number | null }>;
  cycles: number | null;
}
export type Verdict = 'PASS' | 'FAIL' | 'INCOMPLETE' | 'N/A';
export function percentile(values: number[], p: number): number | null;
export function median(values: number[]): number | null;
export function frameStats(frameTimes: number[]): FrameStats;
export function attributeProfile(profile: CpuProfile, originMs: number): Interval[];
export function cpuFrames(intervals: Interval[], frameTimes: number[]): CpuStats;
export function attributeLongTasks(tasks: LongTask[], intervals: Interval[]): LongTask[];
export function aggregateRuns(runs: Run[]): Summary[];
export function evaluateBudgets(summary: Summary): Record<'cpu' | 'scrolling' | 'idle' | 'longTasks' | 'mount' | 'resources', Verdict>;
export function markdownReport(input: { metadata: Record<string, unknown>; runs: Run[] }): string;
