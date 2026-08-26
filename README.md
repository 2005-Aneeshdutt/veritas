# Revenue Doctor

[![CI](https://github.com/2005-Aneeshdutt/Nidaan/actions/workflows/ci.yml/badge.svg)](https://github.com/2005-Aneeshdutt/Nidaan/actions/workflows/ci.yml)

**Razorpay AI Buildathon — Track 03: AI Revenue Recovery**
Aneesh Dutt · PES University · [github.com/2005-Aneeshdutt](https://github.com/2005-Aneeshdutt)

CI runs four jobs on every push: the test suite, **a full diagnosis with no API
key** (proving the committed cache is complete), **a reproducibility check that
regenerates everything and fails if a single committed number moves**, and the
frontend build.

Every merchant can see their payment success rate. Nobody tells them what it
*should* be, whose fault the shortfall is, or what it is worth per month.

Revenue Doctor finds the gap between what a merchant collects and what their
category actually achieves, proves which causes it comes from, recovers what it
is authorised to recover — and **reports the measured error bar on its own
diagnosis, then refuses to act on anything inside it.**

> Everyone can build an agent that acts.
> This one measures how often it is wrong, and says so before you ask.

---

## The six things that are actually new

**1. The error bars change what the agent does.**
`evals/results/attribution_mae_by_factor.json` is not a slide. `plan.py` loads
it at runtime and gates on the ratio of an attribution to its own measured
error: above 2× it may act alone, 1–2× goes to the merchant, below 1× it
refuses. On QuickMart that reads *"5 fixes proposed, 3 withheld because the
attribution is inside its own error bar."*

**2. The mandate is cryptographic, and you can watch it being checked.**
Approve a fix and the UI walks the seven checks the policy kernel actually
performs — signature, validity, scope, attempt cap, recovery window, amount —
then the split (108 allowed, 82 need confirmation, 5 denied) and the audit
entries. Even a fully prompt-injected model cannot exceed the mandate: it never
held the signing key, and its output is a validated struct from a closed enum.

**3. A deterministic verifier that catches the model contradicting itself.**
Not an LLM judging an LLM — every rule is a string or arithmetic check against
the exact context the model was handed, so a violation is a fact rather than an
opinion. It caught the model citing **8 figures that appear nowhere in its
data**, each of which would otherwise have reached a merchant email, and 20
cases where it named a cause its own decomposition contradicted.

Measured honestly across two merchant sets: **violations 29 → 0 and 28 → 1**,
while accuracy moved +1.7 points once and +5.0 the next time. An effect that
unstable is not one I will claim, so it is not claimed — the verifier makes the
output **consistent**; whether it also makes it more **accurate** is not
established. Two properties, reported separately.

**4. It grades its own forecasts after the fix lands.**
Apply a fix, let a month pass, re-run: *predicted +3.22 points, measured
+3.24*. Across 8 fixes the mean absolute forecast error is **0.69 points**, and
the mean error is **−0.22** — slightly pessimistic, which is the safer
direction to be wrong in. Billing-window fixes forecast best (MAE 0.34);
ticket-size fixes worst (1.18). One cause is **excluded and explained** rather
than reported, because the harness cannot validate it.

**5. It watches the ecosystem, not just the merchant.**
NPCI publishes bank performance monthly and it moves. The drift monitor
compares three-month windows and prices the damage: **₹413 Cr/month** across
India from this quarter's degradation alone, with the exposed merchants on your
own book named and costed. Proactive rather than reactive, and running entirely
on real published data.

**6. The book view, not the merchant view.**
Merchants already have dashboards. What a payments platform does not have is
*"across our whole book, where is revenue leaking, who do we call on Monday,
and what is each call worth?"* Across the 8 demo merchants: **₹5.45L
recoverable/month**, 89.31% weighted success against 90.89% achievable, triaged
into 4 urgent / 2 not-yet-resolvable / 2 healthy — and aggregated **by cause**,
because one merchant with a billing-window problem is a support ticket and
forty is a product change.

---

## Recovery across a batch

```
RECOVERY  (2,840 payments, 316 failed)
  executed        108 actions under a signed mandate
  recovered       ₹6,824                 [PROJECTED, central calibration]
  still on table  ₹55,484 – ₹1,14,878    [PROJECTED range, 3 calibrations]
  unrecoverable   ₹1,97,671 across 121 payments — listed, not dropped
  escalation      108 auto / 82 to merchant / 5 denied by mandate
  audit           195 ledger entries, chain VERIFIED, 0 mandate violations
```

Every rupee is labelled **PROJECTED**, and the label is load-bearing. Recovery
from a synthetic batch cannot be *measured* — the retry-success model is an
assumption — so it ships as a **range across three calibrations**, never one
confident number.

---

## What is measured

200 merchants, each carrying a **known** cause of a **known** size. Ground truth
is the same Shapley decomposition computed *analytically* over the true
generating distribution — exact joint, exact `p_success`, no sampling. The
difference between that and what the engine produces from the sampled batch
**is** the error.

| Factor | MAE (pts) | bias | p90 | coverage ±0.5 |
|---|---|---|---|---|
| bank | 0.538 | +0.012 | 1.136 | 58.0% |
| method | 0.530 | −0.009 | 1.194 | 59.0% |
| hour | 0.529 | −0.005 | 1.187 | 63.0% |
| amount_band | 0.532 | −0.022 | 1.157 | 62.5% |

Primary-cause accuracy **96.3%** · mean residual **0.47 pts** · mandate
violations **0** · Σφᵢ = v(N) to machine precision, asserted in tests.

**The AI steps, including where they fall short.** Classification **87.9%**
(95% CI 72.7–95.2) on 33 held-out *codes*; the brief aimed at >95%. Root cause
**70.0%** (95% CI 57.5–80.1); the brief aimed at >85%. Both go in as measured.
Three of the four classification errors are boundary calls where the model's
answer is defensible — **I did not move ground truth to match it.**

More useful than the 70% is where the error lives: the attribution itself caps
the model at **73.3%**, and the model follows what it was shown **83.3%** of the
time — correct on **88.6%** of the merchants where the attribution had already
pointed at the right cause. That says clearly which half to fix first.

---

## Does it scale?

**4.2 merchants/sec, 1,445 payments/sec** on one core over the full 200-merchant
sweep — p90 of 622 ms per merchant. A million merchants is **2.1 hours on 32
cores**, and sharding by merchant is embarrassingly parallel.

The model steps are deliberately excluded from that figure and reported
separately, because they do not need to run per merchant per night:
classification is a committed lookup for every published code, and the
hypothesiser only runs where there is a gap worth explaining. Timing them in
would misrepresent how this would actually be deployed.

---

## Validated on data I did not generate

The fair objection to every eval above: *"you validated your estimator against
your own generator."* So the success model's one empirical claim — that a
bank's published rate predicts next month — is backtested walk-forward on **42
banks × 32 months of real NPCI tables**, never looking ahead:

| predictor | 1-month MAE | 3-month MAE |
|---|---|---|
| **persistence** (latest published month) | **0.910** | **1.333** |
| smoothed (EWMA over history) | 1.029 | 1.393 |
| rolling 3-month mean | 1.028 | 1.448 |
| global mean (ignore the bank) | 2.371 | 2.350 |

**It went against me, and that is the useful kind.** Smoothing *loses* to
simply using the most recent month — bank rates behave close to a random walk.
`baseline.py` already pinned a single NPCI period; I had chosen that by
instinct and it is now measured.

**The finding that matters more:** bank-specific prediction beats the all-bank
mean by **2.6×**. Knowing *which* bank a payment goes through is genuinely
predictive — which is what justifies treating `bank` as a real factor rather
than noise. Previously an assumption; now evidence.

---

## Compared to what?

A recovery number with no baseline is not a result. Five policies over the same
200 batches — headline is **T vs B3**, because beating "do nothing" proves
nothing:

| policy | recovered | attempts | **over the cap** | ₹/attempt |
|---|---|---|---|---|
| B1 retry once | ₹49.4L | 8,256 | 0 | ₹598 |
| B2 backoff ×3 | ₹161L | 24,768 | 11,538 | ₹651 |
| B3 error-code aware | ₹182L | 15,543 | **8,463** | ₹1,173 |
| **T Revenue Doctor** | ₹114L | 7,080 | **0** | **₹1,613** |

B3 is what a good engineer builds, and it recovers more — **but only by
breaching the 3-attempt cap on 8,463 payments**, because it does not track
retries the merchant already made. T is **1.27–1.50× more efficient per
attempt with zero breaches.**

---

## Where it degrades, and where it refuses

| Injected ρ | accuracy | | Batch size | MAE | Wilson ±pts |
|---|---|---|---|---|---|
| 0.0 | 99.2% | | 60 | 0.780 | 7.73 |
| 0.2 | 88.2% | | 150 | 0.562 | 5.12 |
| 0.5 | 91.7% | | 400 | 0.424 | 3.10 |
| 0.8 | 85.7% | | 1000 | 0.264 | 2.01 |

Under ~400 payments a month, merchants are **told the diagnosis isn't
resolvable** rather than handed a ranking of noise.

**Hostile inputs:** six attacks, **zero crashes, no silent failures** — every
case where error rose materially was flagged. Worst case is a single-bank
merchant at 4.89× control MAE, caught by the overlap check on all 12.

**The uncomfortable one:** sweeping every *assumed* prior across its stated
range moves attributions by up to **1.13 pts — roughly 2× the measured MAE**.
Not fixable without data NPCI does not publish. What *is* fixable is making it
visible: every coefficient carries a provenance field and a range.

---

## Was the complicated method necessary?

I predicted naive attribution would pick the wrong cause ~31% of the time vs
Shapley's 6%. **It did not reproduce** — 97.5% vs 96.3%, disagreeing on 1.2%.

So I measured what Shapley *does* buy:

```
sum(attribution) / v(N)     1.000 = the parts add up to the whole
  Shapley   mean 1.0000     max deviation 0.00e+00
  Naive     mean 2.3934     range −11.28 … +31.37
```

Naive **ranks** fine; its **magnitudes are incoherent**, averaging 2.4× the real
gap. You cannot convert that into rupees — and every output here is a rupee
figure derived from a magnitude.

---

## What 32 months of real NPCI data say

The only numbers here that come from reality rather than my generator. 1,599
remitter bank-months. Full write-up: [`docs/npci_finding.md`](docs/npci_finding.md).

- **UPI's bank-side failure rate has gone up, not down** — median top-50 bank
  +0.62 pts over three years, only 32% improved. Survivorship biases that
  *toward* optimism, so it is likely worse.
- **Technical declines are mostly not systemic** — median pairwise correlation
  r=0.119. This argues against my own initial framing and *strengthens* the
  product: because failures are idiosyncratic, bank mix genuinely matters.
- **Nine failures in ten are business declines, not technical** (median
  technical share 8.9%) — which is why the retry model is timing-based.
- **A ~1.6 pt annual cycle peaking at the Indian fiscal year end.**

---

## What broke

**Fourteen things. Twelve found by a measurement disagreeing with me, not by a
crash** — the last one by a check I wrote to prove the others were safe. Full write-up: **[`docs/what_broke.md`](docs/what_broke.md)** — the
best 10 minutes you can spend in this repo.

The short version: my best slide didn't reproduce · a test failed with the
wrong *sign* and uncovered the positivity assumption · the validation grid was
confounded because 5 divides 10 · **the ground truth was wrong and the model
was right** · the agent reported a mandate violation for correctly escalating ·
the baseline ladder caught a bug in my own policy and the fix produced a better
claim than winning would have · the baseline modelled the wrong leg of the
transaction · healthy merchants were queued for calls they didn't need · and
the demo was quietly serving placeholder output because I killed Node but not
Python · the verifier I was confident about turned out to fix consistency
rather than accuracy, after an 8-merchant pilot showed +12 points and the full
60 showed noise · **and the reproducibility check failed on its first run,
because Python randomises string hashing and my set iteration was silently
changing float summation order.**

---

## Architecture

```
ingest ──▶ classify ──low confidence──▶ human_review ──┐
            [LLM]                                       │
              │ confidence ≥ 0.85                       │
              ▼                                         │
        bank_health [DET]  ◀── NPCI join ───────────────┘
              ▼
         decompose [DET]   Shapley-Oaxaca-Blinder, 16 coalitions
              ▼
        hypothesise [LLM]  forced-choice root cause
              ▼
           plan [LLM]      typed actions, gated by MEASURED error
              ▼
           gate [DET]      signed mandate · policy kernel
        ┌─────┼─────┐
        ▼     ▼     ▼
    execute  merchant  denied
        └─────┼─────┘
              ▼
           report          measured │ projected
```

**Deterministic wherever correctness is checkable; a model only where judgement
is required.** The gate, the decomposition, the retry list and all six stopping
rules never consult a model. See [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Run it

```bash
make setup      # python + frontend dependencies
make demo       # backend :8000 + frontend :3000
make test       # 63 tests
make verify     # regenerate everything, fail if any committed number moved
```

`dev.sh` preflights the data files and prints whether the LLM is keyed,
cache-only, or about to emit stubs — so nobody demos placeholders by accident.

**Reproduce every number** — fixed seed, `temperature=0`, pinned NPCI capture,
committed LLM cache, committed eval outputs:

```bash
python scripts/fetch_data.py               # pinned Internet Archive capture
python scripts/build_error_labels.py       # 110 hand-labelled codes
python scripts/generate_batch.py --demo --sweep 200
python evals/run_validation_sweep.py       # the headline numbers
python evals/run_baseline_ladder.py
python evals/run_s_star_sensitivity.py
python evals/run_stress_test.py
python evals/run_npci_finding.py
python evals/run_backtest.py               # out-of-sample, real NPCI data
python evals/run_outcome_eval.py           # forecast accuracy after a fix
python evals/run_scale_benchmark.py        # throughput at book scale
pytest -q                                  # 63 tests
```

The LLM evals need a key **once** to populate the cache; after that they
reproduce offline, and they **refuse to run against stub responses** rather than
produce a number that looks like a measurement. Either provider works —
`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`.

---

## Three limitations, stated before they're asked

1. **Collinearity.** Reweighting marginals assumes independence. Quantified
   above against ρ.
2. **The cohort benchmark is an input, not a discovery** — but the attributions
   are *exactly* invariant to its level, structurally, because `v(S)` contains
   the cohort's factor profile and never its headline rate. Asserted in the eval.
3. **Overlap.** Importance weighting can only reweight strata that occur. A
   merchant 100% on one bank has nothing to upweight, so that factor is
   *unidentified* rather than small. Detected, reported, and vetoed from
   auto-execution.
