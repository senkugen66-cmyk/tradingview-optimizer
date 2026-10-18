# Baselines

## Status (2026-10-18): no performance baseline exists yet

This repo has no backtesting engine. Every backtest runs inside TradingView's Strategy Tester in a
logged-in Chrome session. **No strategy metrics have been produced, and none may be reported
until the procedure below is run by a person with TradingView access.**

A headless probe without an account (2026-10-18) confirmed that the extension loads and injects on
the chart. TradingView refuses to add any strategy without a (free) account, so the procedure below
needs the user's own logged-in browser.

## Software baseline (verified)

| Item | Result |
|---|---|
| Commit | `cc6d187` |
| Toolchain | Bun 1.4.2, Node 22.22 |
| `bun run typecheck` | pass |
| `bun run test` | 9/9 pass (44/44 on `audit-fixes` at `ec2e7b3`) |
| `bun test research/audit` | 9/9 pass (characterisation of audit issues A1–A9; 4/4 still-open ones on `audit-fixes`) |
| `bun run build` | pass (dist ≈ 10 MB) |
| `bun run lint` | fails (no ESLint) |

## Reproducible baseline procedure (to run in the browser)
Record every field below. Change one thing at a time.

**1. Fixed context**
- Strategy: TradingView built-in "MovingAvg2Line Cross", unmodified (so anyone can reproduce it).
  The October 2026 built-in list shows it as "Moving average crossover"; use that if the old name
  is absent, and record which.
- Symbol `MNQ1!`, 15-minute chart. Fixed custom date range, e.g. 2023-01-01 → 2025-12-31; note
  whether TradingView's "Deep Backtesting" is on.
- Properties:
  - initial capital 25,000 USD
  - order size **1 contract**
  - pyramiding 0
  - commission **0.50 USD per contract (per side)**
  - slippage **1 tick** (also run 0 and 2)
  - margin defaults
  - "recalculate after order filled" off
  - bar magnifier noted on or off

**2. Reference run (no optimizer)**
- Record TradingView's own Performance Summary: net profit, gross profit and loss, max drawdown
  (TradingView includes open-trade drawdown), profit factor, total trades, % profitable, Sharpe.
- Export the List of Trades CSV and keep it under `research/data/` (do not commit if licensing
  forbids).

**3. Extension cross-check (acceptance test for the metric layer)**
- Run the optimizer with a 1-combination grid (fast = current, slow = current).
- Compare the extension's metrics with step 2:
  - net profit, trades, win rate and profit factor must match
  - max drawdown should now be close to TradingView's but can still be lower (a lower bound: run-ups
    inside a trade before its dip aren't exported)
  - Sharpe is expected to **differ**: TradingView uses monthly returns and a risk-free rate, while
    the extension annualises per-trade returns by trades per year

  Record the differences.

**4. Optimizer baseline**
- Grid fast 5–20 step 5 × slow 20–60 step 10 (20 combinations), goal Net Profit %.
- Save the JSON export and record the best run and the heatmap.
- Repeat with walk-forward single (IS 2023–2024, OOS 2025). Since the C1 fix, the best run is
  selected on IS only, so the OOS column is a genuine out-of-sample number.
- Open the Prop Firm section and record the LucidFlex 25K and LucidPro 25K (both DLL variants)
  results. Set the strategy's order size in MNQ contracts first.

**5. Log it**
Add a dated entry to `EXPERIMENT_LOG.md` with all of the above, the extension commit and the
Chrome version.

## Baseline table (fill in only from real runs)

| Date | Commit | Strategy / version | Symbol / TF | Period | Costs | Trades | Net % | Max DD % (TV) | Max DD % (ext) | PF | Win % | Sharpe (TV) | Sharpe (ext) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — | — | — | — | — | not yet run |
