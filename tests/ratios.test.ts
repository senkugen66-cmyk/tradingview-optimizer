import { describe, expect, test } from 'bun:test';
import { parseTradeTimestamp } from '../src/dates';
import { calculateMetricsFromTrades, tradesPerYear } from '../src/trades';
import type { BacktestTrade } from '../src/types';

const CAPITAL = 100_000;
const DAY = 24 * 3600 * 1000;

/** Closed trades from per-trade P&L, one trade every `spacingDays` days from 2024-01-01. */
function datedTrades(pnls: number[], spacingDays = 1): BacktestTrade[] {
  const t0 = Date.UTC(2024, 0, 1, 10, 0);
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  let cum = 0;
  return pnls.map((pl, i) => {
    cum += pl;
    const entry = t0 + i * spacingDays * DAY;
    return {
      tradeNumber: i + 1, type: 'Long', signal: 'E', entryDate: fmt(entry), entryPrice: 100,
      exitDate: fmt(entry + 3600 * 1000), exitPrice: 100, contracts: 1, profitLoss: pl,
      profitLossPercent: (pl / CAPITAL) * 100, cumulativeProfit: cum,
      cumulativeProfitPercent: (cum / CAPITAL) * 100, runUp: 0, drawdown: 0,
    };
  });
}

const PATTERN = [1500, -1000, 1200, -800, 900];

describe('parseTradeTimestamp', () => {
  test('reads TradingView trade-list timestamps as wall-clock time', () => {
    expect(parseTradeTimestamp('2026-08-31 04:13')).toBe(Date.UTC(2026, 7, 31, 4, 13));
    expect(parseTradeTimestamp('2026-08-31')).toBe(Date.UTC(2026, 7, 31));
    expect(parseTradeTimestamp('')).toBeNull();
    expect(parseTradeTimestamp('31.08.2026')).toBeNull();
  });
});

describe('H1 Sharpe/Sortino annualise by trading frequency, not by trade count', () => {
  test('same pattern over a 4x longer backtest at the same frequency -> same Sharpe (was 2x)', () => {
    const short = calculateMetricsFromTrades(datedTrades(Array(2).fill(PATTERN).flat()), CAPITAL);
    const long = calculateMetricsFromTrades(datedTrades(Array(8).fill(PATTERN).flat()), CAPITAL);
    // The per-trade mean/std differ slightly (sample std, n-1), so allow a few percent.
    expect(long.sharpeRatio / short.sharpeRatio).toBeGreaterThan(0.95);
    expect(long.sharpeRatio / short.sharpeRatio).toBeLessThan(1.1);
    expect(long.sortinoRatio / short.sortinoRatio).toBeGreaterThan(0.95);
    expect(long.sortinoRatio / short.sortinoRatio).toBeLessThan(1.1);
  });

  test('the same trades at a quarter of the frequency -> half the annualised Sharpe', () => {
    const pnls = Array(8).fill(PATTERN).flat();
    const daily = calculateMetricsFromTrades(datedTrades(pnls, 1), CAPITAL).sharpeRatio;
    const every4 = calculateMetricsFromTrades(datedTrades(pnls, 4), CAPITAL).sharpeRatio;
    expect(every4 / daily).toBeCloseTo(0.5, 1);
  });

  test('value equals per-trade mean/std x sqrt(trades per year)', () => {
    const trades = datedTrades(Array(8).fill(PATTERN).flat());
    const r = trades.map((t) => t.profitLossPercent);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1));
    const perYear = trades.length / ((39 * DAY + 3600 * 1000) / (365.25 * DAY));
    expect(tradesPerYear(trades)!).toBeCloseTo(perYear, 6);
    expect(calculateMetricsFromTrades(trades, CAPITAL).sharpeRatio).toBeCloseTo((mean / sd) * Math.sqrt(perYear), 6);
  });

  test('undated trades fall back to the per-trade ratio (factor 1)', () => {
    const trades = datedTrades(PATTERN).map((t) => ({ ...t, entryDate: '', exitDate: '' }));
    expect(tradesPerYear(trades)).toBeNull();
    const r = trades.map((t) => t.profitLossPercent);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1));
    expect(calculateMetricsFromTrades(trades, CAPITAL).sharpeRatio).toBeCloseTo(mean / sd, 6);
  });
});

describe('L1 Sortino uses the standard downside deviation over all trades', () => {
  test('RMS of min(r, 0) over all N trades, target 0', () => {
    const trades = datedTrades([3000, -1000, 2000, -1000, 1000, 500]);
    const r = trades.map((t) => t.profitLossPercent);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const dd = Math.sqrt(r.reduce((s, x) => s + Math.min(x, 0) ** 2, 0) / r.length);
    const m = calculateMetricsFromTrades(trades, CAPITAL);
    expect(m.sortinoRatio).toBeCloseTo((mean / dd) * Math.sqrt(tradesPerYear(trades)!), 6);
  });
});
