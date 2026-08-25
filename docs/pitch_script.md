# 5-minute pitch script

Recorded against **replay mode**, so no live API calls, no latency, no rate
limits. It is a genuine recorded run, labelled REPLAY in the corner.

Order is deliberate: **money first, honesty second.** The track's bar asks for
measured money recovered across a batch. Leading with the caveat would read as
evasion; leading with the number and then qualifying it reads as rigour. Same
honesty, opposite impression.

---

## 0:00 – 0:25 · The problem, in one screen

> "This is what a merchant sees today."

*[Dashboard, TODAY toggle. A success rate and a flat line chart.]*

> "Eighty-eight point nine percent. That's it. Nobody tells them what it should
> be, whose fault the shortfall is, or what it's worth."

*[Flip to REVENUE DOCTOR. Same panel, now a gap bar and a decomposition.]*

> "Same merchant, same data. There's the gap — 2.86 points, ₹76,000 a month —
> and there's what's causing it."

Flip it back and forth once. The change is what registers.

---

## 0:25 – 1:10 · Money recovered across the batch

*[Scroll to the RECOVERY row.]*

> "2,840 payments, 316 failed. The agent executed 109 remediations under a
> signed mandate and recovered ₹6,824. Another ₹55,000 to ₹115,000 is still
> recoverable. ₹197,000 is not recoverable by anything — expired cards, closed
> accounts — and those 121 payments are listed individually, not quietly
> dropped from a recovery rate."

> "109 auto, 82 escalated to the merchant, 5 denied by the mandate. 196 ledger
> entries, chain verified, zero mandate violations."

> "One thing about that ₹6,824. It's labelled PROJECTED, and I mean it. Retry
> success is a model, not an observation — so I ship a range across three
> calibrations instead of one confident number. Everything green on this page
> is measured against ground truth. Everything amber is modelled. There's a
> wall between them and it's labelled."

---

## 1:10 – 2:00 · Why, and the error bars that gate the agent

*[Decomposition strip.]*

> "Bank concentration carries 2.76 points, plus or minus 0.54. That ± isn't
> decoration — it's the measured error of this exact engine on this exact
> factor, from 200 merchants where I knew the true answer."

> "And it changes what the agent does."

*[Point at the withholding line.]*

> "Billing window came in at 0.11 points. Its error bar is 0.53. The engine
> cannot tell that from zero, so it refuses to act on it — forced to
> investigation. Payment method is worse: this merchant is 88% UPI, so there's
> nothing to compare against and the factor isn't identified at all."

> "Attribution above twice its error bar, the agent may act alone. Between one
> and two, it goes to the merchant. Below one, it does nothing and says why."

> **"An agent that declines to act on its own weak signal is a different
> artefact from one that acts on everything."**

---

## 2:00 – 2:40 · The agent, actually working

*[Flow page. Hit replay at 2×, then pause.]*

> "Ten nodes. Purple is where a model makes a judgement call, blue is
> deterministic. That contrast is the whole architecture argument —
> deterministic wherever correctness is checkable."

*[Click `decompose`.]*

> "All sixteen coalition values, before Shapley aggregation. Check the
> arithmetic yourself."

*[Click `hypothesise`.]*

> "The verbatim prompt and the raw response. Most submissions hide the prompt.
> I'd rather you could see whether the model was led to its answer."

*[Point at dashed `human_review`.]*

> "That branch was evaluated and not taken — every classification cleared 0.85
> confidence. I render skipped nodes rather than dropping them, because a node
> that vanishes looks the same as one that was never wired up."

*[Click `gate`.]*

> "This one never consults a model. Even a fully prompt-injected model can't
> exceed the mandate — it never held a credential, and its output is a
> validated struct from a closed enum."

---

## 2:40 – 3:30 · Validation — the actual submission

*[Validation page.]*

> "200 merchants, each with a known injected cause of known magnitude. Ground
> truth isn't a guess — it's the same Shapley decomposition computed
> analytically over the true generating distribution. The difference is the
> error, and it's about half a point per factor."

> "Here's where it degrades. Correlate the causes and accuracy falls from 99%
> to 86% — that's the independence assumption in my own method, priced. Shrink
> the batch and error doubles; under 400 payments a month I tell the merchant
> the diagnosis isn't resolvable rather than ranking noise."

*[Scroll to Part C.]*

> "And the uncomfortable one. My *assumptions* move the answer more than my
> *error bars* do — 1.13 points versus 0.53. NPCI publishes nothing hourly, so
> those coefficients are judgement calls. I can't fix that. What I can do is
> label every coefficient with its provenance and show you exactly how much
> rests on it."

---

## 3:30 – 4:05 · Two things that didn't go to plan

> "My best slide didn't survive contact with measurement."

*[Naive vs Shapley panel.]*

> "I predicted naive attribution would pick the wrong cause 31% of the time and
> Shapley 6%. Measured: 97.5% versus 96.3%. They basically never disagree. The
> value function is nearly additive, so Shapley reduces to naive."

> "So I measured what it *does* buy. Naive magnitudes sum to 2.4× the real gap
> on average — anywhere from minus 11× to plus 31×. Shapley's sum to exactly
> 100% by construction. You can rank with the simple method. You cannot put a
> rupee number on it. Every output of this thing is a rupee number."

> "Seven things broke like that. They're all written up — including the day a
> test failed with the *wrong sign* and taught me my method can't handle a
> merchant who uses only one bank. That's now a detected, reported failure mode
> instead of a silent wrong answer."

---

## 4:05 – 4:35 · Real data

*[NPCI finding.]*

> "One last thing, and this is the only number here that comes from reality
> rather than my generator. 32 months of NPCI's published bank tables."

> "UPI's bank-side failure rate has gone **up**. The median top-50 bank is 0.62
> points worse over three years. Only a third improved. Yes Bank, IndusInd and
> AU Small Finance roughly doubled their failure rates."

> "And survivorship biases that toward optimism — banks that fell out of the
> top 50 aren't counted. It's probably worse."

---

## 4:35 – 5:00 · Close

> "Everything here reproduces. Fixed seed, temperature zero, pinned data
> capture, cached model responses, eval outputs committed. Clone it and you get
> the same numbers."

> "The bar for this track says don't just identify the problem — show measured
> money recovered, with escalation, stopping rules and an audit trail. That's
> all here."

> **"What I'd add is this: everyone will show you an agent that acts. This one
> also measures how often it's wrong, and tells you before you ask."**

---

## Panel prep — likely questions

**"Why not just use a dictionary for the error codes?"**
It is a dictionary for the 110 published codes — zero API calls. The model
exists for codes *not* in the taxonomy, which is why the eval holds out codes,
not rows.

**"Your data is synthetic."**
Yes, and that's the point — it's how I get ground truth. But the bank rates,
the error codes, the MCC volumes and the failure mix are all real NPCI and
Razorpay data. The synthetic part is *which merchant has which problem*, which
is exactly the part I need to know the answer to.

**"What if s_star is wrong?"**
The attributions don't move at all. Structurally — `v(S)` contains the cohort's
factor profile but never its headline rate. It moves the gap and therefore the
rupee figure, linearly. The eval asserts the invariance.

**"Is Shapley overkill?"**
For ranking, yes — measured, 96.3% vs 97.5%. For magnitudes, no — naive sums to
2.4× the gap. I built it, then measured whether I needed it.

**"How do I know the audit trail is real?"**
Hit "verify chain" — it recomputes SHA-256 over the canonical encoding in your
browser. Then hit "tamper with entry 4" and watch it break from there down.

**"Why is recovery projected rather than measured?"**
Because nobody can measure recovery from a synthetic batch, and anyone
claiming to is either fooling you or themselves. What I can measure is
attribution accuracy against known truth, mandate violations, and chain
integrity — and those are the green half of the wall.
