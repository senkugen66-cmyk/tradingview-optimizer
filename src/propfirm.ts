/**
 * Prop-firm evaluation check, simulated on the strategy's own trade list.
 *
 * The strategy's dollar P&L, position size and commission are used as exported by
 * TradingView, so the strategy must be configured like the funded account (contracts,
 * commission per side). Trades are grouped into trading sessions by exit time and
 * replayed through sequential evaluation attempts: each attempt starts at the account
 * size, ends on a pass or a breach, and the next attempt starts on the following session.
 *
 * Intraday path: trades are assumed sequential (no overlapping positions). Each trade's
 * worst open equity is its entry equity minus its adverse excursion. For intraday-trailing
 * rules its favourable excursion is assumed to come first (the conservative order).
 */
import { parseTradeTimestamp } from './dates';
import type { BacktestTrade } from './types';

export type DrawdownMode = 'static' | 'eod-trailing' | 'intraday-trailing';

export interface PropFirmRules {
  id: string;
  label: string;
  accountSize: number;
  /** Profit ($) needed to pass */
  profitTarget: number;
  /** Max loss limit ($): distance below the start (static) or below the high-water mark (trailing) */
  maxLoss: number;
  drawdown: DrawdownMode;
  /** A trailing limit stops rising at this balance (Lucid: account size + $100) */
  lockedFloor: number | null;
  /** Daily loss limit ($ per session), or null for none */
  dailyLossLimit: number | null;
  /** soft: trading stops for the session; hard: the account fails */
  dailyLossBreach: 'soft' | 'hard';
  /** Largest winning session must be at most this share of total profit to pass */
  consistency: number | null;
  /** Position-size limit, or null when not checked */
  maxContracts: { minis: number; micros: number } | null;
  /** Where the rules come from */
  source: string;
}

const LUCID_SOURCE =
  'Lucid Trading help center, verified 2026-10-18 (support.lucidtrading.com). Re-check before relying on it.';

function lucid(
  id: string, label: string, size: 25_000 | 50_000, drawdown: DrawdownMode,
  dailyLossLimit: number | null, consistency: number | null,
): PropFirmRules {
  const small = size === 25_000;
  return {
    id, label, accountSize: size,
    profitTarget: small ? 1_250 : 3_000,
    maxLoss: small ? 1_000 : 2_000,
    drawdown,
    lockedFloor: size + 100,
    dailyLossLimit,
    dailyLossBreach: 'soft',
    consistency,
    maxContracts: small ? { minis: 2, micros: 20 } : { minis: 4, micros: 40 },
    source: LUCID_SOURCE,
  };
}

/**
 * Lucid evaluation rules. LucidPro 25K daily loss limit: Lucid's own pages conflict
 * ("None" vs "$600 optional"), so both variants are offered. LucidFlex's optional daily
 * loss limit has no published amount, so Flex presets have none.
 */
export const LUCID_PRESETS: PropFirmRules[] = [
  lucid('lucid-flex-25k', 'LucidFlex 25K', 25_000, 'eod-trailing', null, 0.5),
  lucid('lucid-flex-50k', 'LucidFlex 50K', 50_000, 'eod-trailing', null, 0.5),
  lucid('lucid-pro-25k', 'LucidPro 25K (no DLL)', 25_000, 'eod-trailing', null, null),
  lucid('lucid-pro-25k-dll', 'LucidPro 25K (DLL $600)', 25_000, 'eod-trailing', 600, null),
  lucid('lucid-pro-50k', 'LucidPro 50K (no DLL)', 50_000, 'eod-trailing', null, null),
  lucid('lucid-pro-50k-dll', 'LucidPro 50K (DLL $1,200)', 50_000, 'eod-trailing', 1_200, null),
  lucid('lucid-daily-25k-intraday', 'LucidDaily 25K (intraday DD, DLL $600)', 25_000, 'intraday-trailing', 600, 0.5),
  lucid('lucid-daily-25k-eod', 'LucidDaily 25K (EOD DD, no DLL)', 25_000, 'eod-trailing', null, 0.5),
  lucid('lucid-daily-50k-intraday', 'LucidDaily 50K (intraday DD, DLL $1,200)', 50_000, 'intraday-trailing', 1_200, 0.5),
  lucid('lucid-daily-50k-eod', 'LucidDaily 50K (EOD DD, no DLL)', 50_000, 'eod-trailing', null, 0.5),
];

export const GENERIC_PRESET_ID = 'generic-static';

/**
 * The extension's original percentage challenge (8% target, 5% daily, 10% max loss),
 * scaled to the strategy's capital. Static drawdown; the daily limit is a hard breach.
 */
export function genericPercentRules(capital: number): PropFirmRules {
  return {
    id: GENERIC_PRESET_ID,
    label: 'Generic static challenge (8% / 5% daily / 10%)',
    accountSize: capital,
    profitTarget: capital * 0.08,
    maxLoss: capital * 0.10,
    drawdown: 'static',
    lockedFloor: null,
    dailyLossLimit: capital * 0.05,
    dailyLossBreach: 'hard',
    consistency: null,
    maxContracts: null,
    source: 'Generic two-step-style percentages; not any specific firm.',
  };
}

export function resolveRules(presetId: string, capital: number): PropFirmRules {
  return LUCID_PRESETS.find(p => p.id === presetId) ?? genericPercentRules(capital);
}

/** Micro or mini contract, from a TradingView symbol such as "CME_MINI:MNQ1!"; null if unknown. */
export function contractKind(symbol: string | undefined): 'micro' | 'mini' | null {
  // "MNQ1!" (continuous) or "MNQZ2025" (dated contract) -> "MNQ"
  const root = (symbol || '').split(':').pop()!.toUpperCase()
    .replace(/[FGHJKMNQUVXZ]\d{2,4}$/, '').replace(/\d*!$/, '');
  if (['MNQ', 'MES', 'MYM', 'M2K', 'MGC', 'MCL', 'SIL', 'MHG', 'M6E', 'M6A', 'M6B', 'MBT', 'MET'].includes(root)) return 'micro';
  if (['NQ', 'ES', 'YM', 'RTY', 'GC', 'CL', 'SI', 'HG', 'NG', '6E', '6A', '6B', '6J', 'ZB', 'ZN', 'ZF'].includes(root)) return 'mini';
  return null;
}

/** Trading-session key (YYYY-MM-DD) of a timestamp: at or after `rolloverHour` it belongs to the next day. */
export function sessionKey(ms: number, rolloverHour: number): string {
  const d = new Date(ms);
  if (d.getUTCHours() >= rolloverHour) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export type AttemptOutcome = 'pass' | 'breach' | 'unresolved';

export interface EvaluationAttempt {
  startSession: string;
  endSession: string;
  sessions: number;
  outcome: AttemptOutcome;
  breachReason?: 'max loss' | 'daily loss';
  profit: number;
}

export interface PropFirmEvaluation {
  rules: PropFirmRules;
  sessions: number;
  attempts: EvaluationAttempt[];
  passes: number;
  breaches: number;
  unresolved: number;
  medianSessionsToPass: number | null;
  /** Worst / best session P&L of the raw trade list (no rules applied) */
  worstSession: number;
  bestSession: number;
  /** Sessions in which the daily loss limit was hit, across all attempts */
  dailyLimitSessions: number;
  /** Trades not taken because a soft daily loss limit had stopped trading for the session */
  skippedTrades: number;
  /** Sessions on which the profit target was met but the consistency rule held the pass back */
  consistencyHeldSessions: number;
  maxContractsTraded: number;
  contractKind: 'micro' | 'mini' | null;
  /** true/false when checkable, null when the contract type is unknown or the rules set no limit */
  sizeWithinLimit: boolean | null;
  /** Trades skipped because their exit time couldn't be read */
  undatedTrades: number;
}

interface Session { key: string; trades: BacktestTrade[] }

function groupSessions(trades: BacktestTrade[], rolloverHour: number): { sessions: Session[]; undated: number } {
  const dated: { ms: number; trade: BacktestTrade }[] = [];
  let undated = 0;
  for (const trade of trades) {
    const ms = parseTradeTimestamp(trade.exitDate) ?? parseTradeTimestamp(trade.entryDate);
    if (ms === null) undated++;
    else dated.push({ ms, trade });
  }
  dated.sort((a, b) => a.ms - b.ms || a.trade.tradeNumber - b.trade.tradeNumber);
  const sessions: Session[] = [];
  for (const { ms, trade } of dated) {
    const key = sessionKey(ms, rolloverHour);
    if (sessions.length === 0 || sessions[sessions.length - 1].key !== key) sessions.push({ key, trades: [] });
    sessions[sessions.length - 1].trades.push(trade);
  }
  return { sessions, undated };
}

interface AttemptStats { dailyLimitSessions: number; skippedTrades: number; consistencyHeld: number }

function runAttempt(sessions: Session[], start: number, r: PropFirmRules, stats: AttemptStats): { attempt: EvaluationAttempt; next: number } {
  const startBalance = r.accountSize;
  let balance = startBalance;
  let eodPeak = startBalance;   // highest end-of-session balance
  let hwm = startBalance;       // intraday high-water mark (intraday-trailing only)
  let bestSession = 0;
  const lock = r.lockedFloor ?? Infinity;

  const floorNow = (): number => {
    if (r.drawdown === 'static') return startBalance - r.maxLoss;
    const peak = r.drawdown === 'eod-trailing' ? eodPeak : hwm;
    return Math.min(peak - r.maxLoss, lock);
  };
  const finish = (i: number, outcome: AttemptOutcome, breachReason?: 'max loss' | 'daily loss') => ({
    attempt: {
      startSession: sessions[start].key, endSession: sessions[i].key, sessions: i - start + 1,
      outcome, breachReason, profit: balance - startBalance,
    },
    next: i + 1,
  });

  for (let i = start; i < sessions.length; i++) {
    let day = 0;
    let stopped = false;
    for (const trade of sessions[i].trades) {
      if (stopped) { stats.skippedTrades++; continue; }
      const pnl = trade.profitLoss ?? 0;
      const adverse = Math.abs(trade.drawdown ?? 0);
      const equity = balance + day;
      if (r.drawdown === 'intraday-trailing') hwm = Math.max(hwm, equity + Math.max(0, trade.runUp ?? 0));
      // Worst open P&L for the session, limited by a soft daily loss limit (liquidation at the limit).
      let worstDay = Math.min(day - adverse, day + pnl);
      let dailyHit = r.dailyLossLimit !== null && worstDay <= -r.dailyLossLimit;
      if (dailyHit && r.dailyLossBreach === 'soft') worstDay = -r.dailyLossLimit!;
      if (balance + worstDay <= floorNow()) {
        balance += worstDay;
        return finish(i, 'breach', 'max loss');
      }
      if (dailyHit) {
        stats.dailyLimitSessions++;
        if (r.dailyLossBreach === 'hard') {
          balance += worstDay;
          return finish(i, 'breach', 'daily loss');
        }
        day = -r.dailyLossLimit!;
        stopped = true;
        continue;
      }
      day += pnl;
      if (r.drawdown === 'intraday-trailing') hwm = Math.max(hwm, balance + day);
    }
    balance += day;
    eodPeak = Math.max(eodPeak, balance);
    hwm = Math.max(hwm, balance);
    bestSession = Math.max(bestSession, day);
    const profit = balance - startBalance;
    if (profit >= r.profitTarget) {
      if (r.consistency === null || bestSession <= r.consistency * profit) return finish(i, 'pass');
      stats.consistencyHeld++;
    }
  }
  return finish(sessions.length - 1, 'unresolved');
}

export function evaluatePropFirm(
  trades: BacktestTrade[], rules: PropFirmRules,
  options: { symbol?: string; rolloverHour?: number } = {},
): PropFirmEvaluation {
  // Default 17:00 chart time: CME equity futures close 16:00 CT / 17:00 ET and reopen an hour
  // later, so an exit at or after 17:00 in either time zone belongs to the next session.
  const { sessions, undated } = groupSessions(trades, options.rolloverHour ?? 17);
  const stats: AttemptStats = { dailyLimitSessions: 0, skippedTrades: 0, consistencyHeld: 0 };
  const attempts: EvaluationAttempt[] = [];
  for (let i = 0; i < sessions.length;) {
    const { attempt, next } = runAttempt(sessions, i, rules, stats);
    attempts.push(attempt);
    i = next;
  }

  const sessionPnl = sessions.map(s => s.trades.reduce((sum, t) => sum + (t.profitLoss ?? 0), 0));
  const passed = attempts.filter(a => a.outcome === 'pass').map(a => a.sessions).sort((a, b) => a - b);
  const mid = passed.length >> 1;
  const maxContractsTraded = trades.reduce((m, t) => Math.max(m, Math.abs(t.contracts ?? 0)), 0);
  const kind = contractKind(options.symbol);
  const limit = rules.maxContracts && kind ? rules.maxContracts[kind === 'micro' ? 'micros' : 'minis'] : null;

  return {
    rules,
    sessions: sessions.length,
    attempts,
    passes: passed.length,
    breaches: attempts.filter(a => a.outcome === 'breach').length,
    unresolved: attempts.filter(a => a.outcome === 'unresolved').length,
    medianSessionsToPass: passed.length === 0 ? null
      : passed.length % 2 ? passed[mid] : (passed[mid - 1] + passed[mid]) / 2,
    worstSession: sessionPnl.length ? Math.min(...sessionPnl) : 0,
    bestSession: sessionPnl.length ? Math.max(...sessionPnl) : 0,
    dailyLimitSessions: stats.dailyLimitSessions,
    skippedTrades: stats.skippedTrades,
    consistencyHeldSessions: stats.consistencyHeld,
    maxContractsTraded,
    contractKind: kind,
    sizeWithinLimit: limit === null ? null : maxContractsTraded <= limit,
    undatedTrades: undated,
  };
}

export type PropFirmVerdict = 'COMPATIBLE' | 'MARGINAL' | 'AT RISK' | 'NO DATA';

/**
 * COMPATIBLE: at least one pass, no breach, size within limit.
 * MARGINAL: more passes than breaches, size not over the limit.
 * AT RISK: anything else (including never reaching the target).
 */
export function propFirmVerdict(e: PropFirmEvaluation): PropFirmVerdict {
  if (e.sessions === 0) return 'NO DATA';
  if (e.sizeWithinLimit === false) return 'AT RISK';
  if (e.passes > 0 && e.breaches === 0) return 'COMPATIBLE';
  if (e.passes > e.breaches) return 'MARGINAL';
  return 'AT RISK';
}
