import { describe, expect, test } from 'bun:test';
import {
  contractKind, evaluatePropFirm, genericPercentRules, LUCID_PRESETS, propFirmVerdict, resolveRules, sessionKey,
} from '../src/propfirm';
import type { BacktestTrade } from '../src/types';

const preset = (id: string) => LUCID_PRESETS.find(p => p.id === id)!;

interface T { day: string; pnl: number; adverse?: number; runUp?: number; contracts?: number; time?: string }

/** Closed trades; each exits on `day` at `time` (default 11:00 chart time). */
function trades(spec: T[]): BacktestTrade[] {
  let cum = 0;
  return spec.map((s, i) => {
    cum += s.pnl;
    return {
      tradeNumber: i + 1, type: 'Long', signal: 'E', entryDate: `${s.day} 10:00`, entryPrice: 100,
      exitDate: `${s.day} ${s.time ?? `11:${String(i % 60).padStart(2, '0')}`}`, exitPrice: 100,
      contracts: s.contracts ?? 1, profitLoss: s.pnl, profitLossPercent: 0, cumulativeProfit: cum,
      cumulativeProfitPercent: 0, runUp: s.runUp ?? Math.max(0, s.pnl), drawdown: s.adverse ?? Math.max(0, -s.pnl),
    };
  });
}

describe('sessions and symbols', () => {
  test('an exit at or after the rollover hour belongs to the next session', () => {
    expect(sessionKey(Date.UTC(2024, 0, 2, 16, 59), 17)).toBe('2024-01-02');
    expect(sessionKey(Date.UTC(2024, 0, 2, 17, 30), 17)).toBe('2024-01-03');
  });

  test('contract kind from TradingView symbols', () => {
    expect(contractKind('CME_MINI:MNQ1!')).toBe('micro');
    expect(contractKind('CME_MINI:MESZ2025')).toBe('micro');
    expect(contractKind('CME_MINI:NQ1!')).toBe('mini');
    expect(contractKind('NASDAQ:AAPL')).toBeNull();
  });

  test('unknown preset id falls back to the generic percentage rules', () => {
    expect(resolveRules('nope', 200_000).profitTarget).toBe(16_000);
    expect(resolveRules('lucid-pro-50k', 200_000).accountSize).toBe(50_000);
  });
});

describe('Lucid end-of-day trailing max loss', () => {
  test('the limit trails the highest end-of-day balance, and open losses count against it', () => {
    // Day 1 closes at 25,900 -> limit 24,900. Day 2 trade is down 1,050 before closing -100.
    const e = evaluatePropFirm(trades([
      { day: '2024-01-02', pnl: 900 },
      { day: '2024-01-03', pnl: -100, adverse: 1_050 },
    ]), preset('lucid-pro-25k'));
    expect(e.attempts[0]).toMatchObject({ outcome: 'breach', breachReason: 'max loss', sessions: 2 });
  });

  test('an intraday run-up does not raise an EOD limit', () => {
    // Run-up of +900 inside the trade, closes +0; then -950 the next day: limit is still 24,000.
    const e = evaluatePropFirm(trades([
      { day: '2024-01-02', pnl: 0, runUp: 900 },
      { day: '2024-01-03', pnl: -950 },
    ]), preset('lucid-pro-25k'));
    expect(e.breaches).toBe(0);
  });

  test('the limit locks at account size + $100', () => {
    // Day 1 closes at 26,200: unlocked trail would be 25,200, locked limit is 25,100.
    const e = evaluatePropFirm(trades([
      { day: '2024-01-02', pnl: 1_200 },
      { day: '2024-01-03', pnl: -1_050 },
    ]), preset('lucid-pro-25k'));
    expect(e.breaches).toBe(0);
    expect(e.attempts[0]).toMatchObject({ outcome: 'unresolved', profit: 150 });
  });
});

describe('Lucid intraday trailing max loss (LucidDaily)', () => {
  test('a run-up raises the limit in real time (conservative ordering)', () => {
    // Run-up +900 -> limit 24,900; the same trade then dips 300 below entry -> 24,700: breach.
    const spec = [{ day: '2024-01-02', pnl: 0, runUp: 900, adverse: 300 }];
    expect(evaluatePropFirm(trades(spec), preset('lucid-daily-25k-intraday')).attempts[0])
      .toMatchObject({ outcome: 'breach', breachReason: 'max loss' });
    expect(evaluatePropFirm(trades(spec), preset('lucid-daily-25k-eod')).breaches).toBe(0);
  });
});

describe('profit target and consistency', () => {
  const run = [
    { day: '2024-01-02', pnl: 1_300 },
    { day: '2024-01-03', pnl: 100 },
    { day: '2024-01-04', pnl: 600 },
    { day: '2024-01-05', pnl: 700 },
  ];

  test('LucidPro (no consistency rule) passes on the first session that reaches the target', () => {
    const e = evaluatePropFirm(trades(run), preset('lucid-pro-25k'));
    expect(e.attempts[0]).toMatchObject({ outcome: 'pass', sessions: 1 });
  });

  test('LucidFlex 50% consistency holds the pass back until the best day is <= 50% of profit', () => {
    const e = evaluatePropFirm(trades(run), preset('lucid-flex-25k'));
    // Profit after each day: 1,300 / 1,400 / 2,000 / 2,700; best day 1,300 <= 1,350 only on day 4.
    expect(e.attempts[0]).toMatchObject({ outcome: 'pass', sessions: 4 });
    expect(e.consistencyHeldSessions).toBe(3);
  });
});

describe('daily loss limits', () => {
  const day = [
    { day: '2024-01-02', pnl: -700 },
    { day: '2024-01-02', pnl: 500 },
  ];

  test('soft limit (Lucid): liquidated at the limit, rest of the session skipped, no breach', () => {
    const e = evaluatePropFirm(trades(day), preset('lucid-pro-25k-dll'));
    expect(e.dailyLimitSessions).toBe(1);
    expect(e.skippedTrades).toBe(1);
    expect(e.attempts[0]).toMatchObject({ outcome: 'unresolved', profit: -600 });
  });

  test('without a daily limit the same session nets -200', () => {
    expect(evaluatePropFirm(trades(day), preset('lucid-pro-25k')).attempts[0].profit).toBe(-200);
  });

  test('hard limit (generic): the account fails; daily P&L is used, not the largest single trade', () => {
    const rules = genericPercentRules(100_000);   // 5,000 daily, 10,000 static max loss
    // Three -2,000 trades in one session: no single trade is near 5% but the session is -6,000.
    const e = evaluatePropFirm(trades([
      { day: '2024-01-02', pnl: -2_000 }, { day: '2024-01-02', pnl: -2_000 }, { day: '2024-01-02', pnl: -2_000 },
    ]), rules);
    expect(e.attempts[0]).toMatchObject({ outcome: 'breach', breachReason: 'daily loss' });
  });

  test('generic static max loss does not trail', () => {
    const rules = genericPercentRules(100_000);
    const e = evaluatePropFirm(trades([
      { day: '2024-01-02', pnl: 7_000 },                       // below the 8,000 target
      { day: '2024-01-03', pnl: -4_000 }, { day: '2024-01-04', pnl: -4_000 },
    ]), rules);
    expect(e.breaches).toBe(0);   // a trailing 10% limit would have been hit at 99,000
  });
});

describe('attempts, size and verdict', () => {
  test('after a breach the next attempt starts fresh on the following session', () => {
    const e = evaluatePropFirm(trades([
      { day: '2024-01-02', pnl: -1_000 },
      { day: '2024-01-03', pnl: 1_300 },
    ]), preset('lucid-pro-25k'));
    expect(e.attempts.map(a => a.outcome)).toEqual(['breach', 'pass']);
    expect(propFirmVerdict(e)).toBe('AT RISK');   // passes (1) not > breaches (1)
  });

  test('position size over the micro limit makes the verdict AT RISK', () => {
    const t = trades([{ day: '2024-01-02', pnl: 1_300, contracts: 25 }]);
    const e = evaluatePropFirm(t, preset('lucid-pro-25k'), { symbol: 'CME_MINI:MNQ1!' });
    expect(e.sizeWithinLimit).toBe(false);
    expect(propFirmVerdict(e)).toBe('AT RISK');
    // 25 micros fit the 50K limit (40); +3,100 meets its $3,000 target.
    const t50 = trades([{ day: '2024-01-02', pnl: 3_100, contracts: 25 }]);
    const ok = evaluatePropFirm(t50, preset('lucid-pro-50k'), { symbol: 'CME_MINI:MNQ1!' });
    expect(ok.sizeWithinLimit).toBe(true);
    expect(propFirmVerdict(ok)).toBe('COMPATIBLE');
  });

  test('undated trades are counted and excluded; no dated trades means NO DATA', () => {
    const t = trades([{ day: '2024-01-02', pnl: 100 }]).map(x => ({ ...x, entryDate: '', exitDate: '' }));
    const e = evaluatePropFirm(t, preset('lucid-flex-25k'));
    expect(e.undatedTrades).toBe(1);
    expect(propFirmVerdict(e)).toBe('NO DATA');
  });
});
