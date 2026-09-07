# VERITAS

### Recover what you can. Prove what happened.

[![CI](https://github.com/2005-Aneeshdutt/veritas/actions/workflows/ci.yml/badge.svg)](https://github.com/2005-Aneeshdutt/veritas/actions/workflows/ci.yml)

**Razorpay AI Buildathon — Track 03: AI Revenue Recovery**
Aneesh Dutt · PES University · [github.com/2005-Aneeshdutt](https://github.com/2005-Aneeshdutt)

CI runs four jobs on every push: the test suite, **a full diagnosis with no API
key** (proving the committed cache is complete), **a reproducibility check that
regenerates everything and fails if a single committed number moves**, and the
console build.

Every merchant can see their payment success rate. Nobody tells them what it
*should* be, whose fault the shortfall is, or what it is worth per month.

VERITAS finds the gap between what a merchant collects and what their category
actually achieves, proves which causes it comes from, recovers what it is
authorised to recover — and **reports the measured error bar on its own
diagnosis, then refuses to act on anything inside it.**

The engine is packaged as `revenue-doctor`; that name survives in the Python
module paths and the CI job names, and means the same thing.

> Everyone can build an agent that acts.
> This one measures how often it is wrong, and says so before you ask.

---

## What is in this repository

Two halves of one product, so a single link is the whole thing.

| Path | What it is |
|---|---|
| `src/`, `data/`, `tests/` | **The engine.** The ten-stage pipeline, the Shapley decomposition, the signed mandate, the policy kernel, the hash-chained ledger, the Razorpay integration, and the FastAPI service that exposes all of it over 64 routes. |
| [`console/`](console) | **The operator console.** React 19 + TanStack Start. Thirteen surfaces that render what the engine recorded; it computes no financial figure of its own. Has [its own README](console/README.md). |

The console is the one to open. Run the engine on `:8000`, then:

```bash
cd console && npm install && npm run dev      # http://localhost:8080
```

It needs `VITE_API_BASE_URL=http://127.0.0.1:8000` in `console/.env` — with
`127.0.0.1`, not `localhost`, because the console server-renders and Node
resolves `localhost` to `::1` while uvicorn binds IPv4 only.

---

## Running it

```bash
make setup     # install python and console dependencies
make demo      # engine on :8000, console on :8080
```

No API key is needed. Every LLM response the demo uses is cached and committed,
and the CI job **"Runs with no API key"** exists to prove that rather than
assert it.

**Deploying.** `render.yaml` defines the API service only. The console is not
deployed yet and the config does not pretend otherwise: its production build
targets a serverless runtime rather than a Node server, ships no `start`
script, and bakes `VITE_API_BASE_URL` into the client bundle at build time.
Clone and `make demo` is the supported path today.

No key is set there either, deliberately — a deployment that quietly needed one
would make the offline claim false. The cost is that a question nobody has
asked before answers *"no cached answer and no API key configured"* instead of
inventing one, which is the honest failure and is what the code already does.

The free tier's disk is ephemeral, so new runs and sealed challenges last until
the instance restarts and then the committed state returns. For a demo that is
a feature: the deployed copy always resets to a clean book.

## What is on screen

Eight numbered steps down the left, in the order the story is told, and three
rooms you go to when you stop believing it.

| | |
|---|---|
| **1 · Book** | Every merchant at once, ranked by money on the table, with the funnel from proposed to acted-on. Three lenses on the same object: *ranked*, *live* — payments arriving and a bank degrading in real time — and *bank drift*. |
| **2 · Diagnose** | The agent working one case: the sixteen-coalition lattice filling in, the Shapley values converging on the whole. A second lens shows every node, prompt and gate decision. |
| **3 · Compare** | The Counterfactual Recovery Lab. The same batch under four policies, all marked against outcomes none of them could see, plus the autonomy frontier. The one page where the product is willing to lose: the naive loop recovers more, and the two columns next to it say what that cost. |
| **4 · Authorise** | What the mandate permits, what the kernel held, and per-payment approve or reject. Click any payment to read its whole file. |
| **5 · Control Tower** | The operations console: which decisions need a person, ranked, with a review drawer carrying the diagnosis, the evidence, the counterfactual, the policy rule and exactly what would execute. Approve/hold/deny/escalate where policy permits, refused where it does not. |
| **6 · Recover** | Which channel actually reaches the customer, and the finding that on this book it never has to. The voice demo, its guardrails, and one payment traced from the batch row to its audit entry. |
| **7 · Platform** | The write-off attributed to whoever Razorpay's own `next_steps` line addresses. The platform's own share is a defect backlog no merchant is standing anywhere to compute. |
| **8 · Prove** | A sealed challenge nobody has seen, diagnosed blind, then marked. |
| **Before / after** | Every scored fix drawn as the merchant's success rate moving, with the band published beforehand laid over the distance it actually travelled. |
| **Evidence** | Where the recovered number came from: every failed payment in one of six buckets that sum to the money at risk, each clickable down to the payments, the rule that decided them and the hash of the entry that recorded it. Plus whether the forecasts came true, the chain re-hashed from genesis on each load, and the model bill. |
| **Your own data** | The Recovery Data Room: every source behind a recovery number, with its completeness, duplicates and unresolved references. Then upload a month of payments, or swap the NPCI table every baseline is measured against. Three bundled files if you have neither, including a real NPCI slice that moves the achievable rate six points. |

Left and right arrows move through the walkthrough. **Reset the demo** is in
the sidebar: it re-runs each merchant rather than stripping the approval keys,
so it reproduces the starting record instead of hand-cleaning it, and it
reuses each `run_id` so bookmarks and already-emailed approval links still
resolve.

## Read these three first

If you only have five minutes, these are the files that answer the questions
worth asking.

| | |
|---|---|
| **[`docs/what_broke.md`](docs/what_broke.md)** | Fifteen things that broke, what I thought was wrong each time, what actually was, and the fix. Includes the day my best slide did not reproduce, the day the ground truth was wrong and the model was right, and the reproducibility checker finding a reproducibility bug on its first run. |
| **[`evals/results/`](evals/results/)** | Seventeen result files, every one regenerated by CI on each push. If a single figure moves, the build fails. |
| **[`ARCHITECTURE.md`](ARCHITECTURE.md)** | Where a model is used, and — the part that took longer to decide — where one deliberately is not. |

## Where the AI is, and where it is not

A model is used in exactly five places, and refused everywhere else.

| Uses a model | Why nothing else would do |
|---|---|
| Classifying an unseen error code | Open vocabulary. A code outside the taxonomy has to be reasoned about. |
| Naming the root cause | Judgement over a decomposition it is handed. Output is a label from a closed enum. |
| Reading the merchant's own account | Turning a sentence into a typed claim is the one job no lookup table does. |
| Answering questions about a run | Same, in reverse. Every figure it prints is checked against the record. |
| Designing an adversarial exam | Asked to attack the system, not describe it. |

| Deliberately deterministic | Why a model would make it worse |
|---|---|
| The Shapley decomposition | Correctness is checkable. A model would add error with no upside. |
| The policy kernel | It holds the authority. It never consults a model, so a compromised one cannot widen it. |
| The verifier | Not an LLM judging an LLM. Every rule is a string or arithmetic check, so a violation is a fact rather than an opinion. |
| Adjudicating the merchant's claims | The model extracts; the arithmetic decides who is right. |
| The retry schedule | A curve, applied. Nothing to reason about. |

---

## The nine things most systems do not do

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

**7. You can point it at bank data it has never seen.**
The question a payments company actually has about a demo is *"would this work
on our numbers?"*, and every answer to it is a promise. Upload a table in
NPCI's published remitter shape and every baseline is re-derived from that
file — cohort, achievable rate, each factor's share. Swapping August 2025 for
January 2024 moves CloudSync's achievable rate **87.4% → 90.8%** and widens the
gap **6.6 → 10.0 points**, because banks were genuinely healthier that month —
and the primary cause stays `hour`, because a merchant billing at midnight has
a midnight problem whatever the banks were doing. Nothing is written to disk; a
test greps the ingest module for every way it could write, because an upload
reaching `data/npci/` would turn the "committed results reproduce" CI job into
a check on a file the demo had edited.

**8. It says what it costs.**
Every run here reports ₹0 because each model answer was bought once and
committed — and a bare zero would quietly claim the model steps are free. Spent
and saved are counted separately and never netted: the book made **45 model
calls over 75,630 tokens** and spent nothing, avoiding **₹41.74**; the whole
committed cache is **383 answers, 694,717 tokens, ₹444.49** to rebuild from
empty. The figure that matters is the *billable* one — **₹5.22 per merchant**,
what the second merchant costs and the millionth. That is ₹0.52 Cr across a
million if every model step runs nightly, which is the expensive way and not
what this pipeline needs: classification answers all 110 published codes from a
hand-labelled taxonomy with no call at all, and the deterministic half has no
model in it.

**9. It can explain itself, and refuses when it cannot.**
A panel on every page answers questions about the system — what MEASURED means
here, how accurate the attribution is, what the agent may do unattended — from
the same committed files the pages read, never from prose written for it to
recite. It is grounded like every other model output here, and that matters
more rather than less: it is asked about the system's own accuracy, so a figure
it invented would be a false claim about the system's honesty, made by the
system, on the screen someone opened to check. Asked *"how many customers does
Razorpay have"* it answers *"the context does not answer this"*, not a number.

---

## Recovery across a batch

```
RECOVERY  (2,840 payments, 315 failed)
  executed        111 actions under a signed mandate
  recovered       ₹9,500                 [PROJECTED, central calibration]
  recovered       ₹6,924                 [MEASURED against ground truth]
                  29 of 108 retries would truly have converted; 79 would not
  still on table  ₹34,999 – ₹72,799      [PROJECTED range, 3 calibrations]
  unrecoverable   ₹88,113 across 117 payments — listed, not dropped
  escalation      111 auto / 147 to merchant / 1 denied by mandate
  audit           259 ledger entries, chain VERIFIED, 0 mandate violations
```

Both figures are there on purpose.

The **projected** one comes out of the retry model in `mock_rail.py`, which is
an assumption — so it ships as a range across three calibrations, never one
confident number.

The **measured** one is new, and it is the answer to a limitation this README
used to state as permanent. Every generated merchant now carries, as ground
truth, whether each recoverable failure would *truly* have converted on a
retry. So for the exact payments this agent chose to retry, the outcome is
known. Across the eight demo merchants: **₹39,833 measured against ₹54,132
projected** — the rail is 1.36× optimistic, closely matching the 1.43× that
`recovery_accuracy.json` measures independently across 200 merchants.

The scoring runs *after* the diagnosis and reads the merchant file, not the
run. The engine is handed a profile and a list of transactions and never sees
the counterfactual; a test asserts it has no route to one. Measured here means
against the generating distribution — the same standard as the ±0.57 point
attribution claim — not against a live payment rail, and that distinction is
stated rather than blurred.

The most useful number in that block is the one nobody advertises: **79 of 108
retries went to payments that were never going to convert.**

### The forecast a person can settle

Across the book the agent acts on 277 of 1,037 proposed actions on its own.
661 sit in merchant queues — inside the agent's authority, waiting only for
someone to say yes — and 91 are refused outright for sitting above a hard
ceiling.

So the portfolio carries two figures of different kinds, and says which is
which. **₹39,833 won** is a mark: retries that ran, scored afterwards against
the generating distribution. **₹1.83L – ₹3.82L** is the rail's forecast for
the 339 retries still queued. Quoting a marked figure for work nobody has
authorised yet would mean reading the answer key to write the pitch, so that
band is a projection and is labelled one.

`Approve across the book` settles it. Every action is re-gated individually,
so what the mandate denied stays denied however many times it is approved:

```
before   ₹39,833 won · 277 acted on · 661 awaiting · 91 denied
after    ₹1,94,509 won · 934 acted on ·   0 awaiting · 91 denied
```

The uplift is **₹1,54,676** against a forecast band of ₹1.83L – ₹3.82L.

**The forecast was wrong, and it was wrong in the direction that costs
credibility.** The outcome landed *below* the conservative end of a three-point
band — 1.18× over at the most pessimistic calibration and 1.82× over at the
central one. The band did not contain the answer.

That is reported here rather than quietly rescaled, because a forecast nobody
can fail is not a forecast. It is also consistent: `recovery_accuracy.json`
independently measures this rail at 1.43× optimistic across 200 merchants, and
the retries queued behind an auto-execute limit are the larger ones, where it
is more wrong still. The honest reading of the projected band on any page of
this app is *the top of it is fiction and the bottom of it is optimistic*, and
the app says so beside the number.

Approving writes to `data/runs/`. To put the demo back:

```bash
git checkout -- data/runs/
```

---

## The Counterfactual Recovery Lab

A recovery figure with nothing beside it is not a result. Recovering ₹39,833 is
excellent if the alternative was ₹5,000 and unremarkable if a `for` loop over
the failure export would have got ₹55,000. Nobody publishes the second
comparison, so nobody can tell the two apart.

`src/doctor/counterfactual.py` runs the **same batch of failed payments through
four policies** and marks all of them against the **same hidden outcomes**.

```
CloudSync Pro · 227 failed payments · ₹17,64,721 at risk
137 worth retrying at all · 29 would ever have converted · ceiling ₹2,11,258

POLICY                    RECOVERED   ATTEMPTS  WASTED  HIT   ₹/ATTEMPT  BREACHES
no intervention                  ₹0          0       0    0%          ₹0     none
naive retry               ₹2,11,258        623     594   13%        ₹339      247
static rules              ₹2,11,258        353     324   21%        ₹598      142
Revenue Doctor              ₹16,026         58      44   28%      ₹27,632     none
  + merchant approval       ₹78,781        125     103   21%      ₹63,025     none
Revenue Doctor (this run)    ₹4,741         11       8   27%      ₹43,101     none   [MEASURED]
```

**Read that table honestly: the naive loop recovers more.** It gets there by
breaching the signed mandate 247 times — 198 payments pushed past the attempt
cap, 49 retried above the hard ceiling — and by spending 594 attempts on
payments that were never going to convert. Static rules, the baseline that
actually matters because it is what a competent engineer builds in an
afternoon, does the same thing 142 times.

That is the finding. Not "we recover more", but **"we recover less, on purpose,
and here is exactly what the difference bought you."**

### No ground-truth leakage

Every generated merchant carries `ground_truth.retry_conversions` — for each
recoverable failure, whether a retry would truly have converted. It lives on
`GroundTruth`, never on `Transaction`, so no strategy can reach it.

The separation is structural, not conventional:

* every `decide_*` is a function of `(batch, mandate)` and returns decisions
* `_reveal()` loads the truth and marks them, and is the only thing that does
* `test_no_strategy_takes_a_truth_argument` fails if any decision function
  grows a parameter that could carry an outcome
* `test_decisions_are_unchanged_when_the_truth_is_inverted` flips every label
  in the truth table and asserts not one decision moves — with a control test
  that asserts the *score* does move, so the first cannot pass vacuously

### The autonomy frontier

The only number on a mandate a merchant genuinely has to choose is
`auto_execute_limit_paise`: how large a payment the agent may retry without
stopping to ask. Every merchant on this book picked it out of the air, because
nobody has a method for choosing it.

Sweeping it shows the choice is a trade, not a maximisation:

```
AUTO LIMIT   RECOVERED   MOVED UNSUPERVISED   HELD FOR MERCHANT
      ₹500      ₹1,028              ₹2,525            ₹4,71,140
    ₹3,000     ₹16,026             ₹56,458            ₹4,17,207   ← signed
    ₹7,500     ₹40,512           ₹1,86,120            ₹2,87,544
   ₹15,000     ₹78,781           ₹4,73,665                   ₹0
```

Turning the dial to the hard ceiling recovers 4.9× more and moves 8.4× more
customer money with no human in the loop. Each point is a **mandate that
verifies** — re-signed with the merchant's key, not waved past the gate, because
`policy.evaluate` refuses an unverifiable mandate before it checks anything
else.

### Abstention is a first-class outcome

Five dispositions, not two: `RECOVER · HOLD · DENY · ESCALATE · ABSTAIN`.

`ABSTAIN` is the one most systems do not have. "We looked at this payment and
chose to do nothing" is a different statement from "the mandate refused it",
and a product that conflates them cannot explain why it left money on the
table. Two reasons fire: `NOT_RECOVERABLE_BY_CLASS` (an expired card does not
become valid by being asked twice) and `BELOW_EVIDENCE_FLOOR` (the best slot on
this payment's ladder still models under 0.20, so spending one of three
attempts on it is not justified).

### Where this is weaker than it looks

`retry_conversions` is **one boolean per payment**, so it does not vary with
retry timing. That is why the naive policies reach the ceiling — retrying
everything three times catches every convertible payment by construction. On a
live rail, delay and attempt count would both matter and the gap would come
from somewhere else. **The comparison this defends is about attempts spent and
rules broken, not about who finds the last rupee.** Stated here rather than
discovered by a judge.

Friction is priced at a stated ₹3.00 per attempt (`FRICTION_PAISE_PER_ATTEMPT`)
— an assumption, labelled as one in the API response and next to every figure
derived from it in the UI.

---

## Razorpay-native, without pretending

The product runs in one of exactly two modes, and never blurs them.

| | |
|---|---|
| **SYNTHETIC EVALUATION** | Generated batches, deterministic rail, ground truth on file. Every rupee is a replay. **This is the default and needs no credentials — the entire demo works here.** |
| **RAZORPAY TEST MODE** | A real `rzp_test_` account answered. No real money moves, but the gateway is genuinely in the loop. |

The mode is one function (`src/doctor/mode.py`), read from the environment,
surfaced on `/api/mode`, and printed in the sidebar on every page. It is not a
flag threaded through call sites where somebody can forget it.

**A `rzp_live_` key is refused outright**, not downgraded. This is a submission
that proposes retrying customers' failed payments; the distance between "test
mode" and "charged a real person" is one environment variable, and the correct
number of ways to cross that line accidentally is zero. Silent degradation is
also refused — that is how somebody demos something they believe is live.

```bash
# optional. Nothing below is required for the demo.
RAZORPAY_KEY_ID=rzp_test_xxxx        # Dashboard (Test Mode) > Account & Settings > API Keys
RAZORPAY_KEY_SECRET=xxxx
RAZORPAY_WEBHOOK_SECRET=xxxx         # you choose this when creating the webhook
pip install razorpay
```

**What credentials do and do not change.** They add a gateway; they do not make
the demo book real. In test mode the payment links are genuine Razorpay
objects and outcomes are verified against the gateway — the merchant batches
are still generated, and the banner says exactly that rather than the shorter,
wronger "payment facts come from Razorpay".

**Verified against a live test account.** `RazorpayAdapter` was exercised end
to end: `create_payment_link` → `fetch_payment_link` → `cancel_payment_link`
returned a real `plink_…` id and a working `rzp.io` short URL, and a full
recovery ran through `channels.decide` → the policy kernel → the gateway,
producing a real link with `source: razorpay_test`, an audit entry, and —
correctly — **`recovered: ₹0`**, because creating a link is not a recovery and
no `payment_link.paid` had arrived.

### The adapter boundary

`src/doctor/rzp.py` is the only file that imports the SDK, reads the key, or
knows the API's shape. Without credentials **every method raises
`NotConfigured`.** It does not return a plausible-looking payment link and let
the UI say "created".

That negative is the most important test in this repo:

```python
def test_the_adapter_raises_rather_than_faking_without_credentials():
    ...  # fetch_payment, create_payment_link, verify_payment_state, all of them
```

A stub that returns success is how a demo ends up claiming a gateway confirmed
something no gateway ever saw.

### Event ingestion, and two kinds of idempotency

`src/doctor/events.py` normalises Razorpay-shaped webhooks into one internal
event model — `event_id · source · event_type · payment_id · order_id ·
merchant · timestamp · amount · currency · previous_state · new_state ·
ingestion_status · processing_status`.

Two keys, doing two different jobs:

* **`event_id`** — the gateway's own id. Seeing it twice is a duplicate
  *delivery*: stored once, counted, never reprocessed. Gateways redeliver on
  timeout, so this is normal traffic, not an edge case.
* **`(payment_id, action_type)`** — seeing it twice is a duplicate *action*:
  refused, whatever the event stream did. This is the one that matters. A
  gateway can invent a fresh `event_id` for a redelivery, and a retry proposed
  from a fresh event is still a second charge against the same payment.

The webhook **fails closed**: with no `RAZORPAY_WEBHOOK_SECRET` it rejects
everything rather than accepting everything. An unauthenticated webhook would
let anybody on the internet tell this system a payment was recovered, which is
the one lie the whole product is built to make impossible.

### "Recovered" has exactly one definition

```
intervention.launched   is not a recovery
payment_link.created    is not a recovery
customer says yes       is not a recovery
payment_link.paid       IS a recovery
payment.captured        IS a recovery
order.paid              IS a recovery
```

`recovered_paise` stays at zero until an event in `events.OUTCOME_TYPES` names
that payment. In test mode it is then **additionally verified against the
gateway** before it counts — an event says a thing happened; we go and check.
A test-mode outcome that cannot be verified reports
`event_received_but_unverifiable` and contributes nothing.

---

## Control Tower — what needs a person

`policy.evaluate` answers **"is this allowed?"**. That is a question about
authority, and it is correctly blind to how good the evidence is. So an action
can clear the mandate on a diagnosis whose attribution sits inside its own
error bar, on an underpowered batch, on an error code the classifier was
unsure about — permitted, and not obviously a good idea.

Control Tower asks the second question: **given that it is allowed, is it
justified?**

    Automate what can be justified. Escalate what cannot.

### Five states, over one kernel

It is not a second policy engine. `chitragupta/policy.py` is called, not
reimplemented, and a test asserts the reported result is byte-identical to
what a direct `evaluate()` returns for the same action and mandate.

| State | Means |
|---|---|
| **AUTO-ALLOW** | Permitted, and the evidence clears its own error bar. No person needed. |
| **HUMAN REVIEW** | Permitted — and the evidence does not justify doing it unattended. **This is the state that did not exist before.** |
| **HOLD** | Above the auto-execute limit, or the issuer is degraded. Waiting on a person or a clock. |
| **DENY** | The signed mandate refuses it. Unappealable. |
| **ESCALATE** | No channel is both permitted and available. |

Across the book: 645 human review · 764 escalate · 372 auto-allow · 214 hold ·
95 deny.

### Ineligible is not the same as needs-a-person

Answering only "can the system do this alone?" made the queue 1,623 items
long, which is a database rather than a work queue. Three populations, all on
screen:

```
2,090 decisions evaluated
1,718 not eligible for autonomous action
  950 require attention
```

The 768 in the gap are failures **no channel converts** — expired cards,
failed authentication — and issuers held on a clock. Those are blocked on the
world, not on a person: correctly outside automation, and correctly nobody's
task. Calling them escalations put 764 non-tasks in front of an operator.

The distinction reads what `channels.py` already concluded. It is not a new
threshold, and `AUTO_RATIO`, `CLASSIFIER_FLOOR` and the policy kernel are
untouched. Nothing is hidden either: the ineligible count sits on the same
line as the attention count, and the **All** filter still reaches every one of
the 2,090.

### Evidence quality is measured, not asserted

Four signals the pipeline already produces, none invented:

* the classifier's own confidence on this payment's error code, and whether it
  came from the published taxonomy or from a model
* whether the primary factor's attribution clears its **own measured error** —
  the same `AUTO_RATIO = 2.0` that `plan.py` gates auto-execution on, so the
  product cannot disagree with itself about what "strong enough" means
* whether the decomposition is reliable and the batch adequately powered
* whether the factor is identified at all, or degenerate

Where a signal genuinely does not exist it is `None` and renders as
**unavailable** — never as a plausible number.

**A bug this caught in its first run.** TechBazaar's top factor clears its
error bar 2.6×, and the classifier was 100% sure of the error code, so a card
read `CONFIDENCE 1.00` next to `EVIDENCE WEAK`. Both halves were individually
correct and the pair was nonsense: that factor is **degenerate** — the merchant
has effectively one value for it, so there is nothing to reweight toward and
the ratio is not measuring anything. An unidentified factor does not lower
confidence, it *invalidates the thing confidence was computed from*. So there
is now no number, and the card says so.

### The boundary is the server, not the button

A denied decision offers **escalate and nothing else** — escalating a refusal
is not an override, it is the correct thing to do with one. The UI disables
the rest, and the API refuses them anyway with a 403:

```
POST /api/control-tower/decisions/{id}/review?human_decision=approve
→ 403  'approve' is not available on this decision. The policy kernel denied
       this action. Approving it is not available at any level of authority:
       the mandate is signed and this system cannot widen it.
```

A disabled button is a courtesy. The browser audit asserts the UI disables it
**and** calls the API directly to confirm the refusal, because a client is not
a security boundary.

An override requires a structured reason code; `other` requires an
explanation, and `other` with a blank note is a 400.

### One audit chain, not two

A human decision goes into the **same** hash chain as everything else, using
fields already inside the hash: `actor` records who, and
`proposed_action.reason` carries the structured override. `LedgerEntry` is
unchanged, so every committed chain still verifies. A test tampers with that
reason and asserts the chain breaks — the override is as tamper-evident as the
gate decision beside it.

Approving runs the **existing** `recovery.execute_recovery`, so its idempotency
and stopping rules are the ones already in force. Approving twice returns
`already_executed` and does not act twice.

### Missing evidence is actionable

Every request maps to something the system can genuinely go and get — a
classification table, a longer batch, the merchant's own account of what
changed. Nothing asks a model to fill the hole. Re-evaluating re-derives the
decision from whatever the data says now; if nothing underneath changed, the
decision does not change either, and a test asserts that.

---

## Which channel, and how rarely

`src/doctor/channels.py` chooses between `NO_ACTION · RETRY · EMAIL ·
PAYMENT_LINK · VOICE · ESCALATE` by rule, from structured facts: attempt
budget, error class, amount, issuer health, contactability, the signed
mandate, the stopping rules.

**The cheapest channel that can plausibly work wins.** A payment that can still
be retried silently is retried silently. The customer is only contacted when
the machine has run out of ways to fix it without them.

On CloudSync's 227 failures:

```
retry        103    the customer does nothing
no action     90    hard declines and auth failures — nothing converts these
escalate      34    no channel is both permitted and available
email          0
payment link   0
voice          0    ← the policy contacts a customer zero times
```

That is the finding, and it is a negative one. **A recovery product that
phones people is a nuisance**, and this one has to run out of quieter options
before it will.

### Payment downtime: knowing when *not* to recover

Grounded in real data rather than a fabricated feed. `npci_td_pct` is the
technical-decline share published in the NPCI monthly tables this project
already ingests. Above 1.0% the issuer is treated as degraded:

```
ROOT CAUSE         payment infrastructure degradation
DECISION           HOLD — no channel is eligible
WHY                a retry into a degraded issuer only burns an attempt
RESUME CONDITION   issuer technical-decline rate back under 1.0%
                   (or a payment.downtime.resolved event, which takes precedence)
```

The policy kernel already had a four-hour bank-degraded hold
(`DENY_BANK_DEGRADED_HOLD`). This connects it to the diagnosis.

---

## Voice: a channel, not an intelligence

**There is no telephony in this environment and no live voice model.** Rather
than pretend, `src/doctor/voice.py` runs a **DETERMINISTIC VOICE DEMO**: the
same state machine, the same guardrails, the same audit trail, driven by a
scripted customer instead of a microphone. Every transcript is labelled
`simulated` in the payload and on screen.

Wiring real telephony means replacing the scripted customer with a
speech-to-text classifier restricted to the same closed intent set. The state
machine, the guardrails and the audit path do not change. That is the point of
writing it this way.

### What it structurally cannot do

Enforced by construction, not by prompt. There is no model behind it — five
states, a closed intent set, and a fixed line table.

| It cannot | Because |
|---|---|
| Decide to call | It receives a `ChannelDecision` and raises if it is not `voice`. Five tests, one per other channel. |
| Call twice | The mandate caps remediation attempts per payment and a call is one. `max_contact_attempts` is 1. |
| Ask for a card number, CVV, OTP, PIN or password | Every outbound line is checked against a pattern list before it is emitted. A match **raises** rather than being logged and shipped — a guardrail that fails open is decoration. |
| Offer a discount or waive anything | Same check, same list. |
| Report money | A customer saying yes authorises a link and nothing else. `recovered_paise` is 0 in every scenario, in every language. |
| Improvise | There is no free-text generation anywhere in the module. |

### The finding that made this feature honest

**No payment in the committed book reaches the voice branch, and working out
why was the most useful thing that happened while building it.**

`REISSUE_PAYMENT_LINK` is in `AUTO_EXECUTABLE`, so the kernel applies the
per-payment attempt cap and the hard ceiling to a payment link *exactly* as it
does to a retry. Under a mandate that permits both, **every condition that
blocks a retry blocks a link too** — so the contact channels are structurally
unreachable and the policy never needs to phone anybody.

The first version of `channels.py` did not know that. It proposed calls and
links, and the kernel denied every single one. The layering was correct and
the proposal was impossible, which is a worse failure than an unsafe one
because it looks like it works.

The case where a call *is* the right answer is a mandate that permits **asking**
the customer but not **charging** them: *"do not auto-retry my customers' cards,
but you may send them a link."* That is a realistic and rather thoughtful
merchant policy, and under it the contact channels are the only channels there
are. So the demo constructs that mandate — **re-signed with the merchant's own
Ed25519 key**, because `policy.evaluate` refuses an unverifiable mandate before
it checks anything else — and runs it through the same `channels.decide`, the
same kernel and the same state machine. Nothing is bypassed. What is
constructed is the payment and the merchant's choice of permissions, and both
are named on screen.

### The demo, and the two failures worth showing

₹12,400 · soft decline · contact on file · mandate permits asking, not charging

```
1  Revenue Doctor decides    VOICE
2  The kernel rules          STEP_UP · STEP_UP_ABOVE_AUTO_LIMIT
                             Rs 12,400 is above the Rs 3,000 auto-execute
                             limit, so a person says yes before the call
3  The channel executes      one attempt, then stops
```

**Customer accepts** → link authorised → `₹0 recovered, awaiting a
payment_link.paid event`. The call did not recover anything; it authorised an
ask.

**Customer disputes it** — *"I don't recognise this payment."*

> Understood. I will not proceed with the payment recovery. I am stopping here
> and escalating this for review. No payment action will be taken.

→ `ESCALATED · no payment action taken · ₹0`

**Customer offers a card number** — the agent refuses and continues the
permitted flow:

> I cannot ask you for any payment details, and I never take them over the
> phone. All I can do is send a secure link for you to complete yourself.

Hinglish is one alternate line table over the identical state machine, so a
language cannot introduce a branch the English path does not have. A test
walks every line of both tables through every guardrail.

---

## Recovery Data Room and lineage

`/data` reports every source a recovery number depends on — records, origin,
ingestion state, completeness, duplicates refused, invalid rows, and
**unresolved references**. That last column is the one that earns its place: an
outcome event naming a payment no batch contains means the loop has a hole in
it, and it surfaces as a warning rather than as a total that is quietly a bit
small.

`/api/lineage/{merchant}/{txn}` walks one payment all the way down:

```
PAYMENT     pay_cloudsync_1065 · HDFC Bank · hour 3 · payment_pending
DECISION    retry_soft_decline proposed
POLICY      allow · OK_WITHIN_MANDATE
EXECUTION   executed, by platform
EVENT       payment.captured · failed → captured  (synthetic)
AUDIT       entry 4f2a… chained to 91be…
RECOVERED   Rs 2,858 — confirmed by outcome event
```

Rendered as a drawer on `/recover`, not a graph: the relationship is a
sequence, and a sequence drawn as a node graph is harder to read for no gain.

---

## Money reconciliation

`src/doctor/reconcile.py` exists because the UI must never show a number that
cannot be walked down to the records under it.

Every failed payment in a batch lands in **exactly one** bucket, and the
buckets sum to the money at risk:

```
CloudSync Pro · run_beec9668
  recovered                     3 payments      ₹4,741
  attempted, did not convert    9 payments      ₹8,687
  held for the merchant        50 payments   ₹2,87,283
  refused by the mandate       16 payments   ₹3,13,911
  escalated to a human          0 payments          ₹0
  no action proposed          149 payments  ₹11,50,097
  ─────────────────────────────────────────────────────
  at risk                     227 payments  ₹17,64,721   ✓ closes
```

The aggregates are **not trusted** — they are recomputed from the ledger and
compared against what the run file claims. Eleven invariants per run, checked
on all eight committed runs by `tests/test_reconcile.py`:

* buckets sum to money at risk, and to the payment count
* no payment appears in two buckets
* each bucket's drilldown matches its own total, row for row
* `report.gate.decisions` equals what the ledger entries actually say
* `recovery_vs_truth.measured_paise` recomputes from the ledger and the truth
* the hash chain verifies from genesis, and a tampered entry breaks the check
* the reconciliation is capable of failing — a corrupted total is asserted to
  be *caught*, so the check cannot pass vacuously

`/api/reconcile/{run_id}/{bucket}` returns the payments behind any number, each
with the action proposed, the rule the gate applied, the outcome, and the hash
of the audit entry that recorded it:

```
AGGREGATE → PAYMENT → DECISION → POLICY → EXECUTION → OUTCOME → AUDIT ENTRY
```

The Evidence page is that walk, rendered. Click ₹4,741 and get the three
payments.

**This is also how the Book's headline stays honest:** `total_at_risk_paise` on
`/api/portfolio` is computed by `reconcile._batch`, the same function backing
the drilldown, so the summary and the detail are one computation rather than
two that can drift apart.

---

## What is measured

200 merchants, each carrying a **known** cause of a **known** size. Ground truth
is the same Shapley decomposition computed *analytically* over the true
generating distribution — exact joint, exact `p_success`, no sampling. The
difference between that and what the engine produces from the sampled batch
**is** the error.

| Factor | MAE (pts) | bias | p90 | coverage ±0.5 |
|---|---|---|---|---|
| bank | 0.573 | +0.041 | 1.259 | 59.0% |
| method | 0.569 | −0.026 | 1.292 | 58.5% |
| hour | 0.568 | −0.058 | 1.233 | 58.5% |
| amount_band | 0.578 | −0.029 | 1.288 | 57.5% |

Primary-cause accuracy **97.5%** (157/161) · mean |residual| **0.35 pts** · mandate
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
Shapley's 6%. **It did not reproduce** — both score 97.5%, and across the
161 scored merchants they did not disagree on a single one.

So I measured what Shapley *does* buy:

```
sum(attribution) / v(N)     1.000 = the parts add up to the whole
  Shapley   mean 1.0000     max deviation 0.00e+00
  Naive     mean 2.2069     range −13.59 … +38.20
```

Naive **ranks** fine; its **magnitudes are incoherent**, averaging 2.2× the real
gap and overstating it on 75.7% of merchants. You cannot convert that into rupees — and every output here is a rupee
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

**Nineteen things. Seventeen found by a measurement disagreeing with me, not by
a crash** — the last one by a check I wrote to prove the others were safe. Full write-up: **[`docs/what_broke.md`](docs/what_broke.md)** — the
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
because Python randomises float summation order through set iteration, because
Python randomises string hashing.**

The newest one is the best-behaved failure in the list. The money partition
closed on all eight runs — buckets summed to the money at risk, to the payment
count, every total agreed. It was wrong anyway: a plan contains ACCOUNT-level
actions (`merchant:cloudsync`, "enable multi-bank routing") which were being
counted as payments. They are worth ₹0, so the money reconciled perfectly while
the untouched bucket was one payment short on every run on the book. Nothing
visible was broken and no total disagreed. What caught it was the test that
asserts each bucket's **drilldown** has exactly as many rows as the bucket
claims payments — an invariant one level below the one I thought was
sufficient. Account-level entries are now excluded from the partition and
reported separately, because silently dropping a ledger entry is the exact
failure mode `reconcile.py` exists to prevent.

Two more from the recovery-channel work, both of the same shape — code that
was wrong while looking like it worked.

**The idempotency key was being erased by the thing that stored it.**
`events.ingest` overwrote `processing_note` for any event type it did not
recognise, and that note is exactly where `record_action` puts the
`(payment, action)` key. Our own event types were not in `KNOWN_TYPES`, so
every duplicate-action check silently returned `False`. The layer whose entire
purpose is to stop a redelivered webhook producing a second charge was not
stopping anything, and nothing failed — the second execution just quietly
happened. Caught by driving the loop twice through the API and looking at what
came back rather than at whether it errored.

**The channel policy proposed calls the kernel could never permit.**
`REISSUE_PAYMENT_LINK` is in `AUTO_EXECUTABLE`, so the attempt cap and the hard
ceiling bind a payment link exactly as they bind a retry. The channel layer did
not know that and offered voice and links for above-ceiling payments; the
kernel denied all 25. The layering was correct and the proposal was
structurally impossible — which is worse than an unsafe bug, because a page
full of DENIED rows looks like the safety working. Fixing it turned a broken
feature into the most interesting finding in the section: under a mandate that
permits both retrying and asking, **the contact channels are unreachable and
the policy never phones anybody.**

Two from Control Tower, and the second is the best argument in this README for
browser tests that refuse to skip.

**A card read `CONFIDENCE 1.00` next to `EVIDENCE WEAK`.** Both halves were
individually correct. TechBazaar's top factor clears its error bar 2.6x and the
classifier was certain of the error code — but that factor is *degenerate*, so
there is nothing to reweight toward and the ratio is measuring nothing. An
unidentified factor does not lower confidence, it invalidates the quantity
confidence was computed from. It reports **unavailable** now, which is the
answer the rest of this product already gives everywhere else.

**The audit passed while skipping four assertions.** The deny-specific drawer
checks ran only `if` a denied decision happened to be on screen, and when none
was, the audit printed a clean sheet. Turning that skip into a FAIL
immediately exposed a real prioritisation bug: a **refused** payment of
Rs 24,973 ranked below a routine Rs 14,769 hold, so the highest-value mandate
refusal on the book sat at rank 30 where nobody would find it. A hold needs a
click; a refusal needs somebody to decide whether to raise a signed limit, and
the bigger the payment the more that decision is worth making. Refusals rank
above holds now. The green tick had been hiding it.

---

## Architecture

```
       PROBABILISTIC                    DETERMINISTIC
       proposes, reasons, estimates     constrains, authorises, records
  ─────────────────────────────────┬─────────────────────────────────────
                                   │
ingest ─▶ classify ─low conf─▶ human_review
           [LLM]               [HUMAN]      │
             │ confidence ≥ 0.85            │
             ▼                              │
                                   │  bank_health [DET] ◀─ NPCI join
                                   │        │
                                   │  decompose [DET]  Shapley-OB,
                                   │        │          16 coalitions
      hypothesise [LLM]  ◀─────────┤        │
      forced-choice root cause     │        │
             │                     │        │
        plan [LLM]                 │  uncertainty gate [DET]
        typed actions ─────────────┼─▶ >2× MAE act · 1–2× ask · <1× refuse
                                   │        │
                                   │  gate [DET]  Ed25519 mandate
                                   │              12-check policy kernel
                                   │        │
                                   │  ┌─────┼─────┬────────┐
                                   │  ▼     ▼     ▼        ▼
                                   │ ALLOW  HOLD  DENY   ABSTAIN
                                   │  │     │
                                   │  ▼     └─▶ merchant confirms
                                   │ execute [DET]  bounded, idempotent
                                   │        │
                                   │  ledger [DET]  SHA-256 hash chain,
                                   │        │       actor inside the hash
  ─────────────────────────────────┴────────┼─────────────────────────────
                                            ▼
                                     VERIFICATION
                        reconcile.py   buckets sum to money at risk
                        scoring.py     retries marked against truth
                        counterfactual what the alternatives would have done
                        prove.py       sealed → blind → revealed → verified
```

**The model never holds a credential and never emits an action.** It emits a
`ProposedAction` — a validated struct drawn from a closed enum — which a
deterministic kernel then accepts or rejects. A fully prompt-injected model
still cannot exceed the mandate, because it never held the signing key and its
output is parsed, not executed.

**Deterministic wherever correctness is checkable; a model only where judgement
is required.** The gate, the decomposition, the retry list and all ten of the kernel's
checks never consult a model. See [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Run it

```bash
make setup      # python + console dependencies
make demo       # engine :8000 + console :8080
make test       # 669 tests
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
pytest -q                                  # 669 tests
```

The LLM evals need a key **once** to populate the cache; after that they
reproduce offline, and they **refuse to run against stub responses** rather than
produce a number that looks like a measurement. Either provider works —
`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`.

---

## Reproduce the demo

Five minutes, from a clean reset. Every number below is what the committed
data actually produces — nothing is staged.

| | | |
|---|---|---|
| 0:00 | **Book** | ₹5,56,225 of revenue opportunity across 8 merchants, 2,090 failed payments, ₹64,24,667 at risk. Hero is **₹39,833 recovered — measured**, not identified. |
| 0:40 | Click **CloudSync Pro** | 1,180 payments, 227 failures. |
| 1:00 | **Diagnose** → *Run diagnosis* | Ten real graph nodes stream over SSE. No timers, no interpolated progress: a node reads RUNNING only while the engine says so. |
| 1:50 | The gap | 80.76% → 87.35%, **6.59 pts**, ₹1,09,595/month opportunity. |
| 2:00 | Root cause | Hour-of-day degradation, **+3.79 ± 0.57 pts**, ACTIONABLE — it cleared 2× its own measured error. Two fixes withheld because theirs did not. |
| 2:30 | **Compare** | The Lab. Replayed over the same batch, naive retry gets ₹2,11,258 and this policy gets ₹16,026 — and the loop breaches the signed mandate 247 times and wastes 594 attempts getting there. Both are counterfactual; the row marked **measured** is what the live run actually did. The frontier prices raising the ₹3,000 auto-limit: ₹78,781 recovered, but ₹4,73,665 moved with nobody watching. |
| 3:20 | **Authorise** | AI proposes, policy decides: 14 allowed, 51 held, 16 denied. |
| 4:00 | One payment | `pay_cloudsync_0060`, ₹24,816, ceiling ₹15,000 → rule 5, `DENY_AMOUNT_ABOVE_CEILING`, **DENIED**. The AI asked; the policy refused; the money was protected. |
| 3:50 | **Recover** | Which channel reaches the customer — and that on this book it never has to: 103 retries, 90 no-action, 34 escalations, **zero customer contacts**. Then the voice demo: constructed, labelled, gated by a STEP_UP, and it reports ₹0 because a call cannot confirm a payment. |
| 4:20 | Retry ladder | Not "retry 3× every 30 minutes". Slots at +30h/+48h/+68h for a funding decline, all inside the 24–72h plateau, all inside the 7-day window and the attempt cap. When a stopping rule fires, execution stops. |
| 4:35 | **Evidence** | Click ₹4,741 → the three payments, each with its rule, outcome and audit hash. Eleven invariants hold; the chain re-hashes from genesis. |
| 4:45 | **Prove** | Sealed → blind → revealed → verified. |
| 4:55 | End | **₹39,833 recovered. Not identified.** |

```bash
# from a clean state
curl -X POST localhost:8000/api/demo/reset     # re-runs each merchant, reuses run_ids
python tests/browser/audit.py                  # drives the whole flow in Chromium
```

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