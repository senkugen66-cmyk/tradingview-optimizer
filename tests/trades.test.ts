import { describe, expect, test } from 'bun:test';
import { calculateMetricsFromTrades, inferInitialCapital, parseCSVTrades } from '../src/trades';

// Header of TradingView's "List of trades" export as of September 2026.
const HEADER =
  '﻿Trade number,Type,Date and time,Signal,Price USD,Size (qty),Size (value),Net PnL USD,Return %,' +
  'Commission USD,Favorable excursion USD,Favorable excursion %,Adverse excursion USD,Adverse excursion %,' +
  'Cumulative PnL USD,Cumulative PnL %,Duration (bars)';

// Initial capital 1,000,000.
const CSV = [
  HEADER,
  '1,Exit long,2026-08-31 04:13,Close,4488.5,1,448940,-900,-0.2,0,100,0.02,-140,-0.03,-900,-0.09,1',
  '1,Entry long,2026-08-31 04:12,E,4489.4,1,448940,-900,-0.2,0,100,0.02,-140,-0.03,-900,-0.09,1',
  '2,Exit short,2026-08-31 04:15,Close,4486.6,1,448910,2500,0.56,0,280,0.06,-40,-0.01,1600,0.16,1',
  '2,Entry short,2026-08-31 04:14,E,4489.1,1,448910,2500,0.56,0,280,0.06,-40,-0.01,1600,0.16,1',
  '3,Exit long,2026-08-31 04:20,Close,4490.0,1,449000,1400,0.31,0,300,0.07,-50,-0.01,3000,0.3,1',
  '3,Entry long,2026-08-31 04:18,E,4488.6,1,449000,1400,0.31,0,300,0.07,-50,-0.01,3000,0.3,1',
].join('\n');

describe('parseCSVTrades', () => {
  test('reads per-trade returns from the "Return %" column', () => {
    const trades = parseCSVTrades(CSV);
    expect(trades.map((t) => t.profitLossPercent)).toEqual([-0.2, 0.56, 0.31]);
    expect(trades.map((t) => t.cumulativeProfitPercent)).toEqual([-0.09, 0.16, 0.3]);
  });

  test('still reads the older "Net P&L %" column', () => {
    const legacy = CSV.replace('Net PnL USD,Return %', 'Net P&L USD,Net P&L %');
    expect(parseCSVTrades(legacy).map((t) => t.profitLossPercent)).toEqual([-0.2, 0.56, 0.31]);
  });
});

describe('calculateMetricsFromTrades', () => {
  test('computes a non-zero Sharpe ratio', () => {
    const metrics = calculateMetricsFromTrades(parseCSVTrades(CSV));
    expect(metrics.sharpeRatio).toBeGreaterThan(0);
  });

  test('uses the initial capital implied by the cumulative P&L columns', () => {
    const trades = parseCSVTrades(CSV);
    expect(inferInitialCapital(trades)).toBe(1_000_000);
    const metrics = calculateMetricsFromTrades(trades);
    expect(metrics.netProfitPercent).toBeCloseTo(0.3, 5);
    // Trade 2 opens at cumulative -900 and has a $40 adverse excursion: the equity low is
    // 1,000,000 - 940, so the max drawdown is 0.094% (closing equity alone gave 0.09%).
    expect(metrics.maxDrawdownPercent).toBeCloseTo(0.094, 5);
  });

  test('keeps the default capital when no cumulative % column exists', () => {
    const trades = parseCSVTrades(CSV).map((t) => ({ ...t, cumulativeProfitPercent: 0 }));
    expect(inferInitialCapital(trades)).toBeNull();
    expect(calculateMetricsFromTrades(trades).netProfitPercent).toBeCloseTo(3, 5);
  });
});

describe('max drawdown (regression for audit H2)', () => {
  const CAPITAL = 100_000;
  function tradesFrom(pnls: number[], mae: number[] = []) {
    let cum = 0;
    return pnls.map((pl, i) => {
      cum += pl;
      return {
        tradeNumber: i + 1, type: 'Long' as const, signal: 'E', entryDate: '', entryPrice: 100,
        exitDate: '', exitPrice: 100, contracts: 1, profitLoss: pl,
        profitLossPercent: (pl / CAPITAL) * 100, cumulativeProfit: cum,
        cumulativeProfitPercent: (cum / CAPITAL) * 100, runUp: 0, drawdown: mae[i] ?? 0,
      };
    });
  }

  test('includes the open loss of a trade that closed in profit', () => {
    const m = calculateMetricsFromTrades(tradesFrom([1000], [40_000]), CAPITAL);
    expect(m.maxDrawdown).toBe(40_000);
    expect(m.maxDrawdownPercent).toBeCloseTo(40, 5);
  });

  test('reports the largest % drawdown, not the % at the largest dollar drawdown', () => {
    // 100k -> 80k (-20%), then 300k -> 250k (-$50k = -16.7%)
    const m = calculateMetricsFromTrades(tradesFrom([-20_000, 220_000, -50_000]), CAPITAL);
    expect(m.maxDrawdown).toBe(50_000);
    expect(m.maxDrawdownPercent).toBeCloseTo(20, 5);
  });
});
