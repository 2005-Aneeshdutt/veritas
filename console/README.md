# VERITAS — Console

**Recover what you can. Prove what happened.**

The operator console for VERITAS, a revenue-recovery agent built for the
**Razorpay AI Buildathon 2026, Track 03**.

A recovery agent reads a failed payment and proposes an action. A deterministic
policy kernel it does not control decides whether that action is allowed at all.
Every rupee it ends up claiming is marked against an outcome it never saw when
it decided — and the whole thing is written to a hash chain that can be
recomputed by anyone who doubts the number.

This repository is the **frontend only**. The engine, the policy kernel, the
ledger and the Razorpay integration live in a separate backend repo
(`revenue-doctor`). This app renders what that backend recorded; it computes no
financial figure of its own.

---

## Running it

You need Node 22+, and the backend running on `127.0.0.1:8000`.

```sh
npm install
npm run dev          # http://localhost:8080
```

Configuration is one variable, in `.env`:

```sh
VITE_API_BASE_URL=http://127.0.0.1:8000
```

> **Use `127.0.0.1`, not `localhost`.** This app server-renders, and Node
> resolves `localhost` to `::1` first while uvicorn binds IPv4 only. With
> `localhost` the browser works and SSR fails, which surfaces as a blank error
> page that names nothing.

Leave `VITE_API_BASE_URL` empty and the app falls back to a labelled demo
adapter, so the UI is still navigable without a backend.

```sh
npm run build        # production build, pinned to a 6 GB heap; it OOMs below that
npm run lint
```

---

## What the console is for

Thirteen surfaces answer different questions about the same book of payments.
The sidebar groups them by what you are trying to do.

| Group | Page | Answers |
| --- | --- | --- |
| — | **Overview** | What is at risk, what is recoverable, what is proven |
| Recover | **Control Tower** | What needs a decision right now |
| | **Payments** | Every failing, disputed or stalled payment |
| | **Recovery Journey** | What happened to this payment, stage by stage |
| | **Policy Kernel** | Whether an action was permitted, and which rule stopped it |
| Investigate | **Diagnosis** | Why it failed — Shapley attribution with error bars |
| | **Recovery Plan** | What the model recommends. A recommendation, not an authorisation |
| | **Counterfactual Lab** | What a less careful strategy would have recovered, and breached |
| Prove | **Outcome** | What actually happened after execution |
| | **Evidence** | The artifacts behind the claim, and the ones missing |
| | **Audit Ledger** | The append-only record, hashed in sequence |
| | **Prove** | The strongest claim the evidence supports, and no stronger |
| | **Gateway Proof** | Real Razorpay test-mode webhooks, as received |

`/login` is a public landing page for someone who has never seen the product —
the only page with ambient motion.

---

## The guided walk

The app is a mesh: every screen links to several others. That suits an operator
who knows what they want, and fails a person seeing it for the first time, who
needs the causal order.

`CaseWalk` draws one path through that mesh, in the order the pipeline actually
runs:

```
1 Journey → 2 Diagnosis → 3 Plan → 4 Policy → 5 Outcome → 6 Evidence → 7 Ledger → 8 Proof
```

Diagnosis sits before Policy deliberately: diagnose, then propose, then
authorise. It appears on all eight stages as a bar carrying the payment, a
stepper, and an **Execute for this payment** button that advances one stage. A
dropdown switches record mid-walk — showing the refusal and then the recovery
without leaving the stage you are on.

Position comes from the URL, not from stored state, so there is no walk to start
or lose: open any stage with a `?case=` and the walk is already there. It
carries any payment from the Control Tower queue, not only the three labelled
records.

**Changing the demo order is changing `CASE_FLOW` in
[`case-walk.tsx`](src/components/veritas/case-walk.tsx). Nothing else knows it.**

---

## Nothing is precomputed on arrival

Several pages hold a settled result computed when the run was committed.
Rendering it instantly reads as a slide rather than a system, so those pages
replay their own work on arrival:

- **Policy Kernel** — the twelve checks evaluate one at a time (~3.5 s). Until
  they settle, the verdict, the authority chain, the check tally, the failure
  line, the consequence row and the case's own history row are all withheld.
  Checks after the one that stopped the kernel render as *never evaluated*, not
  as failures.
- **Diagnosis** — factor bars grow from zero one at a time (~1.6 s); the top
  factor and actionability land only once attribution completes.
- **Counterfactual Lab** — the strategy comparison runs its steps before any
  result appears (~3.5 s).

Withheld means *not rendered*, not `opacity: 0`. A transparent answer is still
in the DOM, the accessibility tree and any copy-paste, which is exactly the kind
of "invisible but present" claim this product exists to argue against.

---

## Demo controls

- **Approve the whole book** (Control Tower) — approves every queued action at
  once. What the kernel denied stays denied however many times it is approved:
  approving a queue is a person saying yes to work already inside the agent's
  authority, not granting more.
- **Reset** (top bar, every page) — rebuilds the runs deterministically from
  cached model calls, reusing each run id, so a rehearsal is undoable and every
  link still resolves. Takes ~14 s. It writes to disk, and it *is* the undo, so
  it fires on the first click without a confirmation step.

---

## Rules this codebase follows

**No financial figure is hardcoded.** Every rupee comes from `/api/portfolio` or
a run's own reconciliation. That is verified by moving the backend and checking
the screen follows — not by grepping for literals, which a stale value that
happens to match would survive.

**Claims are labelled, and the labels mean different things.**
`MEASURED` (marked against a held-out outcome) · `PROJECTED` (a forecast) ·
`OBSERVED` · `UNVERIFIED` (acted, outcome not established) · `ABSTAINED` (no
claim made). A projection is never rendered as money recovered.

**A gateway capture is not a recovery.** Razorpay confirming a payment is the
gateway's claim; ours requires the held-out outcome. The live test-mode
transactions shown on Gateway Proof are never added to the measured total.

**Failures stay on screen.** Merchants that recovered nothing are still listed.
A payment whose outcome could not be established shows as `UNVERIFIED` rather
than being quietly dropped.

**One source per screen.** `useJourneyCase` never merges backend and fixture
data into one case — a half-real record with fixture policy checks stapled on
would be the most misleading artifact this app could produce.

---

## Layout

```
src/
  routes/                    18 file-based routes (TanStack Router)
    _app.tsx                 authenticated shell — sidebar, top bar
    _app.<page>.tsx          one file per console page
    login.tsx                public landing page
  components/veritas/        29 product components
    case-walk.tsx            the guided walk, and CASE_FLOW
    demo-reset.tsx           top-bar reset
    approve-book.tsx         approve-the-whole-book control
    landing.tsx              the public page
    network-background.tsx   ambient canvas (landing only)
  data/
    backend-adapter.ts       the only place that talks to the API
    demo-adapter.ts          labelled fallback when no backend is configured
    map-journey.ts           backend payload → domain case
  domain/                    money, journey and claim types
  hooks/                     useJourneyCase, useJourneyCases, useLedger
docs/
  build-brief.md             the original Phase 1 build specification
```

**Stack:** React 19 · TanStack Start / Router / Query · Vite · Tailwind v4 ·
Radix primitives · Recharts · Lucide.

---

## Known issue

**The Audit Ledger does not show the walkthrough payments.** It reads
`/api/audit`, which returns only the 60 most recent entries (capped at 400) of
1,057 — currently none of them CloudSync — so filtering by any demo case renders
`0 of 60 entries`. The hash columns also render blank, because
[`use-ledger.ts`](src/hooks/use-ledger.ts) maps `prevHash` and `hash` to empty
strings while the API returns `entry_hash` on every entry.

The data is fine: `/api/run/{run_id}` → `report.ledger` contains every payment
with both hashes, and the Policy page already reads it correctly. The fix is to
source the case-filtered view from the run's own ledger and pass the hashes
through. Until then stage 7 of the walk is empty for the demo records; the Proof
page covers the same ground.

---

## Development notes

Things that cost time here, written down so they cost it once:

- **A new component file needs a dev-server restart.** Tailwind will not emit
  classes it has never seen; without a restart the class is on the element and
  absent from the CSS, so the padding is silently zero.
- **`exactOptionalPropertyTypes` is on.** An optional prop must admit
  `| undefined` explicitly rather than by omission.
- **`validateSearch` returning `{ case: undefined }` makes the param
  *required*.** Every case-aware route declares it as
  `typeof search["case"] === "string" ? ... : undefined`.
- **Route components are code-split.** Grepping the served module for a symbol
  finds nothing — the component lives at `?tsr-split=component`.
- Selection lives in the URL, so every screen is a shareable link to one payment
  and switching case updates every page the same way.
