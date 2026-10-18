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

// A2 (drawdown ignored open-trade losses) and A3 (% taken at the largest dollar drawdown) were
// fixed in the H2 commit; regression tests live in tests/trades.test.ts.

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

// A5 still describes trades.ts. Since the C2 fix, such runs are flagged invalidReason and are never
// eligible as best (regression tests in tests/selection.test.ts).
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

// A9 (single walk-forward selected the best run with 0.4*IS + 0.6*OOS) was fixed in the
// C1 commit; the regression test now lives in tests/selection.test.ts.
