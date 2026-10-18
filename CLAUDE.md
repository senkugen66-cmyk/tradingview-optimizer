# CLAUDE.md: Roboquant tradingview-optimizer

## Start of every session
1. Read `ROBOQUANT_PROJECT_MEMORY.md`, `research/EXPERIMENT_LOG.md` (latest entry) and
   `research/BASELINES.md`.
2. Run `git status` and `git log -5`, and diff against the commit recorded in the memory file
   (`cc6d187` as of 2026-10-18).
3. Before relying on a finding, re-check its file and line reference; line numbers drift.

## What this repo is
- A **Chrome MV3 extension (TypeScript, Bun, Vite)** that grid-searches TradingView Pine strategy
  inputs by automating the TradingView page.
- **TradingView's Strategy Tester runs every backtest.** There is no local engine, data feed or
  fill model.
- Pure, testable logic is only in `src/trades.ts`. `content.ts` and `optimizer-ui.ts` have side
  effects at load and can't be imported in tests.

## Commands
`bun install --frozen-lockfile`, `bun run typecheck`, `bun run test` (9 tests),
`bun test research/audit` (audit evidence), `bun run build`. `bun run lint` is broken (no ESLint
config or dependency).

## Known critical issues (details and evidence in the memory file, section 11)
- **C1:** single walk-forward picks the best run with `0.4·IS + 0.6·OOS` (OOS leak).
- **C2:** failed CSV extraction becomes a valid zero-metric run.
- **C3:** a date-range failure doesn't stop walk-forward.
- **H1:** Sharpe scales with √(trade count).
- **H2:** drawdown is closed-trade only.
- **H3:** the prop-firm check is a fixed FTMO preset.

Treat optimizer outputs as **untrusted** until these are fixed.

## Working rules (from the user)
- Understand before modifying; verify claims against code. Never fabricate results, metrics or
  test outcomes.
- Make small isolated changes, each with a regression test, and log every experiment (including
  failures) in `research/EXPERIMENT_LOG.md`.
- Never tune on a final test period; keep in-sample, validation and out-of-sample results separate.
- **Do not commit, push or publish without explicit authorization.** Never touch credentials;
  never place live trades.
- The user trades **Lucid Trading** futures prop accounts on **MNQ/MES**.
  - When configuring TradingView strategies for this user: commission is **$0.50 per contract per
    side** (verify at https://support.lucidtrading.com/en/articles/11508978-approved-products-and-commissions).
  - Slippage is stated in ticks (MNQ tick $0.50, MES tick $1.25).
  - Lucid uses an end-of-day trailing max-loss limit, not FTMO-style static rules.
