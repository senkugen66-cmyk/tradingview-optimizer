import { describe, expect, test } from 'bun:test';
import { goalValue, isBetterRun, selectBestByInSample } from '../src/selection';
import type { OptimizationMetrics, OptimizationRun } from '../src/types';

function metrics(over: Partial<OptimizationMetrics>): OptimizationMetrics {
  return {
    netProfit: 0, netProfitPercent: 0, grossProfit: 0, grossLoss: 0, maxDrawdown: 0,
    maxDrawdownPercent: 0, sharpeRatio: 0, sortinoRatio: 0, profitFactor: 0, totalTrades: 10,
    winningTrades: 0, losingTrades: 0, winRate: 0, avgTrade: 0, avgTradePercent: 0,
    largestWin: 0, largestLoss: 0, ...over,
  };
}

function run(n: number, is: Partial<OptimizationMetrics>, oos?: Partial<OptimizationMetrics>): OptimizationRun {
  const m = metrics(is);
  return {
    runNumber: n, parameters: { p: n }, metrics: m, inSampleMetrics: m,
    outOfSampleMetrics: oos ? metrics(oos) : undefined, timestamp: '', duration: 0,
  };
}

describe('goalValue / isBetterRun', () => {
  test('higher is better for ratio goals', () => {
    expect(isBetterRun(run(1, { sharpeRatio: 2 }), run(2, { sharpeRatio: 1 }), 'sharpeRatio')).toBe(true);
  });
  test('smaller absolute drawdown is better', () => {
    expect(goalValue(metrics({ maxDrawdownPercent: 5 }), 'maxDrawdownPercent')).toBe(-5);
    expect(isBetterRun(run(1, { maxDrawdownPercent: 3 }), run(2, { maxDrawdownPercent: 8 }), 'maxDrawdownPercent')).toBe(true);
  });
});

describe('selectBestByInSample (regression for audit C1)', () => {
  test('OOS performance never changes the selected run', () => {
    const runs = [
      run(1, { sharpeRatio: 2.0 }, { sharpeRatio: -1.0 }),   // best IS, poor OOS
      run(2, { sharpeRatio: 1.5 }, { sharpeRatio: 3.0 }),    // weaker IS, great OOS
    ];
    // The old 0.4*IS + 0.6*OOS rule picked run 2; selection must use IS only.
    expect(selectBestByInSample(runs, 'sharpeRatio')?.runNumber).toBe(1);
  });

  test('zero-edge simulation: OOS of the IS-selected run averages ~0', () => {
    let seed = 42;
    const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
    let sum = 0;
    const trials = 2000;
    for (let t = 0; t < trials; t++) {
      const runs = Array.from({ length: 50 }, (_, k) =>
        run(k + 1, { netProfitPercent: gauss() }, { netProfitPercent: gauss() }));
      sum += selectBestByInSample(runs, 'netProfitPercent')!.outOfSampleMetrics!.netProfitPercent;
    }
    expect(Math.abs(sum / trials)).toBeLessThan(0.1);   // was ~ +1.8 with the old rule (audit A9)
  });
});
