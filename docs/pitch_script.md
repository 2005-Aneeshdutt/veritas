# 5-minute pitch script

Recorded against **replay mode**, so no live API calls, no latency, no rate
limits. It is a genuine recorded run, labelled REPLAY in the corner.

**Order is deliberate: money, then mechanism, then honesty.** The track asks
for measured money recovered across a batch. Leading with the caveat reads as
evasion; leading with the number and then qualifying it reads as rigour. Same
honesty, opposite impression.

Have two tabs open: `/portfolio` and one merchant run. Start on the portfolio.

---

## 0:00 – 0:30 · The book, not the merchant

*[Open `/portfolio`. The ₹5.45L counter animates.]*

> "This is a payments platform's book. Eight merchants, and across them
> **₹5.45 lakh a month is recoverable** — money that is being lost to payment
> failures that have identifiable, fixable causes."

> "Merchants already have dashboards. What nobody has is this view: across the
> whole book, where is revenue leaking, who do we call on Monday, and what is
> each call worth. Four merchants need a call. Two don't have enough data to
> say. Two are fine and I'll come back to those, because they matter."

*[Scroll to the by-cause panel.]*

> "And it aggregates by cause — because one merchant with a billing-window
> problem is a support ticket, and forty is a product change."

---

## 0:30 – 1:15 · One merchant, and the money

*[Click VoltBill. Dashboard loads, ₹ counter animates.]*

> "VoltBill. 2,100 payments last month, 292 failed. The agent executed 125
> remediations under a signed mandate and recovered ₹31,614. Another
> ₹55,000 to ₹115,000 is still recoverable. Chain verified, **zero mandate
> violations.**"

> "One thing about that number. It is labelled PROJECTED and I mean it —
> retry success is a model, not an observation, so it ships as a range across
> three calibrations rather than one confident figure. Everything green on
> this page is measured against ground truth. Everything amber is modelled.
> There is a wall between them and it is labelled."

*[Toggle TODAY ⟷ REVENUE DOCTOR twice.]*

> "That's what a merchant sees today. Same data, diagnosed."

---

## 1:15 – 2:00 · The click that makes it a product

*[Scroll to "Approve a fix". Hit **Apply fix** on the retry group.]*

> "Here is what I think nobody else will show you. This is not a report —
> watch what happens when the merchant approves a fix."

*[Let the checks land one at a time. Do not talk over the first three.]*

> "Signature verified — the agent never held the signing key, so it cannot
> forge this. Mandate in force. Action type permitted. Attempt cap, counting
> retries the merchant already made themselves. Recovery window. Amounts."

*[The split lands.]*

> "**125 allowed, 45 need the merchant's confirmation, 13 denied by their own
> mandate.** ₹31,614 recovered, 183 ledger entries, chain verified."

> "The agent cannot widen its own authority. Those 13 denials are recorded too
> — an audit trail of only successes is a highlight reel."

---

## 2:00 – 2:45 · Why, and the refusal

*[Go to Diagnosis, or scroll to the decomposition.]*

> "Where does the gap come from? A Shapley-ordered Oaxaca-Blinder
> decomposition over all sixteen coalitions of four factors. The billing
> window carries 3.99 points, **plus or minus 0.53.**"

> "That ± is not decoration. It is the measured error of this exact engine on
> this exact factor, from 200 merchants where I knew the true answer by
> construction."

*[Point at the withholding lines.]*

> "And it changes what the agent does. Bank concentration came in at 0.17
> points against an error bar of 0.54 — the engine cannot tell that from zero,
> so it **refuses to act on it.** Payment method is worse: this merchant has
> effectively one payment method, so there is nothing to compare against and
> the factor is not identified at all."

> **"An agent that declines to act on its own weak signal is a different thing
> from one that acts on everything."**

---

## 2:45 – 3:20 · The agent, actually running

*[Go to `/flow`. Hit replay at 1×. Let two nodes land before speaking.]*

> "Ten nodes. Purple is where a model makes a judgement call. Blue is
> deterministic — arithmetic, lookups, policy. That contrast is the whole
> architecture: a model only where judgement is genuinely required."

*[Click `decompose`.]*

> "All sixteen coalition values, before aggregation. Check the arithmetic
> yourself."

*[Click `hypothesise`, expand the prompt.]*

> "The verbatim prompt and the raw response. Most submissions hide the prompt.
> I would rather you could see whether the model was led to its answer."

*[Point at the dashed `human_review` node.]*

> "That branch was evaluated and not taken. I render skipped nodes rather than
> dropping them, because a node that vanishes looks identical to one that was
> never wired up."

---

## 3:20 – 4:10 · How often is it wrong

*[Go to `/validation`.]*

> "200 merchants, each with a known cause of a known size. Ground truth is not
> a guess — it is the same decomposition computed analytically over the true
> generating distribution. The difference is the error: about **half a point
> per factor**, primary cause found **97.5%** of the time."

*[Where it breaks tab.]*

> "Here is where it degrades. Correlate the causes and accuracy falls to 86% —
> that's the independence assumption in my own method, priced. Under 400
> payments a month I tell the merchant the diagnosis is not resolvable rather
> than ranking noise."

*[Uncomfortable results tab.]*

> "And the one I did not want. My *assumptions* move the answer more than my
> *error bars* do — 1.13 points against a measured error of 0.57. NPCI
> publishes nothing hourly, so those coefficients are judgement calls. I can't
> fix that. What I can do is label every coefficient with its provenance and
> show you exactly how much rests on it."

*[Scroll to the backtest.]*

> "And because 'you validated against your own generator' is the fair
> objection: this is a walk-forward backtest on 42 banks and 32 months of real
> NPCI data. **Knowing which bank a payment goes through cuts error 2.6×.**
> That's what makes bank a real factor rather than noise — and it's on data I
> didn't create."

---

## 4:10 – 4:40 · Two things that went against me

> "My best slide didn't survive contact with measurement. I predicted the
> sophisticated attribution would beat the naive one 31% to 6%. Measured: 97.5
> versus 97.5. They basically never disagree."

> "So I measured what Shapley *does* buy. Naive magnitudes sum to **2.4× the
> real gap** — anywhere from minus 11× to plus 31×. Shapley's sum to exactly
> 100% by construction. You can rank with the simple method. You cannot put a
> rupee number on it, and every output here is a rupee number."

> "Thirteen things broke like that. They're all written up — including the day
> a test failed with the *wrong sign* and taught me my method cannot handle a
> merchant who uses one bank, and the day an 8-merchant pilot showed my
> verifier gaining 12 points and the full 60 showed noise."

---

## 4:40 – 5:00 · Close

*[Back to `/portfolio`, or `/drift`.]*

> "One last thing. This also watches the ecosystem — NPCI's published bank
> data, which shows issuers quietly degrading. **₹413 crore a month** across
> India from this quarter's degradation alone, with the exposed merchants on
> your book named and costed."

> "Everything reproduces. Fixed seed, temperature zero, pinned data capture,
> cached model responses, eval outputs committed. **Clone it with no API key
> and you get the same numbers.**"

> **"Everyone will show you an agent that acts. This one measures how often it
> is wrong, and tells you before you ask."**

---

# Panel prep

**"Why not a dictionary for the error codes?"**
It *is* a dictionary for the 110 published codes — zero API calls. The model
exists for codes *not* in the taxonomy, which is why the eval holds out codes
rather than rows.

**"Your data is synthetic."**
The part I generated is *which merchant has which problem* — which is exactly
the part I need to know the answer to. The bank rates, error codes, MCC volumes
and failure mix are real NPCI and Razorpay data. And the backtest validates the
success model out-of-sample on data I didn't touch.

**"What if the cohort benchmark is wrong?"**
The attributions don't move at all. Structurally — the value function contains
the cohort's factor profile but never its headline rate. It moves the gap and
the rupee figure, linearly. The eval asserts the invariance, so a regression
fails the build.

**"Is Shapley overkill?"**
For ranking, yes — 97.5 versus 97.5. For magnitudes, no — naive sums to 2.4×
the gap. I built it, then measured whether I needed it.

**"Your AI numbers are below target."**
They are. Classification is 87.9% against a 95% aim, root cause 70% against
85%. What I'd point at is the error decomposition: the attribution caps the
model at 73%, and the model follows what it was shown 83% of the time. I know
which half to fix first. And on three of the four classification errors, the
model's answer is defensible — I did not move ground truth to match it.

**"How do I know the audit trail is real?"**
Hit *verify chain* — it recomputes SHA-256 over the canonical encoding in your
browser. Then hit *tamper with entry 4* and watch it break from there down.

**"Why is recovery projected rather than measured?"**
Because nobody can measure recovery from a synthetic batch, and anyone claiming
to is fooling you or themselves. What I can measure is attribution accuracy
against known truth, mandate violations, chain integrity, and — after a fix
lands — how far my own forecast was off. That last one is 0.69 points.

**"Compared to what?"**
Against B3, error-code-aware retry, which is what a good engineer builds. It
recovers more in absolute terms — but only by breaching the 3-attempt cap on
8,903 payments, because it doesn't track prior attempts. Mine is 1.26–1.50×
more efficient per attempt with zero breaches.

**"Does it scale?"**
4.2 merchants a second on one core, 1,445 payments a second. A million
merchants is 2.1 hours on 32 cores, and sharding by merchant is embarrassingly
parallel.
