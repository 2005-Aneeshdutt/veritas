# Files you can feed the system

Drop these into **`/data`** in the running app. Nothing here is written to
disk by the upload — each file lives for the length of one request.

---

## `northwind_payments.csv` — a merchant the engine has never seen

2,400 payments from a ninth merchant that is **not** in the demo book.
Diagnosing one of the eight would prove nothing; this one is new data with a
cause deliberately injected, so the upload has an answer worth arriving at.

Upload it under **Grocery**, and it should find:

```
87.92%  ->  91.73%      gap 3.82 points
primary cause: hour     +3.24 points
```

That is the injected fault: payments charged in the 23:00–06:00 window fail
more than the same payments would at midday. The other three factors sit near
zero, which is the part worth pointing at — a method that found a cause
everywhere would be finding nothing.

It is written the way somebody else's system would write it, on purpose:

| this file says | the engine calls it |
|---|---|
| `payment_id` | `txn_id` |
| `issuer` | `bank` |
| `payment_method` | `method` |
| `amount_inr` (rupees) | `amount_paise` |
| `status` = `captured` / `failed` | `succeeded` = true / false |
| `error_reason` | `error_code` |

If the column matching only worked on our own spelling it would not be worth
having, so the sample deliberately uses none of it.

---

## `too_small_to_diagnose.csv` — the refusal

140 payments, which is not enough. The upload is **rejected**:

> only 140 usable payments. Below about 200 the uncertainty on a success rate
> is wider than the effects being attributed, so a diagnosis would be noise.

Worth showing. A demo that only ever walks the happy path is not
demonstrating restraint, and this system's whole argument is that it knows
when to say nothing.

---

## Bank data

The NPCI remitter table already ships at **`data/npci/remitter_banks.csv`** —
1,601 rows across 24 months of real published data. Upload that file to the
second panel on `/data` and pick a different month: every baseline is
re-derived from it, the achievable rate moves, and you can watch whether the
diagnosis holds.

For CloudSync, swapping August 2025 for January 2024 moves the achievable
rate 87.4% → 90.8% and widens the gap 6.6 → 10.0 points, because banks were
genuinely healthier that month — and the primary cause stays `hour`, because
a merchant billing at midnight has a midnight problem whatever the banks were
doing.

---

## Bringing your own

Four columns are required — `bank`, `method`, `amount`, `succeeded` — and
`error_code`, `hour` and `txn_id` sharpen the result. Success can be
`true`/`false`, `1`/`0`, or `captured`/`failed`. Error codes are read against
Razorpay's 110 published codes with **no model call**; anything outside that
list is carried as unclassified rather than guessed at.

An upload gets a diagnosis and nothing else — no recovery figure, because
there is no known outcome to mark it against, and no proposed actions,
because a file is not a signed mandate.
