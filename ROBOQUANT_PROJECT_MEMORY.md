# Roboquant: tradingview-optimizer, project memory

Source of truth for architecture and audit findings. Verify against the code before relying on
anything here: line numbers drift.

## 0. Record

| | |
|---|---|
| Written | 2026-10-18 |
| Repo | https://github.com/Roboquant-AI/tradingview-optimizer |
| Commit inspected | `cc6d187` ("chore: add bug report and feature request issue templates (#4)"), shallow clone |
| Version | 3.0.0 (`manifest.json`, `package.json`, `src/types.ts` `EXTENSION_VERSION`) |

**What was actually read** (this repo contains no Python and no backtesting engine):

| File | Coverage |
|---|---|
| `src/trades.ts` | full |
| `src/types.ts` | full |
| `src/background.ts` | full |
| `src/config.ts` | full |
| `src/popup.ts` | top 70 lines |
| `src/selectors.json` | keys only |
| `tests/*.ts` | full |
| README, CONTRIBUTING, manifest, package.json, tsconfig, vite.config, .gitignore, cws-description | full |
| `src/content.ts` | lines 1–110, 298–597, 1265–2966 (the whole optimization loop), 3160–3197, 3635–3697 |
| `src/optimizer-ui.ts` | lines 60–299, 1955–2018, 2542–2865, 3107–3473, 3700–4165, 4166–4325, 4646–4802 |

**Outlined only, not read line by line:**
- `content.ts` 603–1265 (input discovery: dropdowns, checkboxes), 2967–3160 (opening the settings
  dialog), 3205–3634 (symbol and timeframe switching)
- `optimizer-ui.ts` 300–1954 (CSS), 2023–2541 (event wiring), 4325–4645 (heatmap rendering)
- `src/popup.html`, `scripts/generate-icons.cjs`, `.github/ISSUE_TEMPLATE/*`

## 1. Purpose
A free MIT-licensed **Chrome extension (Manifest V3)** that grid-searches the inputs of a
TradingView Pine Script strategy. It automates the TradingView web page: sets the inputs, lets
**TradingView's own Strategy Tester** run each backtest, exports the trade list CSV, and computes
metrics from that CSV. Features: grid search; Standard, Multi-Timeframe, Multi-Symbol and Full Grid
modes; single and rolling walk-forward; 2D/3D heatmaps; a "prop firm check"; JSON export; local
history of the last 10 runs. No server and no account (README "What's new in 3.0.0").

**Implications:** there is no data ingestion, no trade simulator, no fill model and no fee model in
this repo. Data quality, execution realism, look-ahead inside the strategy, commission and slippage
are all decided by **TradingView and the user's Pine script and Properties tab**. This repo's own
correctness surface is:
- automation reliability (did the right parameters and dates actually run?)
- CSV parsing and metric definitions
- best-run selection and walk-forward methodology
- the prop-firm check

## 2. Repository structure
```
manifest.json            MV3 manifest: permissions activeTab, debugger, storage, unlimitedStorage; host *.tradingview.com
package.json             Bun scripts: dev, build, build:prod, typecheck, lint (broken), test, clean
vite.config.ts           @crxjs/vite-plugin build; drops console.log/info/debug in builds, keeps warn/error
tsconfig.json            strict TS, noEmit
src/background.ts  510   service worker: tab registry, status for popup, debugger-API date-range setter, tab "wake-up"
src/content.ts    3697   content script: input discovery and setting, optimization loop, walk-forward, CSV capture, symbol/TF change
src/optimizer-ui.ts 4802 injected overlay UI: config, progress, results, prop-firm check, heatmaps, history (+~1,650 lines CSS)
src/trades.ts      314   CSV parser + metric calculation (the only pure, testable logic)
src/types.ts       395   shared types
src/config.ts       17   roboquantLink() UTM helper
src/popup.html/.ts       toolbar popup (status)
src/selectors.json       TradingView DOM selectors (v1.1.0, 2025-12-22); many selectors are ALSO hard-coded in content.ts
tests/trades.test.ts     5 tests: CSV parsing (new and legacy headers), Sharpe > 0, capital inference
tests/config.test.ts     4 tests: UTM link builder
scripts/generate-icons.cjs  sharp-based icon generation
assets/                  icons, logo, demo.gif (4.8 MB, copied into dist)
```

## 3. Execution flow (verified in code)
1. **Startup.** `content.ts` `initialize()` (l.74) sends `CONTENT_READY`, sets up the editor
   observer, heartbeat and warning-popup dismisser. After 2 s it calls `injectOptimizerButton()`
   (optimizer-ui) to add an "Optimizer" tab next to Strategy Tester.
2. **User configuration** (`optimizer-ui.ts` `renderConfigView` l.2542):
   - pick inputs with min/max/step (numeric), selected options (dropdown) or on/off (boolean)
   - goal: `sharpeRatio` (default), `netProfitPercent`, `profitFactor`, `sortinoRatio`, `winRate`,
     `maxDrawdownPercent`
   - delay between runs (default 3 s, clamped 1–30 s)
   - mode; optional walk-forward (single, or rolling with 24-month IS / 6-month OOS / 6-month step
     by default)
3. **Start.** `startOptimization()` (ui l.3707) builds an `OptimizationConfig` with
   `maxRuns: Infinity` and calls `window.rqStartOptimization` → `handleStartOptimization()`
   (content l.2131).
4. **Per run**, all modes:
   - `applyParameterSet()` (l.1421): opens the settings dialog, `setInputValue` per parameter (each
     numeric write is verified, l.1307), then commits with Ok. Any failed parameter throws and aborts
     the optimization, which is good.
   - `waitForBacktestUpdate()` (l.1531): clicks "Update report" if present, waits until no
     `[class*="loading"]` element is visible (≤ 10 s), then waits `delayBetweenRuns`.
   - `extractTradesViaCSV()` (l.307): clicks the List-of-Trades export and intercepts the blob/anchor
     download (three strategies, 5 s timeout → `{trades: []}`).
   - `calculateMetricsFromTrades()` (trades.ts l.184) → `OptimizationRun`.
   - `isBetterRun()` (content l.3182) updates `bestRun`. The UI keeps its own copy at
     optimizer-ui l.3938.
5. **Walk-forward.**
   - **Single** (l.2512–2753): every combination on IS, then every combination on OOS; best =
     argmax(0.4·IS + 0.6·OOS) (**leak**, see C1).
   - **Rolling** (l.2299–2510): per window, IS sweep then OOS sweep; the window's best is chosen by
     IS metrics (correct). Aggregate = mean OOS net % across windows, standard deviation, average
     "overfitting score", windows passed.
   - Dates are set through `setBacktestDateRange()` (l.1641): background debugger API first, then
     DOM fallback.
6. **End.** `setResult()` → results view, prop-firm section, heatmap, `saveToHistory()`
   (chrome.storage.local, 10 entries).

## 4. Strategy definitions
None in this repo. The strategy is whatever Pine Script is on the user's chart. Entry and exit
logic, stops, sizing, commission and slippage live in the Pine script and its Properties tab.

## 5. Optimizer methodology
- **Exhaustive grid** (`generateParameterCombinations`, content l.1564): cartesian product, numeric
  values `for (v=min; v<=max; v+=step)`.
  - No random, Bayesian or evolutionary search.
  - No early stopping, no pruning, and no limit other than the user's grid size.
- **Run time** is about (delay + 3–6 s of automation) per combination. 100 combinations ≈ 10–15
  minutes; walk-forward roughly doubles it, and each rolling window repeats the full grid.
- **Best-run selection:** a single goal metric with no robustness penalty, except the single
  walk-forward combined score.
- **Robustness helpers:** heatmaps; "overfitting score" = mean of capped OOS/IS ratios of net %,
  Sharpe, profit factor and win rate (content l.2074). The thresholds (0.7 robust, 0.6 rolling) are
  arbitrary.

## 6. Backtesting methodology
Done by TradingView. The extension trusts TradingView's trade list (net P&L already after the
strategy's commission and slippage settings). It does **not**:
- read or verify commission and slippage
- account for funding or margin
- check data coverage

The "Commission" CSV column is not parsed.

## 7. Metrics (`src/trades.ts`)

| Metric | How it is computed |
|---|---|
| Net profit | Σ trade P&L |
| Net profit % | last cumulative P&L ÷ initial capital |
| Initial capital | inferred from the cumulative USD/% columns (`inferInitialCapital`), fallback 100,000 |
| Win rate | winners ÷ all trades (breakeven trades are in the denominator) |
| Profit factor | gross profit ÷ gross loss, capped at 999 |
| Max drawdown | equity path including each trade's adverse excursion; max $ and max % tracked separately (H2 fix). Still a lower bound. |
| Sharpe | mean(per-trade %) ÷ std(per-trade %) × **√(trades per year)**, trades per year = N ÷ years from first entry to last exit (H1 fix). Factor 1 when the dates can't be read or the span is under a day. No risk-free rate. |
| Sortino | mean ÷ √(mean of min(r, 0)² over all N trades) × the same factor (L1 fix) |

Before the fixes (`cc6d187`): drawdown was closed-trade only with the % taken at the largest-$ point;
Sharpe and Sortino used √min(252, N); Sortino used only losing trades ÷ (n_neg − 1).

## 8. Setup and commands (verified 2026-10-18; Bun 1.4.2, Node 22)
```
bun install --frozen-lockfile   # 92 packages
bun run typecheck               # passes
bun run test                    # 9/9 pass (tests/)
bun test research/audit         # 9/9 pass, audit evidence (does not change src)
bun run build                   # passes; dist/ ≈ 10 MB (content.js 5.0 MB with Plotly, demo.gif 4.8 MB)
bun run lint                    # BROKEN: eslint not in devDependencies, no eslint.config.js
```
Loading the extension: `chrome://extensions` → Developer mode → Load unpacked → `dist/`.
**Running an optimization needs Chrome, a logged-in TradingView session and a strategy on the
chart. This is not possible in a headless CI container.**

## 9. Dependencies and integrations
- **Runtime:** `plotly.js-dist-min` (3D heatmap), `webextension-polyfill`.
- **Build:** vite 6, @crxjs/vite-plugin, typescript 5.7, sharp.
- **External:** only tradingview.com (DOM automation and the `chrome.debugger` CDP calls
  `Runtime.evaluate` and `Input.insertText`); roboquant.dev links with UTM tags.
- No API keys or environment variables.

## 10. Tests
Since the fixes:
- `bun run test` runs 44 tests in 6 files: `tests/selection.test.ts` (C1/C2), `tests/dates.test.ts`
  (C3), `tests/trades.test.ts` (with H2), `tests/ratios.test.ts` (H1/L1) and
  `tests/propfirm.test.ts` (H3).
- `bun test research/audit` runs 4 characterisations of still-open issues (A5, A6, A7, A8).
- `src/propfirm.ts` was also cross-checked against the independently tested Python Lucid evaluator
  (`lucid_eval` in the user's trade-backtest repo, `futures/intraday_backtest.py`): 600 random
  cases, 0 mismatches in passes, breaches and unresolved attempts.

Original state at `cc6d187`:
- **`tests/`:** CSV header compatibility (Sept 2026 export, legacy "Net P&L %"); Sharpe > 0;
  capital inference; UTM links.
- **`research/audit/metrics-audit.test.ts`:** characterisation tests A1–A9 that reproduce the
  audit issues. Invert each into a regression test when it is fixed.
- **Not covered:** the optimization loop, walk-forward, selection, prop-firm check and DOM
  automation (content.ts and optimizer-ui.ts are not importable in tests because of
  side effects at load).

## 11. Audit: issues that can distort reported performance (prioritised)
**Status (branch `audit-fixes`):**
- **FIXED:** C1 (`2e815ec`), C2 (`e7902d8`), C3 (`10dd799`), H2 (`d7e74db`), H1 + L1 (`5f3e85c`),
  H3 (`ec2e7b3`). Each has regression tests in `tests/`. None has been exercised in a logged-in
  TradingView session yet (see §12).
- **OPEN:** H4, M1–M6, L2–L8.

The descriptions below are the original findings; line numbers refer to `cc6d187`.

Evidence: "A#" = reproducing test in `research/audit/metrics-audit.test.ts`; "code" = file and line
reference.

**Critical: invalidates the reported result**

**C1 Single walk-forward selects the "best" run using the OOS period**
- Where: content.ts 2702–2736: `combinedScore = 0.4·IS + 0.6·OOS` over all runs. Rolling mode is
  not affected (it selects on IS, l.2463–2468).
- Effect: the "Out-of-Sample" column and the overfitting score are in-sample for the selected run.
  With zero true edge the selected run shows OOS ≈ +1.8σ (**A9**).

**C2 Failed trade extraction is recorded as a valid zero-metric run**
- Where: CSV timeout returns `trades: []` (l.487–494). Catch blocks only warn (2575–2583, 2846–2854,
  2372–2377). `calculateMetricsFromTrades([])` returns all zeros (**A5**).
- Effect: under "Min Drawdown" such a run beats every real run. When the real runs lose money, a
  failed run beats them on Net % or Sharpe. Nothing flags it.

**C3 A date-range failure doesn't stop walk-forward; success isn't verified**
- Where: background.ts 442–499 returns success after clicking Apply without comparing
  `actualStart/End` to the request. The content.ts DOM path only `console.warn`s on mismatch
  (1900–1922). Callers log and continue (2331–2334, 2418–2421, 2527–2530, 2636–2639).
- Effect: the IS or OOS phase can silently run on the wrong period.

**High: biases ranking or risk**

**H1 Sharpe/Sortino are per-trade and scale with √(trade count) up to 252**
- Where: trades.ts 274–290 (**A1**: 4× trades gives 2× Sharpe).
- Effect: Sharpe is the default goal, so the optimizer is pushed toward high-frequency
  parameterisations. Values aren't comparable across symbols or timeframes and aren't annualised
  Sharpe.

**H2 Drawdown understated**
- Where: trades.ts 255–272.
- Effect: closed-trade equity only (intra-trade losses ignored, **A2**), and the % is reported at the
  largest dollar drawdown rather than the largest % drawdown (**A3**). This feeds "Min Drawdown" and
  the prop-firm check.

**H3 The prop-firm check is a fixed FTMO-style preset and is wrong for futures prop firms**
- Where: optimizer-ui.ts 141–147, 4046–4160.
- Effect:
  - $100K / 8% target / 5% daily / 10% max drawdown, with no UI to change it.
  - "Daily loss" is the largest single *trade* loss, not daily P&L.
  - Drawdown is static and closed-trade.
  - There is no end-of-day trailing max-loss logic (e.g. Lucid), and the time limit is unused.
  - A "COMPATIBLE" verdict can be false.

**H4 Backtest completion is detected heuristically**
- Where: `waitForBacktestUpdate` 1531–1558: "no visible `[class*=loading]`" plus a fixed delay.
- Effect: there's no positive check that the exported trades belong to the new parameters. The only
  safeguard is a console warning when *all* runs are identical (2913–2927). Can't be verified
  offline.

**Medium**

**M1 Rolling walk-forward headline "best run"**
- Where: content.ts 2397–2399.
- Effect: it's the best IS run across all windows. "Apply best" applies one window's IS optimum.

**M2 "Overfitting score" is heuristic**
- Where: content.ts 2074–2115.
- Effect: capped ratios, includes win rate, arbitrary thresholds; not a statistical test. Inflated
  by C1 in single mode.

**M3 No multiple-testing control**
- Effect: the number of combinations tested isn't factored into any confidence measure.

**M4 An open trade (entry row only) is counted as a closed trade with its open P&L**
- Where: trades.ts 105–110 (**A6**).

**M5 Float step accumulation can silently drop the max grid value**
- Where: content.ts 1590; the counter at ui 3399 has the same issue (**A8**).

**M6 Commission and slippage are invisible to the extension**
- Effect: results are only as realistic as the strategy's Properties. Nothing warns when
  commission or slippage is 0.

**Low**
- **L1 Sortino denominator** is non-standard (**A4**).
- **L2 Outdated blob-capture check:** it looks for `'Trade #'`, but the current header is
  `Trade number` (content.ts 428, **A7**). The other two capture paths still work.
- **L3 Lint script broken.**
- **L4 Selectors scattered:** `selectors.json` is partly bypassed by hard-coded hashed classes, with
  inconsistent date-range classes (`-rQLA_iPz` vs `-ucbE4pMM`).
- **L5 CSV escaping:** `parseCSVLine` doesn't handle escaped quotes (`""`).
- **L6 Unreachable features:** `calmarRatio` and the `anchored` walk-forward mode are declared but
  can't be selected.
- **L7 Large bundle:** Plotly plus demo.gif in `dist`.
- **L8 Breakeven trades** count in the win-rate denominator; profit factor is capped at 999.

**Verified good**
- Parameter writes are verified and failures abort (1421–1449, 2832–2839).
- Ok/commit is used rather than close-as-cancel (1390).
- The single walk-forward UI validates that IS doesn't overlap OOS (ui 4035).
- Rolling windows are non-overlapping IS→OOS (ui 1972–2017).
- CSV header normalisation tolerates renames (trades.ts 18–54).

## 12. Performance baselines
**None.** Producing one requires a **logged-in** TradingView session. The reproducible procedure is
in `research/BASELINES.md`. No number in this repo should be read as a strategy baseline.

Browser probe (2026-10-18, headless Chromium with the built `dist/`, no TradingView account):
- the `MNQ1!` chart loads; the extension's service worker starts and the content script injects its
  "Optimizer" button into the bottom-panel tab bar
- **blocked:** adding any strategy, built-in included, shows "You'll need a free account to access".
  No account was created and no credentials were used, so no optimization run could be exercised.
- the content script's global error handler logs TradingView's own benign
  "ResizeObserver loop completed" errors as `UNCAUGHT ERROR`. That's noise, not an extension fault.

## 12b. Behaviour changes introduced by the fixes (user-visible)
- **Single walk-forward:** "Best Parameters" are now the best In-Sample run. Results are usually
  less flattering out of sample, and that's the point.
- **Runs whose trade list can't be read:**
  - flagged with ⚠ in the results table
  - excluded from best and heatmap
  - if the first 3 reads all fail, the optimization aborts with an error
- **Zero-trade runs** can no longer be "best".
- **Walk-forward date range:** aborts with an error when it can't be set and verified (previously
  ran on whatever dates were loaded).
- **Max drawdown** values increase: open-trade losses now count, and the % is the true maximum.
  Saved history from before the change isn't recomputed.
- **Sharpe / Sortino** change scale: annualised by trades per year instead of √min(252, N). A
  strategy that trades rarely over a long backtest no longer gets a bonus from its length; a
  high-frequency one still scores higher when its per-trade edge holds (that is real annualisation).
  Values from saved history aren't recomputed, so don't compare them with new runs.
- **Prop Firm Challenge** section:
  - has a rule selector, defaulting to LucidFlex 25K
  - replays the best run's trades (out-of-sample when available) through sequential evaluation
    attempts
  - shows attempts passed and breached, the first attempt, the median time to pass, the worst
    session, daily-limit hits, consistency hold-backs and position size
  - the old 8/5/10 % check is still available as "Generic static challenge", now using session P&L
    instead of the largest single trade
  - the verdict is COMPATIBLE (≥ 1 pass, 0 breaches, size OK), MARGINAL (more passes than breaches)
    or AT RISK

New modules:
- `src/selection.ts`: `goalValue`, `isEligible`, `isBetterRun`, `selectBestByInSample`; shared by
  the content script and the UI.
- `src/dates.ts`: `dateInputMatches`, `dateRangeMatches`, `parseTradeTimestamp`.
- `src/propfirm.ts`:
  - `LUCID_PRESETS`, `genericPercentRules`, `resolveRules`
  - `evaluatePropFirm`, `propFirmVerdict`
  - `sessionKey` (exit at or after 17:00 chart time goes to the next session), `contractKind`

  Assumptions:
  - trades are sequential
  - worst open equity = entry equity − adverse excursion
  - intraday-trailing rules assume the run-up comes before the dip (the conservative order)
  - a soft daily loss limit liquidates at the limit and skips the session's remaining trades
  - Lucid's consistency "cushion" is ignored (conservative)

## 13. Design decisions worth keeping
- Metrics come from the exported trade list, not by scraping summary cards, so every run is scored
  identically.
- Hard abort on unapplied parameters, so stale inputs never get silently recorded.
- The debugger API is used for React date inputs, with a DOM fallback.
- Tab "wake-up" switching works around background-tab throttling.

## 14. Roadmap (do in order; one isolated change per experiment, each with a regression test)
Items 1–6 (C1, C2, C3, H2, H1, H3) are done on `audit-fixes`.

0. **Verify the fixes in a live browser (needs the user's logged-in TradingView; see §12 probe):**
   - run the `research/BASELINES.md` procedure
   - in the Prop Firm section, switch presets and check the numbers against a hand count on the
     exported trade CSV
   - force an extraction failure (hide the List of Trades tab) and check for the ⚠ / abort
   - force a bad date range and check for the abort
5. ~~H1~~ done (trades-per-year annualisation; a daily-P&L Sharpe is a possible later refinement).
6. ~~H3~~ done (Lucid presets; funded-stage rules such as payouts, scaling and the 40% Pro payout
   consistency are not modelled, since this is an evaluation check).
7. **H4:** positive completion check (fingerprint the exported CSV against the previous run plus a
   retry) and record a "possibly stale" flag.
8. Make `trades.ts`-style pure modules for selection, combinations and overfitting so they're
   testable. Fix M4/M5/L2/L3.
9. Only then: optimizer improvements (random or Bayesian search, neighbourhood-robust selection,
   walk-forward with an untouched final test period).
