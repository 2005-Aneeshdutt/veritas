# What 32 months of NPCI data actually say

Every other number in this project comes from data I generated. This page does
not. It comes from NPCI's own published top-50 bank tables — **1,599 remitter
bank-months, 2023-01 to 2025-08** — parsed from a pinned Internet Archive
capture and committed to `data/npci/`.

Reproduce with `python evals/run_npci_finding.py`. Raw output:
`evals/results/npci_finding.json`.

---

## 1. UPI's bank-side failure rate has gone **up**, not down

This is the finding I did not expect.

UPI is reported as an unqualified success story, and by volume it is. But on
the remitter side — the payer's issuing bank, which is the leg that actually
declines a merchant's collection — **performance has degraded**:

- Median top-50 bank: **+0.62 points worse** (first 6 months vs last 6)
- Only **32% of banks improved**. Two thirds got worse.

The movers, in points of total failure rate (BD% + TD%):

| Improved most | 2023 | 2025 | change |
|---|---|---|---|
| ESAF Small Finance Bank | 19.42% | 5.08% | **−14.34** |
| Andhra Pragathi Grameena Bank | 26.63% | 16.79% | −9.84 |
| Bandhan Bank | 13.12% | 6.13% | −6.99 |

| Worsened most | 2023 | 2025 | change |
|---|---|---|---|
| AU Small Finance Bank | 5.65% | 11.22% | **+5.57** |
| Yes Bank | 4.53% | 9.04% | +4.52 |
| IndusInd Bank | 6.12% | 10.58% | +4.46 |

The pattern is convergence from both ends: banks that were terrible got much
better, banks that were good got noticeably worse. AU, Yes and IndusInd roughly
**doubled** their failure rates while carrying serious volume.

**Why a merchant should care.** A merchant choosing where to route, or reading
their own numbers, is working from a mental model formed years ago. Yes Bank at
4.5% and Yes Bank at 9.0% are different propositions, and nothing in a
merchant's dashboard tells them which one they are looking at.

**Caveat, stated plainly.** The top-50 list is re-cut monthly, so this compares
banks present in at least 24 of 32 months. That is a survivorship-filtered
population: banks that dropped out of the top 50 entirely are not counted, and
they are more likely to be the bad ones. If anything, that biases the result
**toward** improvement — so the real degradation is likely worse than +0.62.

---

## 2. Technical declines are mostly **not** systemic

The intuition behind the ecosystem join was that when banks fail, they fail
together — shared NPCI infrastructure, correlated outages. Across 820 bank
pairs with 18+ common months:

- median pairwise correlation of monthly TD%: **r = 0.119**
- 69% of pairs positive, but only **7% above r = 0.5**

So there is a faint common component and **technical declines are overwhelmingly
bank-specific**. A minority of pairs do move together strongly:

| pair | r |
|---|---|
| Fino Payments Bank ↔ IDFC Bank | 0.896 |
| State Bank of India ↔ Fino Payments Bank | 0.854 |
| State Bank of India ↔ IDFC Bank | 0.787 |
| HDFC Bank ↔ IDBI Bank | 0.773 |

**This result argues against my own initial framing, and it strengthens the
product.** If bank failures were mostly systemic, a merchant's bank mix would
barely matter and the `bank` factor in the decomposition would be noise.
Because they are mostly idiosyncratic, "is this me or is this everyone?" is a
real question with a real answer — which is exactly what the NPCI join
computes.

I would rather report r = 0.119 and explain what it means than not have looked.

---

## 3. Nine failures in ten are the customer, not the pipes

Across the same population, the **median bank's technical declines are 8.9% of
its total failures**. The other ~91% are business declines: insufficient funds,
limits, blocks.

Two consequences, both load-bearing for this project:

1. **Retry logic is aimed at the right target.** Most failures are the customer
   not having money right now, which is a timing problem — the thing a
   correctly-timed retry actually fixes. That is why `mock_rail.py` models
   soft-decline retry success as improving with delay (salary lands, account
   is topped up) and *deliberately does not* use `1 − bank_BD%`.

2. **"The bank is down" is usually the wrong diagnosis.** A merchant blaming
   infrastructure is, nine times in ten, looking at customers who could not
   pay. The failure-mix split is measured per bank per month, so the engine can
   tell those apart instead of guessing.

Failure mix is also **not stable** for everyone. RBL and IDBI both swing their
technical share by **0.66** across the window — from near-zero to two thirds of
all failures — which is the signature of real incidents rather than a steady
state.

---

## 4. There is a clear annual cycle, and it peaks at India's fiscal year end

Volume-weighted ecosystem failure rate by calendar month:

```
Jan  7.40%   Apr  7.49%   Jul  6.56%   Oct  6.89%
Feb  7.76%   May  6.41%   Aug  6.56%   Nov  6.65%
Mar  7.35%   Jun  6.37%   Sep  6.15%   Dec  6.93%
```

**January–April run 7.3–7.8%. May–September run 6.1–6.6%.** That is a ~1.6
point swing between the worst month (February) and the best (September) — large
enough to swamp most of the merchant-specific gaps this project diagnoses.

The high band brackets the Indian fiscal year end on 31 March. I am not going
to claim the mechanism from this data alone; monthly aggregates cannot separate
year-end banking load from tax-season cash pressure from anything else.

**What it means operationally:** a merchant comparing February to September and
concluding their payments got better has learned nothing about their own
system. Any honest cohort benchmark has to be period-matched — which is why
`s_star` is computed against a **pinned NPCI period** rather than a blended
average, and why the period is printed in the provenance bar.

---

## What this is and isn't

It is four checkable observations from public data that, as far as I can find,
nobody has published together: the degradation trend, the weak cross-bank
correlation, the 9-to-1 business/technical split, and the fiscal-year cycle.

It is **not** causal. These are monthly aggregates over a changing top-50
population. Correlation across banks does not establish a shared dependency;
seasonality does not establish a mechanism; a bank getting worse does not say
why.

Every claim here is reproducible from the committed CSVs with one command.
