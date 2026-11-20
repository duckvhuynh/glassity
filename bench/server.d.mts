export interface BenchServer { url: string; close(): Promise<void> }
export function startServer(): Promise<BenchServer>;
