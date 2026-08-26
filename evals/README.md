# Evaluation

Every number this project claims, where it came from, and the command that
regenerates it. All outputs in `results/` are committed, so nothing here needs
to be re-run to be checked — but everything here *can* be re-run, and CI fails
if any of it stops reproducing.

**Two kinds of claim, never mixed.** Anything labelled MEASURED is checked
against ground truth or verified cryptographically. Anything labelled PROJECTED
rests on an assumption stated in `src/doctor/priors.py` or
`src/chitragupta/rails/mock_rail.py`. Every rupee figure in this project is
projected, without exception.

---

## The headline numbers

| What | Value | Where |
|---|---|---|
| Attribution error, per factor | **± 0.57 pts** | `attribution_mae_by_factor.json` |
| Primary cause identified | **97.5%** | `naive_vs_shapley.json` |
| Mandate violations | **0** | every run |
| Efficiency, Σφ ÷ v(N) | **1.0000** exactly | `naive_vs_shapley.json` |
| Error classification | **87.9%** (CI 72.7–95.2) | `classification_f1.json` |
| Root cause identified | **70.0%** (CI 57.5–80.1) | `root_cause_accuracy.json` |
| Forecast error after a fix | **0.69 pts** | `outcome_accuracy.json` |
| Throughput | **4.2 merchants/sec** | `scale_benchmark.json` |

---

## How the estimator is validated

**The design.** 200 merchants are generated with a *known* cause of a *known*
size. Ground truth is not a guess — it is the same Shapley decomposition
computed **analytically** over the true generating distribution: exact joint,
exact `p_success`, no sampling, no importance weighting. The estimate is what
the engine produces from the sampled batch. The difference between them *is*
the error, and it decomposes into sampling noise, weighting bias, and the
independence assumption.

| File | Question it answers | Headline |
|---|---|---|
| `attribution_mae_by_factor.json` | How wrong is each factor's attribution? | MAE 0.57–0.58 pts, bias near zero |
| `correlation_degradation.json` | What does assuming independence cost? | accuracy 99% → 86% as ρ goes 0 → 0.8 |
| `batch_size_power.json` | How much data does a diagnosis need? | MAE 0.78 → 0.26 from n=60 to n=1000 |
| `process_gap_recovery.json` | Is the retry gap recovered? | scored against the direct formula, not Shapley |
| `failure_cases.md` | Which merchants did it get wrong, and why? | every one, with a structural reason |

`attribution_mae_by_factor.json` is **not only a report**. `src/doctor/plan.py`
loads it at runtime and gates what the agent is allowed to do on the ratio of
an attribution to its own measured error. Its shape is a contract.

Regenerate: `python evals/run_validation_sweep.py`

---

## Where it breaks

| File | Question | Headline |
|---|---|---|
| `stress_test.json` | Six hostile inputs — does it degrade loudly? | zero crashes, **no silent failures** |
| `s_star_sensitivity.json` | What would change the conclusion? | see below |

The sensitivity analysis reports three separate things, because they behave
completely differently:

- **The cohort benchmark's level** moves attributions by **exactly zero** —
  structurally, because the value function contains the cohort's factor
  *profile* but never its headline *rate*. The eval **asserts** this, so a
  regression fails the build.
- **The cohort profile** being wrong moves them 0.42 pts and flips the primary
  cause on 22.5% of merchants. This is the assumption that actually bites.
- **The assumed priors**, swept across their own stated ranges, move
  attributions up to **1.13 pts** — roughly 2× the measured MAE. NPCI publishes
  no hourly series, no card rail and no ticket split, so those coefficients are
  judgement calls and will remain so. Not fixable; made visible instead.

Regenerate: `python evals/run_s_star_sensitivity.py`, `python evals/run_stress_test.py`

---

## Compared to what?

`baseline_ladder.json` — five retry policies over the same 200 batches.
Headline is **T vs B3**, because beating "do nothing" proves nothing.

B3 (error-code-aware retry, what a good engineer builds) recovers more in
absolute terms — **but only by breaching the 3-attempt cap on 8,903 payments**,
because it does not track retries the merchant already made. That omission is
precisely what makes it a baseline. T is **1.26–1.50× more efficient per
attempt with zero breaches**.

Ratios rather than absolutes throughout: calibration error largely cancels in a
ratio and fully corrupts a total.

Regenerate: `python evals/run_baseline_ladder.py`

---

## The AI steps

| File | Question | Headline |
|---|---|---|
| `classification_f1.json` | Can it classify codes it has never seen? | 87.9%, macro F1 0.779 |
| `confusion_matrix.json` | Which classes does it confuse? | `auth_failure` is the weak one |
| `root_cause_accuracy.json` | Does it name the right cause? | 70.0%, and where the error lives |
| `verifier_ablation.json` | Does the verifier help? | see below |

**Classification holds out CODES, not rows.** All 110 published Razorpay codes
are hand-labelled in `error_labels.json` and answered by a dictionary with zero
API calls. The model exists for codes *outside* the taxonomy, so the eval
restricts the lookup to the training split and the held-out codes genuinely
reach the model. Per-class support is tiny by construction, so every rate
carries a Wilson interval rather than a bare percentage.

**Root cause splits its own error**, which is more useful than the headline:
the attribution caps the model at **73.3%**, the model follows what it was
shown **83.3%** of the time, and it is right on **88.6%** of merchants where
the attribution had already pointed correctly. That says which half to fix.

**The verifier ablation reports a result I did not claim.** Measured twice:

| merchant set | accuracy off → on | fixed / broken | violations |
|---|---|---|---|
| original | 60.0% → 61.7% | 8 / 7 | 29 → 0 |
| after regenerating | 65.0% → 70.0% | 9 / 6 | 28 → 1 |

Violations collapse decisively both times. The accuracy delta moved from +1.7
to +5.0 between two runs of the same experiment, with overlapping intervals and
nearly as many merchants broken as fixed — so the conclusion is that the
verifier makes the output **consistent**, and whether it also makes it more
**accurate** is *not established*.

Both LLM evals **refuse to run against stub responses** rather than produce a
number that looks like a measurement. They replay from the committed cache, so
they need no API key.

Regenerate: `python evals/run_classification_eval.py`,
`python evals/run_root_cause_eval.py`, `python evals/run_verifier_ablation.py`

---

## Validated on data I did not generate

The fair objection to everything above is *"you validated your estimator
against your own generator."* `backtest_npci.json` closes it: a walk-forward
backtest over **42 banks × 32 months** of NPCI's published tables, fitting on
months 1..k and predicting k+1, never looking ahead.

| predictor | 1-month MAE | 3-month MAE |
|---|---|---|
| **persistence** (latest published month) | **0.910** | **1.333** |
| smoothed EWMA over history | 1.029 | 1.393 |
| rolling 3-month mean | 1.028 | 1.448 |
| global mean (ignore the bank) | 2.371 | 2.350 |

**It went against me.** Smoothing *loses* to using the most recent month —
bank rates behave close to a random walk. `baseline.py` already pinned a single
NPCI period; that was instinct, and it is now measured.

**The finding that matters more:** knowing *which* bank cuts error **2.6×**
versus ignoring it. That is what justifies treating `bank` as a real factor
rather than noise.

`npci_finding.json` is the analysis behind `docs/npci_finding.md` — four
checkable observations from the same real data, including that UPI's bank-side
failure rate has gone **up**, not down.

Regenerate: `python evals/run_backtest.py`, `python evals/run_npci_finding.py`

---

## After the fix lands

`outcome_accuracy.json` — the attribution error says how well the engine
explains the past. This says how well it predicts the consequence of *acting*
on that explanation.

| cause fixed | predicted | measured | MAE |
|---|---|---|---|
| midnight_billing_penalty | +3.22 | +3.24 | **0.34** |
| bank_concentration | +1.74 | +1.32 | 0.58 |
| method_mix_mismatch | +0.92 | +1.60 | 0.69 |
| amount_band_risk | +0.77 | +1.37 | 1.18 |

Overall MAE **0.69 pts**, mean error **−0.22** — slightly pessimistic, which is
the safer direction to be wrong in.

`no_soft_decline_retry` is **excluded and explained** rather than reported: the
generator models `retried` as a flag and never converts a failure into a
success, so removing that gap cannot move the observed rate *by construction*.
That is a broken test, not a bad forecast, and reporting it as the latter would
be dishonest.

Regenerate: `python evals/run_outcome_eval.py`

---

## Scale

`scale_benchmark.json` — **4.2 merchants/sec, 1,445 payments/sec** on one core,
p90 of 622 ms per merchant. A million merchants is **2.1 hours on 32 cores**,
and sharding by merchant is embarrassingly parallel.

The model steps are deliberately excluded and reported separately, because they
do not need to run per merchant per night: classification is a committed lookup
for every published code, and the hypothesiser only runs where there is a gap
worth explaining. Timing them in would misrepresent the deployment.

This is the one result CI does **not** check for reproducibility — it measures
wall-clock time, which cannot be identical across machines.

Regenerate: `python evals/run_scale_benchmark.py`

---

## Running everything

```bash
make evals          # every deterministic eval
make evals-llm      # the three that replay from the LLM cache
make verify         # regenerate and fail if any committed figure moved
```

`make verify` is what CI runs. It regenerates the data, re-runs every
deterministic eval, and asks git whether a single number under `results/`
changed. If one did, the check fails and names the file.
