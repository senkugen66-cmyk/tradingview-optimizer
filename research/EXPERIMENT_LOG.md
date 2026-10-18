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

---

## 2026-10-18 · E001–E004 · Fixes for C1, C2, C3, H2 (branch `audit-fixes`)
Each fix is one commit with regression tests. Verification is offline only:

| | |
|---|---|
| typecheck | pass |
| `bun run test` | 22/22 |
| `bun test research/audit` | 6/6 |
| build | pass |

| ID | Commit | Change | Evidence |
|---|---|---|---|
| E001 | `2e815ec` | **C1:** select the single walk-forward best on IS only. Selection logic moves to `src/selection.ts`, shared by content and UI. | Zero-edge simulation: the selected run's OOS mean is ≈ 0, down from ≈ +1.8σ (`tests/selection.test.ts`). |
| E002 | `e7902d8` | **C2:** failed trade reads are flagged (`invalidReason`, `outOfSampleInvalidReason`). Invalid and zero-trade runs are never best. The run aborts if the first 3 reads fail. A single walk-forward whose selected run has unreadable OOS trades is an error; a rolling window with unreadable OOS is skipped. The UI shows ⚠. | A failed run can't win Min Drawdown or beat losing runs (`tests/selection.test.ts`). |
| E003 | `10dd799` | **C3:** date inputs are verified (format-tolerant) before Apply in both the debugger and DOM paths. Walk-forward aborts when the IS or OOS range can't be set. | `tests/dates.test.ts`. |
| E004 | `d7e74db` | **H2:** drawdown includes each trade's adverse excursion; the true max % is tracked separately. | Trade down $40k but closed +$1k now gives 40% DD (was 0%); early −20% dip now gives 20% (was 16.7%). One existing fixture expectation moved from 0.09% to 0.094% (documented). |

**Design choice in E002:** abort only on the first 3 failed reads, not on any 3 in a row.
Parameter sets with no trades may not offer an export in TradingView (unverified). Aborting
mid-sweep would turn a legitimate empty region into a failed optimization.

**Limitations**
- Not run in a browser: the DOM and debugger behaviour of E002 and E003 is unverified.
- Max drawdown is still a lower bound (intra-trade run-ups before the adverse excursion aren't
  exported).
- History saved before the fixes isn't recomputed.

**Decision:** keep all four. **Next:** browser verification (memory §14, step 0), then H1 (Sharpe
definition) and H3 (configurable prop-firm rules with Lucid presets).
