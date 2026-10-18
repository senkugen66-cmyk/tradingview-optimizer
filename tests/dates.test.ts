import { describe, expect, test } from 'bun:test';
import { dateInputMatches, dateRangeMatches } from '../src/dates';

describe('dateInputMatches (regression for audit C3)', () => {
  test('accepts the display formats TradingView uses', () => {
    expect(dateInputMatches('2025-01-31', '2025-01-31')).toBe(true);
    expect(dateInputMatches('31.01.2025', '2025-01-31')).toBe(true);
    expect(dateInputMatches('01/31/2025', '2025-01-31')).toBe(true);
  });
  test('rejects a different date or an empty input', () => {
    expect(dateInputMatches('2025-02-01', '2025-01-31')).toBe(false);
    expect(dateInputMatches('', '2025-01-31')).toBe(false);
    expect(dateInputMatches('2025-01-31', 'Jan 31, 2025')).toBe(false);   // request must be YYYY-MM-DD
  });
});

describe('dateRangeMatches', () => {
  test('in order and swapped', () => {
    expect(dateRangeMatches('2023-01-01', '2024-12-31', '2023-01-01', '2024-12-31')).toBe(true);
    expect(dateRangeMatches('2024-12-31', '2023-01-01', '2023-01-01', '2024-12-31')).toBe(true);
    expect(dateRangeMatches('2024-12-31', '2023-01-01', '2023-01-01', '2024-12-31', false)).toBe(false);
  });
  test('a stale range (inputs not updated) is rejected', () => {
    expect(dateRangeMatches('2021-01-01', '2024-12-31', '2023-01-01', '2024-12-31')).toBe(false);
  });
});
