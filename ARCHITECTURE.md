# Architecture

Two packages, deliberately separated by what they are allowed to trust.

```
src/chitragupta/     execution kernel — trusts nothing, verifies everything
src/doctor/          diagnosis engine — computes, explains, proposes
```

`chitragupta` (named for the deity who records every action) never imports
`doctor`. The dependency runs one way: the diagnosis engine proposes actions;
the kernel decides whether they may happen and records what did. That direction
is what makes the security property checkable rather than aspirational.

---

## 1. The graph

```
                     ┌──────────┐
                     │  ingest  │  [DET]  batch + cohort
                     └────┬─────┘
                          ▼
                   ┌─────────────┐
              ┌────│  classify   │  [LLM]  110-code lookup, model for the rest
              │    └──────┬──────┘
   confidence │           │ confidence ≥ 0.85
      < 0.85  ▼           ▼
     ┌──────────────┐  ┌─────────────┐
     │ human_review │─▶│ bank_health │  [DET]  join vs NPCI published tables
     └──────────────┘  └──────┬──────┘
                              ▼
                       ┌─────────────┐
                       │  decompose  │  [DET]  Shapley-OB, 16 coalitions
                       └──────┬──────┘
                              ▼
                       ┌─────────────┐
                       │ hypothesise │  [LLM]  forced-choice root cause
                       └──────┬──────┘
                              ▼
                       ┌─────────────┐
                       │    plan     │  [LLM→DET]  typed actions,
                       └──────┬──────┘             gated by MEASURED error
                              ▼
                       ┌─────────────┐
                       │    gate     │  [DET]  signed mandate, policy kernel
                       └──────┬──────┘
                  ┌───────────┼───────────┐
                  ▼           ▼           ▼
             ┌─────────┐ ┌──────────┐ ┌────────┐
             │ execute │ │ merchant │ │ denied │
             └────┬────┘ └────┬─────┘ └───┬────┘
                  └───────────┼───────────┘
                              ▼
                       ┌─────────────┐
                       │   report    │  measured │ projected
                       └─────────────┘
```

**Two real branches**, both decided deterministically:

- `classify` routes to `human_review` when any classification lands below 0.85.
  When it doesn't, the untaken node still emits a `skipped` trace — a node that
  vanishes from the trace is indistinguishable from one that was never wired up.
- `gate` fans out three ways on the policy kernel's ALLOW / STEP_UP / DENY. The
  routing decision is the kernel's, never the model's.

Built on LangGraph with an equivalent sequential driver as a fallback. Both run
the *same* node functions and emit the same traces, so the fallback is not a
second implementation to keep in sync.

---

## 2. Where the LLM is, and where it deliberately isn't

| Step | Engine | Why |
|---|---|---|
| `classify` | Haiku 4.5 | ~200-code taxonomies with inconsistent free text; the real job is **generalising to codes not in the taxonomy** |
| `hypothesise` | Sonnet 4.6 | Shapley says *which* factor. Only reasoning over MCC, method mix, ticket profile and NPCI context says *why* |
| `plan` | Haiku 4.5 | mapping a cause to a typed action from a closed enum |
| **`decompose`** | **none** | it's arithmetic with a checkable answer |
| **`gate`** | **none** | a model must never decide what it is allowed to do |
| **retry list** | **none** | the process gap is *measured* from the batch; making it depend on the model noticing would leave money on the table |
| **stopping rules** | **none** | six hard rules, enforced in `policy.py` |

Every LLM call runs `temperature=0` and is cached on disk under a hash of
exactly what was sent. A clone with a warm cache needs **no API key**.

Two providers are supported and auto-detected: `ANTHROPIC_API_KEY` goes direct
to api.anthropic.com via the native SDK; `OPENROUTER_API_KEY` goes to
openrouter.ai over its OpenAI-compatible endpoint. `src/doctor/llm.py` maps
canonical model names to each provider's slug. The **cache key uses the
canonical name**, not the slug, so a cache built through one provider replays
for someone holding the other — otherwise "clone and reproduce" would quietly
mean "clone, and also happen to have the same vendor account". The serving
provider is stored in each entry and surfaced in the trace.

With neither key nor cache, calls return a **stub** labelled `stub` in the
trace and refused by every eval. A placeholder must never be mistaken for a
measurement.

---

## 3. The security property

> Even if the model is fully compromised or prompt-injected, it cannot exceed
> the mandate — because it never held the credentials, and its output is a
> validated struct drawn from a closed enum.

Mechanically:

1. The LLM emits a `root_cause_label` from a **closed enum**. Never a URL,
   never an API call, never a credential.
2. `LABEL_TO_ACTION` — a table, not a model — maps that to an `ActionType`.
3. `ProposedAction` is a frozen pydantic model. Anything malformed fails
   validation before reaching the kernel.
4. `policy.evaluate()` checks the Ed25519 signature **first**. A tampered
   mandate denies everything, before scope, amount or time are even consulted.
5. Every decision — allowed, stepped up, denied — lands in a hash-chained
   ledger.

`tests/test_policy.py` proves each branch, including that a mandate whose
`max_amount_paise` has been widened fails verification and denies.

---

## 4. The decomposition

For merchant M: `s_obs` observed, `s_star` cohort achievable, gap
`G = s_star − s_obs`. Factors `N = {bank, method, hour, amount_band}` → 2⁴ = 16
coalitions, computed exactly.

```
w(x)  = ∏_{i∈S}  q_i(x_i) / p_i(x_i)      p = merchant marginal, q = cohort
v(S)  = [ Σ w(x)·p_success(x) / Σ w(x) ] − s_obs
φ_i   = Σ_{S⊆N\{i}} |S|!(n−|S|−1)!/n! · [v(S∪{i}) − v(S)]
```

`p_success` is logistic on the log-odds of failure:

```
logit(p_fail) = logit(bank_base_fail) + β_method + β_hour + β_amount
```

The intercept is **measured** — NPCI's published BD% + TD% for that bank that
month, from the **remitter** table (the payer's issuing bank, which is who
declines a merchant's collection; the beneficiary table measures the credit leg
and runs ~99.2%, which would make every gap look fictitious). Everything added
to it is an **assumed** prior. `Baseline.explain()` returns the per-term
decomposition with provenance, so the UI can show which half is real.

**MCC conditions the baseline; it is not a factor.** Different roles, different
names, deliberately.

### Three limitations, in code

1. **Independence.** Reweighting marginals assumes it. Measured against ρ.
2. **`s_star` is an input.** Attributions are *exactly* invariant to its level —
   `v(S)` contains the cohort's factor profile but never its headline rate.
   Asserted in the sensitivity eval.
3. **Overlap (positivity).** Importance weighting can only reweight strata that
   occur. A merchant 100% on one bank has nothing to upweight: every weight is
   identical, cancels in the weighted mean, and the factor is **unidentified**,
   not small. `effective_support` (inverse Herfindahl) detects it;
   `degenerate_factors` names it; `plan.py` vetoes acting on it.

### The process gap sits outside

`NO_SOFT_DECLINE_RETRY` is not a distribution over transaction features — it's
a missing remediation policy, with no `q_i` to reweight toward. It is computed
directly, reported in its own visually distinct row, and kept **out** of the
Shapley sum so the efficiency property `Σφᵢ = v(N)` still holds exactly.

---

## 5. Ground truth

The generator does not merely inject a skew and hope. For each merchant it
holds the **exact joint distribution** over (bank × method × hour × amount) —
12 × 4 × 4 × 4 = 768 cells, small enough to compute truth with no Monte Carlo —
and runs the same Shapley machinery **analytically** over it.

```
GROUND TRUTH   analytic Shapley over the true joint, exact p_success
THE ESTIMATE   Shapley from the sampled batch, via importance weighting
DIFFERENCE     = sampling noise + weighting bias + independence violation
```

Injection strength is **calibrated by bisection**: the caller asks for a
penalty in points and the distribution shift that delivers it is solved for, so
the error grid spans a *known* range of true magnitudes.

Correlation is induced by mixing the independent joint with a Fréchet
upper-bound (comonotone) coupling on the injected pair, and the **realised** ρ
is measured and reported rather than trusting the nominal knob.

---

## 6. Data provenance

| Source | Path | Status |
|---|---|---|
| NPCI top-50 remitter banks | `data/npci/remitter_banks.csv` | 1,599 bank-months |
| NPCI top-50 beneficiary banks | `data/npci/beneficiary_banks.csv` | both sides of a failure |
| NPCI PSP performance | `data/npci/psp_performance.csv` | 960 rows |
| NPCI merchant categories | `data/npci/mcc_volumes.csv` | 46 MCCs × 32 months |
| NPCI product declines | `data/npci/product_declines.csv` | India Data Portal CKAN |
| Razorpay error taxonomy | `data/razorpay/*.xlsx` | 110 codes, hand-labelled |

npci.org.in serves **403** to every non-browser client and dataful.in is
paywalled, so bank data comes from a **pinned** Internet Archive capture — the
constant `NPCI_CAPTURE` in `scripts/fetch_data.py` is the provenance of every
NPCI number in the repo. One capture carries 32 months because NPCI keeps prior
months as tabs on a single page.

Rows failing the `approved + BD + TD = 100` identity are **quarantined** to
`anomalies.csv`, not silently repaired. One row genuinely fails: Tamilnad
Mercantile Bank, 2024-09, published as 124.22% approved.

---

## 7. Determinism

| Mechanism | Where |
|---|---|
| fixed seed `20260824` | generator, all sampling |
| `temperature=0` | every LLM call |
| on-disk LLM cache, committed | `llm_cache/`, keyed by hash of the exact request |
| pinned NPCI capture | `scripts/fetch_data.py` |
| pinned model ids | `.env.example`, echoed in the provenance bar |
| hash-based rail outcomes | `mock_rail.py` — no RNG state, no ordering dependence |
| sorted iteration | anywhere a dict order could leak into output |
| committed eval outputs | `evals/results/` |

A saved run replays exactly, which is why the demo needs no live API calls and
a panellist can watch a real recorded run with no key.

---

## 8. Layout

```
src/chitragupta/          types · canonical · mandate · ledger · policy
        rails/            mock_rail (3 calibrations) · razorpay_test_rail (stretch)
src/doctor/               features · priors · baseline · cohort · shapley · stats
                          generator · classify · hypothesise · plan
                          graph · trace · report · llm · api · run
evals/                    run_validation_sweep · run_s_star_sensitivity
                          run_npci_finding · run_classification_eval
                          run_root_cause_eval · results/ (committed)
frontend/src/app/         landing + /run/[runId]/{,flow,diagnosis,
                          validation,audit,exceptions}
tests/                    shapley (efficiency) · ledger (tamper) · policy
                          canonical
docs/                     what_broke.md · npci_finding.md
```
