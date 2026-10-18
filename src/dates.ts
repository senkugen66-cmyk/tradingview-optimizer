/**
 * Date-range verification for walk-forward runs.
 *
 * TradingView's custom date-range inputs may display dates as YYYY-MM-DD,
 * DD.MM.YYYY or MM/DD/YYYY depending on locale. A walk-forward phase must only
 * run once the inputs provably hold the requested dates.
 */

/** True when a date input's displayed value is the requested YYYY-MM-DD date. */
export function dateInputMatches(actual: string, requestedYmd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(requestedYmd);
  if (!m) return false;
  const [, y, mo, d] = m;
  const digits = (actual || '').replace(/\D/g, '');
  return digits === `${y}${mo}${d}` || digits === `${d}${mo}${y}` || digits === `${mo}${d}${y}`;
}

/**
 * True when the start/end inputs hold the requested range. TradingView may display
 * the two inputs swapped; `allowSwap` accepts that order too.
 */
export function dateRangeMatches(
  actualStart: string, actualEnd: string, start: string, end: string, allowSwap = true,
): boolean {
  const inOrder = dateInputMatches(actualStart, start) && dateInputMatches(actualEnd, end);
  const swapped = dateInputMatches(actualStart, end) && dateInputMatches(actualEnd, start);
  return inOrder || (allowSwap && swapped);
}

/**
 * Parse a TradingView trade-list timestamp ("YYYY-MM-DD HH:MM[:SS]", chart time zone) into
 * milliseconds. The wall-clock fields are read as UTC so spans and calendar days come out
 * exactly as displayed, without any time-zone conversion. Returns null when unreadable.
 */
export function parseTradeTimestamp(value: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec((value || '').trim());
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  return Number.isFinite(ms) ? ms : null;
}
