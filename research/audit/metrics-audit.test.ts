/**
 * Audit evidence (characterisation tests): each test pins down CURRENT behaviour of
 * src/trades.ts that the audit flags as a methodology issue. They pass today; when an
 * issue is fixed, the matching test should be inverted into a regression test.
 *
 * Run: bun test research/audit
 */
import { describe, expect, test } from 'bun:test';
import { calculateMetricsFromTrades, parseCSVTrades } from '../../src/trades';
import type { BacktestTrade } from '../../src/types';

const CAPITAL = 100_000;

/** Build closed trades from per-trade P&L in dollars (1% of capital = $1,000). */
function tradesFrom(pnls: number[], mae: number[] = []): BacktestTrade[] {
  let cum = 0;
  return pnls.map((pl, i) => {
    cum += pl;
    return {
      tradeNumber: i + 1, type: 'Long', signal: 'E', entryDate: '', entryPrice: 100,
      exitDate: '', exitPrice: 100, contracts: 1, profitLoss: pl,
      profitLossPercent: (pl / CAPITAL) * 100, cumulativeProfit: cum,
      cumulativeProfitPercent: (cum / CAPITAL) * 100, runUp: 0, drawdown: mae[i] ?? 0,
    };
  });
}

describe('A1 Sharpe/Sortino are per-trade and scale with trade count', () => {
  test('identical return distribution, 4x the trades -> Sharpe doubles', () => {
    const base = [1500, -1000, 1200, -800, 900];                    // per-trade P&L pattern
    const s10 = calculateMetricsFromTrades(tradesFrom(Array(2).fill(base).flat()), CAPITAL).sharpeRatio;
    const s40 = calculateMetricsFromTrades(tradesFrom(Array(8).fill(base).flat()), CAPITAL).sharpeRatio;
    // mean/std are (almost) the same; only sqrt(min(252, N)) changes: sqrt(40/10) = 2
    expect(s40 / s10).toBeGreaterThan(1.9);
    expect(s40 / s10).toBeLessThan(2.2);
  });
});

describe('A2 Max drawdown ignores open-trade (intra-trade) losses', () => {
  test('a trade that was down $40k but closed +$1k shows 0% drawdown', () => {
    const m = calculateMetricsFromTrades(tradesFrom([1000], [40_000]), CAPITAL);
    expect(m.maxDrawdownPercent).toBe(0);
  });
});

describe('A3 maxDrawdownPercent is the % at the largest DOLLAR drawdown, not the largest % drawdown', () => {
  test('early -20% vs later larger-dollar but smaller-% dip', () => {
    // equity 100k -> 80k (-20%), then up to 300k, then down to 250k (-50k = -16.7%)
    const m = calculateMetricsFromTrades(tradesFrom([-20_000, 220_000, -50_000]), CAPITAL);
    expect(m.maxDrawdown).toBe(50_000);
    expect(m.maxDrawdownPercent).toBeCloseTo(16.67, 1);   // true max % drawdown is 20%
  });
});

describe('A4 Sortino downside deviation uses only losing trades, divided by (losers - 1)', () => {
  test('differs from the standard target-downside deviation over all N trades', () => {
    const pnls = [3000, -1000, 2000, -1000, 1000, 500];
    const m = calculateMetricsFromTrades(tradesFrom(pnls), CAPITAL);
    const r = pnls.map((p) => (p / CAPITAL) * 100);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const ddStd = Math.sqrt(r.reduce((s, x) => s + Math.min(x, 0) ** 2, 0) / r.length);
    const standard = (mean / ddStd) * Math.sqrt(r.length);
    expect(Math.abs(m.sortinoRatio - standard) / standard).toBeGreaterThan(0.5);  // > 50% apart
  });
});

describe('A5 A failed extraction (no trades) yields all-zero metrics', () => {
  test('zero drawdown and zero profit, indistinguishable from a real flat run', () => {
    const m = calculateMetricsFromTrades([], CAPITAL);
    expect(m.maxDrawdownPercent).toBe(0);   // "Min Drawdown" goal: |0| beats every real run
    expect(m.netProfitPercent).toBe(0);     // beats every losing run on Net Profit / Sharpe
    expect(m.totalTrades).toBe(0);
  });
});

describe('A6 An open trade (entry row only) is counted as a completed trade', () => {
  test('entry-only row is parsed as a trade with its P&L', () => {
    const csv = [
      'Trade number,Type,Date and time,Signal,Price USD,Size (qty),Net PnL USD,Return %,Cumulative PnL USD,Cumulative PnL %',
      '1,Exit long,2026-01-02 10:00,Close,101,1,1000,1,1000,1',
      '1,Entry long,2026-01-02 09:00,E,100,1,1000,1,1000,1',
      '2,Entry long,2026-01-03 09:00,E,100,1,-500,-0.5,500,0.5',
    ].join('\n');
    const t = parseCSVTrades(csv);
    expect(t.length).toBe(2);
    expect(t[1].exitDate).toBe('2026-01-03 09:00');   // the entry row stands in for the exit
  });
});

describe('A7 Blob-capture path looks for the old "Trade #" header', () => {
  test('current export header does not contain "Trade #"', () => {
    const current = 'Trade number,Type,Date and time,Signal,Price USD';   // Sept 2026 header (tests/trades.test.ts)
    expect(current.includes('Trade #')).toBe(false);   // content.ts:428 check fails -> strategy 2 never fires
  });
});

describe('A8 Numeric grid can silently drop the max value (float accumulation)', () => {
  test('copy of content.ts:1590 loop: min 0.1, max 0.3, step 0.1', () => {
    // Exact copy of the loop body in generateParameterCombinations (not exported).
    const values: number[] = [];
    for (let v = 0.1; v <= 0.3; v += 0.1) values.push(Math.round(v * 1e10) / 1e10);
    expect(values).toEqual([0.1, 0.2]);   // the user's max (0.3) is never tested
    // calculateTotalCombinations (optimizer-ui.ts:3399) has the same float issue, so the UI
    // consistently shows 2 combinations: the omission is silent, not a count mismatch.
    expect(Math.floor((0.3 - 0.1) / 0.1) + 1).toBe(2);
  });
});

describe('A9 Single walk-forward picks the "best" run using the OOS period', () => {
  test('zero-edge parameter sets: the selected run shows a positive "out-of-sample" result', () => {
    // Selection rule copied from content.ts:2714-2729: argmax(0.4 * IS + 0.6 * OOS) over ALL runs.
    // IS and OOS results are independent noise with mean 0 (no parameter has any edge).
    let seed = 42;
    const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
    let sumPickedOOS = 0;
    const trials = 2000;
    for (let t = 0; t < trials; t++) {
      let best = -Infinity, bestOOS = 0;
      for (let k = 0; k < 50; k++) {                 // 50 parameter combinations
        const is = gauss(), oos = gauss();
        const score = 0.4 * is + 0.6 * oos;
        if (score > best) { best = score; bestOOS = oos; }
      }
      sumPickedOOS += bestOOS;
    }
    // Honest OOS of a zero-edge strategy averages 0; the selected run averages ~ +1.8 sd.
    expect(sumPickedOOS / trials).toBeGreaterThan(1.5);
  });
});
