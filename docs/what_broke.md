# What broke, and how I got out

Fourteen things. **Twelve were found by a measurement disagreeing with me, not
by a crash** — which is the whole reason I built the validation harness before
the demo rather than after it. The last one was found by a check I wrote to
prove the others were safe.

Each entry says what I expected, what actually happened, how I found it, and
what changed. They are ordered by how much they hurt.

---

## 1. My best slide didn't reproduce

**Expected.** The plan said naive attribution would pick the wrong primary
cause ~31% of the time and Shapley ~6%. That was the whole justification for
building the complicated method.

**What happened.** Across 200 merchants: naive **97.5%**, Shapley **96.3%**.
They disagreed on **1.2%** of merchants, and naive won both disagreements.

I did not want to believe it, so I built six regimes specifically designed to
favour Shapley — up to four correlated causes at ρ=0.8. Both hit **100%** in
every single one.

**Why.** Factor effects are additive in log-odds, and the success
probabilities sit in a near-linear stretch of the logistic. So the value
function is close to additive, and when `v` is additive Shapley *reduces to*
naive by construction. The sophistication had nothing to bite on.

**How I got out.** I could have quietly shipped the projected number — nobody
would have checked. Instead I asked what Shapley actually buys, and measured
that:

```
sum(attribution) / v(N)      1.000 = the parts add up to the whole
  Shapley   mean 1.0000      max deviation 0.00e+00
  Naive     mean 2.3934      range -11.28 .. +31.37
  naive overstates the total on 74% of merchants
```

Naive ranks fine. Its **magnitudes are incoherent** — averaging 2.4× the real
gap, ranging from −11× to +31×. You cannot turn that into rupees. Shapley's sum
to exactly 100% by the efficiency axiom, and every output of this product is a
rupee figure derived from a magnitude rather than a ranking.

**The honest version is a better claim than the one I planned**, and it is the
only one I can defend.

---

## 2. A test failed with the wrong *sign*, and found a real limitation

**Expected.** Concentrate a merchant's payments onto a bad bank; the bank
factor should carry more of the gap.

**What happened.**

```
assert concentrated.by_factor()["bank"] > spread.by_factor()["bank"]
E  assert -2.670 > 0.221
```

Not merely small. **Negative.** A wrong magnitude is a tuning problem. A wrong
sign means the mechanism is wrong.

**Why.** With 100% of payments on one bank, every importance weight is the
*same number*. A constant weight cancels in a weighted mean. The reweighting
did nothing at all, and the value returned was noise.

This is the **positivity (overlap) assumption** from causal inference:
importance weighting can only reweight strata that actually occur. It bites
hardest on exactly the merchants whose problem looks most obvious.

**How I got out.** Two changes. The tests now use 70/30 skews, which is what
the generator injects and what real merchants look like — at 70% the sign is
correct and the effect is large (+3.48). More importantly, the method now
**detects and reports** the degenerate case: `effective_support` (inverse
Herfindahl) per factor, `degenerate_factors` for those below threshold, and a
hard veto in `plan.py` so an unidentified factor can never be auto-executed.

A limitation I would have had to concede in an interview became a mechanism
that demonstrates the thesis.

---

## 3. The validation grid was confounded, and the bug looked like a result

**Expected.** Accuracy improves with batch size.

**What happened.** It did — 93% at n=60, 95.5% at n=150, 100% at n=400 — and
then **0.0% at n=1200**. A clean monotone curve with one impossible point.

**How I found it.** The number was too wrong to be noise. I grouped the sweep
by batch size and printed which causes appeared in each bucket:

```
n=60    bank_concentration, bank_concentration+no_soft_decline_retry
n=120   midnight_billing_penalty, midnight_billing_penalty+amount_band_risk
n=1200  (), no_soft_decline_retry
```

**Why.** The sweep indexed every dimension off the loop counter:
`CAUSE_POOL[i % 10]` alongside `sizes[i % 5]`. Because **5 divides 10**, batch
size was *perfectly* confounded with which causes were injected. Every n=1200
merchant had no Shapley factor injected at all, so "which factor carries the
most" was pure noise and 0% was the correct answer to a meaningless question.

The batch-size curve and the correlation curve were both meaningless. Neither
crashed. Both produced plausible-looking numbers.

**How I got out.** Replaced modular indexing with a full factorial, shuffled by
the seeded RNG. The curves became interpretable: MAE 0.78 → 0.26 as n goes
60 → 1000; accuracy 99.2% → 85.7% as ρ goes 0 → 0.8.

**Lesson I'd repeat:** `i % a` and `i % b` are independent only when `a` and
`b` are coprime. An aliased grid doesn't fail loudly — it returns a number.

---

## 4. The ground truth was wrong and the model was right

**Expected.** Root-cause accuracy around 85%.

**What happened.** 40% on the first 5 merchants. Both "healthy" merchants —
the ones with nothing injected, where the correct answer is
`none_of_the_above` — were called `no_soft_decline_retry` and
`method_mix_mismatch`.

**The tempting conclusion** was that the model was overreaching. I checked the
data instead.

**Why.** My generator retried only 75% of recoverable failures even for
merchants with nothing injected. So a "healthy" merchant genuinely had **a
quarter of its soft declines sitting unretried** — a real process gap, which a
good diagnosis *should* name. I was marking the model **wrong for being
right.**

**How I got out.** Healthy merchants now retry everything, so the label means
what it says. I passed `retry_rate=1.0` rather than skipping the RNG draw,
which kept the random stream identical — and every Shapley number in the sweep
re-ran **byte-for-byte unchanged**, confirming the fix touched only the
`retried` flag and nothing else.

Root cause went to 60%. Still below target, and reported as measured.

**Lesson:** when a model disagrees with your ground truth, check the ground
truth first. It is the less comfortable direction to look.

---

## 5. The agent reported a mandate violation for behaving correctly

**Expected.** `0 mandate violations`, always. It is a binary safety claim.

**What happened.** First end-to-end run: **`1 mandate violations`**.

**Why.** The gate correctly ALLOWed a `FLAG_FOR_INVESTIGATION` — escalating to
a human is inside the mandate. But `node_execute` labelled *any* allowed
action's outcome as `executed`, and the violation check counts anything
`executed` that isn't auto-executable. So the counter fired **every time the
agent correctly escalated to a human.**

**How I got out.** Added `escalated` as a distinct ledger outcome. Flagging a
payment for a person is permitted, but it is not the agent acting on the
payment, and collapsing the two made the safety metric lie.

**Lesson:** the bug was in the *measurement*, not the mechanism. A safety
counter that cries wolf is as dangerous as one that stays silent — you learn to
ignore it.

---

## 6. The baseline comparison caught a bug in my own policy

**Expected.** Build the policy ladder (B0–B3 vs mine), show mine wins.

**What happened.** Mine recovered **31% of what B3 recovered**. A third.

**Why.** `policy_t` skipped already-retried payments entirely. Those payments
have `attempts=2` and the mandate allows 3 — so there was a whole remaining
attempt per payment that my agent was declining to use. I was giving away real
money to look disciplined.

**How I got out.** T now spends the *remaining* budget instead of skipping. But
the more interesting discovery came from fixing it: B1/B2/B3 don't track prior
attempts at all, which means they **breach the 3-attempt cap**. Once I counted
that:

| policy | recovered | attempts | **over the cap** | ₹/attempt |
|---|---|---|---|---|
| B3 good engineer | ₹18.2L | 15,543 | **8,463** | ₹1,173 |
| **T Revenue Doctor** | ₹11.4L | 7,080 | **0** | **₹1,613** |

B3 still recovers more in absolute terms — **but only by doing 8,463 things the
mandate forbids.** T is 1.27–1.50× more efficient per attempt with zero
breaches.

**That is a better result than winning outright would have been**, and I only
have it because I built the baseline honestly enough to lose to it first.

---

## 7. The baseline modelled the wrong leg of the transaction

**Expected.** Anchor `p_success` on NPCI's published bank tables. Simple.

**What happened.** Every merchant came out at ~99.5% success. Real merchant
payment success is 85–92%. The gap the entire product exists to diagnose
essentially did not exist.

**Why.** NPCI publishes two tables. I used **beneficiary**, which measures the
*credit* leg — did money land in the payee's account — and runs ~99.2%
approved. But a merchant's collection is declined by the **payer's issuing
bank**, which NPCI reports on the **remitter** side, where the median sits near
92%.

I had joined real data, parsed it correctly, and modelled the wrong half of the
payment.

**How I got out.** Switched to `remitter_banks` and wrote the reasoning into the
loader's docstring so the next person doesn't undo it. Success rates landed at
88–93% and the gaps became real.

---

## 8. Clamping punished a reweighting that was doing nothing wrong

**Expected.** Clamp importance weights to `[0.05, 20]` so one rare transaction
can't dominate. Report the clamp rate as a reliability signal.

**What happened.** Clamp rates of 0.24–0.53 on *ordinary* merchants, flagging
**93 of 200** as unreliable. A reliability signal that fires on half your
population is not a signal.

**Why.** Across a four-factor coalition the weights **multiply**. The whole
vector drifts orders of magnitude from 1 while every transaction still carries
a perfectly reasonable *share* of the total — and that common scale factor
cancels in the weighted mean anyway. I was clamping a quantity that did not
matter.

**How I got out.** Normalise by the mean first, then clamp the **relative**
weight. Mean clamp rate fell to 0.096. Separately, reliability became
per-factor: a grocery merchant is ~88% UPI so `method` is unidentified for
almost all of them, but that says nothing about whether their *bank*
attribution is sound. Unreliable: 93/200 → 22/200.

---

## 9. The demo merchants were too small to diagnose

**Expected.** The spec's demo sizes — 142, 87, 63 payments — clear the "50+
record batch" bar.

**What happened.** Two of three came out with a **negative** gap — apparently
*outperforming* their category — despite carrying large deliberately injected
problems.

**Why.** At n=63 the Wilson half-width on the observed success rate is **±4.5
points**, larger than the effects being attributed. The batch sizes were chosen
to clear a rule, not to support an inference.

**How I got out.** I did not seed-shop for a luckier draw — that is precisely
the cherry-picking this project argues against. I regenerated at realistic
monthly volumes and turned the problem into product behaviour:
`is_underpowered()` compares the interval against the gap and refuses to rank
noise. The batch-size curve became a published result:

| n | MAE | Wilson ±pts |
|---|---|---|
| 60 | 0.780 | 7.73 |
| 150 | 0.562 | 5.12 |
| 400 | 0.424 | 3.10 |
| 1000 | 0.264 | 2.01 |

---

## 10. The first "apply fix" button always opened with a denial

**Expected.** Add a button, approve the fix, watch the mandate check pass.

**What happened.** Every single fix opened with `DENY_AMOUNT_ABOVE_CEILING`.

**Why.** I picked the *largest* action of each type as the representative
one — which is exactly the action most likely to exceed the merchant's ceiling.
The first thing anyone saw was the agent being refused.

Worse, it revealed a design error: approving "retry this one ₹24,000 payment"
is the wrong product shape. A merchant approves *"retry the soft declines"*.

**How I got out.** Fixes are now grouped and approved as a batch — but grouping
is presentation only. Every underlying action is re-resolved from the stored
run and re-gated individually, so posting a modified amount gets it denied
rather than executed. QuickMart now reads: 108 allowed, 82 need confirmation, 5
denied by the ceiling, ₹6,824 recovered, chain verified.

---

## 11. Healthy merchants were being queued for calls they didn't need

**Expected.** Build the book-level view, rank merchants by money on the table.

**What happened.** FuelStop — the deliberately healthy merchant with a 0.40
point gap — was filed under **"insufficient data"**, alongside Chai Point,
whose gap was *negative*.

**Why.** My triage ran the statistical-power check *before* the gap check. But
`is_underpowered` compares the confidence interval against the gap — so a
merchant with almost no gap trips it **by construction**. Every healthy
merchant looked like a data problem.

**How I got out.** Gap first, then power. You do not need statistical power to
conclude there is no large gap when the point estimate is 0.4 points.

**Lesson:** a threshold defined as a ratio behaves badly as the denominator
goes to zero, and the failure is silent because the output is still a valid
category.

---

## 12. The demo was quietly serving placeholder output

**Expected.** Add the API key, restart, everything runs on real model output.

**What happened.** The API kept returning
`"STUB -- no model was called"` long after the key was working from the CLI.

**Why.** Two separate operational mistakes. The uvicorn process had been
started *before* `.env` existed and was still holding the port — I had killed
Node but not Python. And separately, `data/runs/` held **18 stubbed runs** from
before the key, while `/api/health` sorted runs *alphabetically on a random hex
id*, so clicking through could land on one whose diagnosis read "STUB".

**How I got out.** Stub runs purged, one canonical real run kept per merchant,
ordering by modification time. `scripts/dev.sh` now prints whether the LLM is
keyed, cache-only, or about to emit stubs, so nobody can demo placeholders by
accident.

**Lesson:** the code was right and the deployment was lying. I only caught it
because I opened the product the way a stranger would, rather than testing the
function I had just written.

---

## 13. The fix I was confident about didn't fix what I built it for

**Expected.** Root-cause accuracy was 60%, and I had already decomposed why:
the attribution caps the model at 75%, but the model followed what it was shown
only **63%** of the time. That gap is the model ignoring its own evidence — a
fixable failure. So I built a deterministic verifier: five rules checked
against the exact context the model was handed, with one repair attempt quoting
the broken rules back.

I was confident enough that I ran it on 8 merchants first and got **62.5% →
75.0%**. A twelve-point jump.

**What happened on all 60 — and then again later:**

| merchant set | accuracy off → on | fixed / broken | violations |
|---|---|---|---|
| original | 60.0% → 61.7% | 8 / 7 | 29 → 0 |
| after regenerating | 65.0% → 70.0% | 9 / 6 | 28 → 1 |

**+1.67 points was noise.** Eight merchants improved, seven regressed,
intervals overlapping almost entirely. The 8-merchant pilot had been a lucky
draw — exactly the trap this project exists to avoid, and I nearly walked into
it with my own result.

Then the merchant data changed for an unrelated reason, I re-ran, and got
**+5.00**. Very tempting. But 9 fixed against 6 broken is a net of three
merchants out of sixty, the intervals still overlap heavily, and **an effect
that moves from +1.7 to +5.0 between two runs of the same experiment is not an
effect.** The point estimate is reported; the claim is not made.

**What the verifier definitely does.** Violations collapse in both runs — 29→0
and 28→1. The model was **contradicting its own evidence even on merchants it
got right**, naming a primary cause other than the largest identified factor 20
times, and citing **8 figures that appear nowhere in the data it was given.**

So the honest conclusion is not "the verifier made the model smarter". It is:

> **The verifier makes the output consistent. Whether it also makes it more
> accurate is not established by this data.**
> Those are different properties, and conflating them is the easy mistake.

**How I got out.** I shipped it anyway, and reported both numbers separately.
Ten fabricated statistics is ten numbers that would otherwise have gone into a
merchant-facing email. That is a safety property worth having whether or not
the label at the end changes — and claiming it as an accuracy win would have
been the single most tempting piece of dishonesty available to me in this
project.

**Lesson:** I would have believed the 8-merchant result if I had not already
built the habit of running the full sweep. And I would have believed the +5.00
if I had not already been burned by the +12. Small samples flatter the thing
you just built — and so does the first favourable re-run.

---

## 14. The reproducibility check found a reproducibility bug in its first run

**Expected.** This project claims a panellist can clone it and reproduce every
number. That is easy to claim and easy to quietly break, so I wrote
`scripts/verify_reproducibility.py`: regenerate everything, re-run every
deterministic eval, and ask git whether a single committed figure moved. I
expected it to pass on the first run and to be useful later.

**What happened.** It failed immediately. **43 of the 200 sweep merchants came
back different.**

**How I found what.** The diffs were tiny and strange:

```
- "bank": 1.583544372390052,
+ "bank": 1.583544372390018,
- "method": -1.6653345369377348e-14,
+ "method": 7.401486830834376e-15,
```

Differences at the **fifteenth significant figure**, and only inside the
`ground_truth` block. The transactions themselves were byte-identical, so the
seeded RNG was fine. Something in the *analytic* ground-truth computation was
varying between processes.

**Why.** `correlated_joint` built its output by iterating
`set(indep) | set(como)`. Python randomises string hashing per process, so that
set walks its ~1,280 cells in a different order every run — which changes the
order the floats are summed in, which moves the total at machine epsilon.

Every value was still *correct*. They had simply stopped being *identical*, and
identical is the thing this project actually promises.

**How I got out.** One `sorted()`. Then I checked it properly — same merchant,
three separate Python processes:

```
2.5769967127931235  4.4002994689435582
2.5769967127931235  4.4002994689435582
2.5769967127931235  4.4002994689435582
```

The check now runs in CI on every push, so this cannot silently return.

**Lesson, and it is the one I would keep.** I had been claiming determinism for
weeks on the strength of a fixed seed and `temperature=0`. Both were true and
neither was sufficient — a hash-order dependency sitting underneath them made
the claim false at a precision nobody would have noticed until they diffed two
clones. **The claim was only as good as the test I had not written yet.**

---

## The one that isn't a bug

The sensitivity analysis says my **assumptions move the answer more than my
error bars do**. Sweeping every assumed coefficient across its stated range
shifts attributions by up to **1.13 points** — roughly **2× the measured MAE of
0.53** — and flips the primary cause on 12.5% of merchants.

That is not fixable. NPCI publishes no hourly series, no card rail, and no
ticket-size split, so those coefficients are judgement calls and will remain
so.

What I did instead was make it **visible**: every coefficient in `priors.py`
carries a `provenance` field (`measured` / `assumed`), a source, and a
plausible range. The range is what the sweep turns. The night-time penalty is
flagged in code as the single least-grounded number in the model.

By contrast, the cohort benchmark — the assumption I expected to be fragile —
moves the attributions by **exactly zero**, structurally, because the value
function contains the cohort's factor *profile* but never its headline *rate*.
The eval asserts that, so a regression fails the build.

If someone asks *"how much of this rests on your assumptions rather than your
data?"* — the answer is a number, and I found it before they did.
