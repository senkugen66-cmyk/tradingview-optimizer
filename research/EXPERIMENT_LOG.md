# Experiment log
Chronological. Every entry: objective, method, results, decision, next step. Record failures too.

---

## 2026-10-18 · E000 · Repository discovery and methodology audit (no code changes)

**Objective:** understand the system and decide whether its optimization results can be trusted.

**Method**
- Shallow clone at `cc6d187`. Read all of the result-producing code (file and line coverage is
  listed in `ROBOQUANT_PROJECT_MEMORY.md` §0).
- Ran typecheck, tests and build.
- Wrote characterisation tests `research/audit/metrics-audit.test.ts` (A1–A9) against the real
  `src/trades.ts`. For logic that isn't exported, used exact copies of the code: A8 (grid loop) and
  A9 (walk-forward selection rule).

**Results**
- Toolchain is green: typecheck pass, tests 9/9, build pass. Lint is broken.
- **Confirmed critical:**
  - C1: the single walk-forward OOS leak. Zero-edge simulation: the selected run's "OOS" is about
    +1.8σ instead of 0 (A9).
  - C2: a failed extraction counts as a zero-metric run (A5 plus code).
  - C3: a date-range failure doesn't stop walk-forward (code).
- **Confirmed high:**
  - H1: Sharpe scales with √N (A1: 4× trades gives 2.0× Sharpe).
  - H2: drawdown is closed-trade only, with the % taken at the largest dollar drawdown (A2, A3).
  - H3: the prop-firm check is a fixed FTMO preset (code).
  - H4: completion detection is heuristic (code; not verifiable offline).
- **No strategy baseline is possible offline:** backtests run in TradingView.

**Limitations**
- DOM automation paths weren't exercised; behaviour against the live TradingView DOM is
  unverified.
- Some UI rendering code was only skimmed (see the memory file §0).

**Decision:** treat all optimizer outputs, especially walk-forward "OOS" and "Min Drawdown" winners,
as **untrusted** until C1–C3 are fixed. Do not optimize yet.

**Next step:** fix C1 as an isolated change with a regression test (extract the selection logic
into a pure module); then C2, then C3. In parallel, the user runs the browser baseline procedure
in `BASELINES.md`.
