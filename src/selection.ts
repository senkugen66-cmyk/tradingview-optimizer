import type { OptimizationGoal, OptimizationMetrics, OptimizationRun } from './types';

/**
 * Best-run selection, shared by the content script (optimization loop) and the
 * optimizer UI so both always agree on which run is "best".
 */

/** Goal value from a metrics object; drawdown is negated so that higher is always better. */
export function goalValue(metrics: OptimizationMetrics, goal: OptimizationGoal): number {
  const value = metrics[goal as keyof OptimizationMetrics] as number;
  return goal === 'maxDrawdownPercent' ? -Math.abs(value) : value;
}

/** Compare two runs on their primary (`metrics`) values for the optimization goal. */
export function isBetterRun(a: OptimizationRun, b: OptimizationRun, goal: OptimizationGoal): boolean {
  return goalValue(a.metrics, goal) > goalValue(b.metrics, goal);
}

/**
 * Pick the best run of a walk-forward sweep using In-Sample metrics only.
 *
 * Out-of-Sample results must never influence which parameters are chosen,
 * otherwise the reported OOS performance is no longer out of sample.
 */
export function selectBestByInSample(runs: OptimizationRun[], goal: OptimizationGoal): OptimizationRun | null {
  let best: OptimizationRun | null = null;
  for (const run of runs) {
    const metrics = run.inSampleMetrics ?? run.metrics;
    if (!best || goalValue(metrics, goal) > goalValue(best.inSampleMetrics ?? best.metrics, goal)) {
      best = run;
    }
  }
  return best;
}
