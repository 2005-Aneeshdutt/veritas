"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/Chrome";
import { Card, Detail, Empty, Eyebrow, Loading, SectionHeader, Stagger, Ticker } from "@/components/ui";
import { inr } from "@/lib/types";

interface Code {
  code: string;
  owner: string;
  count: number;
  total_paise: number;
  merchants: number;
  merchant_names: string[];
  next_steps: string;
  explanation: string;
  systemic: boolean;
}

interface Group {
  owner: string;
  label: string;
  count: number;
  total_paise: number;
  share_pct: number;
  codes: Code[];
}

interface Backlog {
  merchants: number;
  total_count: number;
  total_paise: number;
  groups: Group[];
  platform_paise: number;
  platform_share_pct: number;
  platform_codes: Code[];
  systemic_codes: number;
}

const TONE: Record<string, { bar: string; text: string; chip: string }> = {
  merchant: { bar: "bg-amber", text: "text-amber", chip: "chip-projected" },
  platform: { bar: "bg-brand", text: "text-brand", chip: "chip-brand" },
  customer: { bar: "bg-line", text: "text-muted", chip: "chip-neutral" },
  unknown: { bar: "bg-edge", text: "text-faint", chip: "chip-neutral" },
};

/**
 * The money nobody was going to get back, sorted by who has to act.
 *
 * Every other page in this product is about recovering a payment. This one is
 * about the payments that are gone — and it exists because the aggregate is a
 * different fact from the parts.
 *
 * A merchant sees their own failures and nothing else, so twelve
 * `beneficiary_account_does_not_exist` reads as twelve bad account numbers.
 * The same code across six merchants in one month is a statement about the
 * rail, and only the platform is standing where it can be seen. That is the
 * one thing here worth more to Razorpay than to any merchant on the book.
 */
export default function WhoseFaultPage() {
  const [b, setB] = useState<Backlog | null>(null);
  const [dead, setDead] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/defects")
      .then((r) => r.json())
      .then(setB)
      .catch(() => setDead(true));
  }, []);

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-canvas lg:pl-60">
      <TopBar />
      <main className="max-w-[1400px] mx-auto px-6 py-8 space-y-6">{body}</main>
    </div>
  );

  if (dead) return shell(<Empty label="the API did not respond" />);
  if (!b) return shell(<Loading label="reading every write-off in the book" />);

  const merchantGroup = b.groups.find((g) => g.owner === "merchant");

  return shell(
    <>
      <Stagger>
        <div>
          <Eyebrow>Across all {b.merchants} merchants</Eyebrow>
          <h1 className="text-2xl font-semibold mt-1">Whose fault is it?</h1>
          <p className="text-sm text-muted mt-1.5 max-w-3xl leading-relaxed">
            {b.total_count.toLocaleString("en-IN")} payments this month failed
            for reasons no retry can fix. They are written off everywhere else
            in this product. Here they are attributed to whoever actually has
            to do something — using Razorpay&rsquo;s own published guidance for
            each code, not our opinion of it.
          </p>
        </div>
      </Stagger>

      {/* ── the split ── */}
      <Stagger i={1}>
        <Card>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="num text-3xl font-semibold">
              <Ticker value={b.total_paise / 100} prefix="₹" />
            </span>
            <span className="text-sm text-muted">unrecoverable this month</span>
            <span className="chip-measured ml-auto">measured</span>
          </div>

          <div className="flex h-2.5 rounded-full overflow-hidden mt-5 bg-raised">
            {b.groups.map((g) => (
              <div
                key={g.owner}
                className={TONE[g.owner]?.bar ?? "bg-line"}
                style={{ width: `${g.share_pct}%` }}
                title={`${g.label} — ${g.share_pct}%`}
              />
            ))}
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
            {b.groups.map((g) => (
              <div key={g.owner} className="card-raised p-3.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${TONE[g.owner]?.bar}`} />
                  <span className="eyebrow">{g.owner}</span>
                </div>
                <div className="num text-xl font-semibold mt-1.5">
                  {inr(g.total_paise)}
                </div>
                <div className="text-[12px] text-muted mt-0.5">
                  {g.share_pct}% · {g.count} payments
                </div>
                <div className="text-[11px] text-faint mt-1.5 leading-tight">
                  {g.label}
                </div>
              </div>
            ))}
          </div>

          <Detail summary="where the attribution comes from">
            <p>
              Razorpay publishes a <span className="num">next_steps</span> line
              for every one of its 110 error codes, and that line is addressed
              to somebody. &ldquo;The customer must use a different card&rdquo;
              is the customer&rsquo;s. &ldquo;Please reach out to
              Razorpay&rdquo; is the platform&rsquo;s. &ldquo;Please make sure
              the payment amount is…&rdquo; is the merchant&rsquo;s. Reading
              the owner off that sentence means the split is grounded in the
              same published source as the taxonomy, and a code Razorpay adds
              tomorrow gets classified by its own guidance rather than by a
              list here that has quietly gone stale.
            </p>
            <p>
              Codes whose wording is genuinely ambiguous — &ldquo;retry with a
              different payment method&rdquo; could be either party — come out{" "}
              <span className="num">unknown</span> and are reported as unknown.
              Putting a merchant to work on something that was never theirs is
              worse than admitting we cannot tell.
            </p>
            <p>
              Every rupee on this page is <strong>measured</strong>. These
              payments already failed for a reason the taxonomy says is not
              retryable, so nothing here is forecast and nothing here carries
              an error bar — unlike every recovery figure elsewhere in the
              product, which does.
            </p>
          </Detail>
        </Card>
      </Stagger>

      {/* ── the platform's own backlog ── */}
      <Stagger i={2}>
        <Card>
          <SectionHeader
            eyebrow="Only the platform can see this"
            title="Razorpay's defect backlog"
            sub="One merchant seeing a code twelve times sees twelve bad account numbers. Six merchants seeing it in the same month is a statement about the rail — and no merchant is standing anywhere they could notice."
          />

          <div className="flex flex-wrap gap-2 mb-4">
            <span className="chip-brand">
              {inr(b.platform_paise)} · {b.platform_share_pct}% of the write-off
            </span>
            <span className="chip-neutral">{b.platform_codes.length} codes</span>
            <span className="chip-measured">
              {b.systemic_codes} hitting more than one merchant
            </span>
          </div>

          {b.platform_codes.length === 0 ? (
            <Empty label="nothing attributable to the platform this month" />
          ) : (
            <div className="space-y-1">
              {b.platform_codes.map((c) => (
                <CodeRow
                  key={c.code}
                  c={c}
                  max={b.platform_codes[0].total_paise}
                  open={open === c.code}
                  onToggle={() => setOpen(open === c.code ? null : c.code)}
                />
              ))}
            </div>
          )}

          <p className="text-[11px] text-faint mt-4 leading-relaxed">
            Ranked by money, not by count, because an engineer&rsquo;s
            afternoon should go where the rupees are. &ldquo;Systemic&rdquo;
            means two or more merchants — below that it is one integration
            having a bad month, and calling it a platform defect would waste
            the ticket.
          </p>
        </Card>
      </Stagger>

      {/* ── the tickets that never need a person ── */}
      <Stagger i={3}>
        <Deflection backlog={b} />
      </Stagger>

      {/* ── what the reader can fix today ── */}
      {merchantGroup && (
        <Stagger i={4}>
          <Card>
            <SectionHeader
              eyebrow="Not the platform's, not the customer's"
              title="What a merchant can fix this afternoon"
              sub="Configuration, not bad luck. This used to sit inside a bucket labelled permanently unusable, which told merchants nothing could be done while they lost money on every affected payment."
            />
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="chip-projected">
                {inr(merchantGroup.total_paise)} · {merchantGroup.share_pct}%
              </span>
              <span className="chip-neutral">
                {merchantGroup.count} payments
              </span>
            </div>
            <div className="space-y-1">
              {merchantGroup.codes.slice(0, 8).map((c) => (
                <CodeRow
                  key={c.code}
                  c={c}
                  max={merchantGroup.codes[0].total_paise}
                  open={open === c.code}
                  onToggle={() => setOpen(open === c.code ? null : c.code)}
                />
              ))}
            </div>
          </Card>
        </Stagger>
      )}
    </>
  );
}

/**
 * The failures that already have an answer.
 *
 * Every one of these 765 payments failed for a reason Razorpay publishes a
 * next step for. That makes each of them a support ticket with a canned
 * resolution sitting in front of it — and a customer who is told what to do
 * at the moment the payment fails is a customer who does not write in.
 *
 * The honest part is the arithmetic. The COUNT is measured; how many of those
 * customers would actually have contacted support, and what a contact costs,
 * are two things this system has never observed and cannot pretend to. So
 * they are inputs, they start at values you are invited to change, and the
 * result is labelled as yours rather than ours. A deflection rate quoted as a
 * finding here would be the one invented number on a page whose whole point
 * is that it does not invent numbers.
 */
function Deflection({ backlog }: { backlog: Backlog }) {
  const [rate, setRate] = useState(15);
  const [cost, setCost] = useState(75);

  const customer = backlog.groups.find((g) => g.owner === "customer");
  const answerable = backlog.groups.reduce(
    (n, g) => n + g.codes.filter((c) => c.next_steps).reduce((m, c) => m + c.count, 0),
    0
  );
  const contacts = Math.round((answerable * rate) / 100);
  const saved = contacts * cost;

  return (
    <Card>
      <SectionHeader
        eyebrow="A ticket answered before it is written"
        title="Every one of these already has an answer"
        sub="All of these payments failed for a code Razorpay publishes a next step for. Shown to the customer at the moment of failure, that is a support contact that never happens."
      />

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card-raised p-4">
          <div className="eyebrow">failures with a published answer</div>
          <div className="num text-2xl font-semibold mt-1">
            {answerable.toLocaleString("en-IN")}
          </div>
          <div className="text-[11px] text-faint mt-1">
            {answerable === backlog.total_count
              ? "every one, with no exceptions"
              : `of ${backlog.total_count.toLocaleString("en-IN")}`}
          </div>
          <span className="chip-measured mt-2 inline-flex">measured</span>
        </div>

        <div className="card-raised p-4">
          <div className="eyebrow">of those, the customer&rsquo;s own</div>
          <div className="num text-2xl font-semibold mt-1">
            {(customer?.count ?? 0).toLocaleString("en-IN")}
          </div>
          <div className="text-[11px] text-faint mt-1">
            wrong PIN, expired OTP, exhausted credit limit — the ones people
            ring about
          </div>
          <span className="chip-measured mt-2 inline-flex">measured</span>
        </div>

        <div className="card-raised p-4 border-l-2 border-l-amber">
          <div className="eyebrow">contacts avoided, at your numbers</div>
          <div className="num text-2xl font-semibold mt-1 text-amber">
            ₹{saved.toLocaleString("en-IN")}
          </div>
          <div className="text-[11px] text-faint mt-1">
            {contacts.toLocaleString("en-IN")} contacts × ₹{cost}
          </div>
          <span className="chip-projected mt-2 inline-flex">your assumption</span>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <Slider
          label="how many of these would have contacted support"
          value={rate}
          min={0}
          max={60}
          suffix="%"
          onChange={setRate}
        />
        <Slider
          label="what one support contact costs you"
          value={cost}
          min={0}
          max={400}
          step={5}
          prefix="₹"
          onChange={setCost}
        />
      </div>

      <p className="text-[12px] text-faint mt-4 leading-relaxed">
        Both of those are yours, not ours. This system has never watched a
        support queue, so it has no contact rate and no cost per ticket to
        report — quoting one as a finding would be the single invented number
        on a page whose argument is that it does not invent them. The count on
        the left is the measurement; the rest is your arithmetic, shown
        because it is the arithmetic you were going to do anyway.
      </p>
    </Card>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  prefix = "",
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <div className="flex items-center gap-3 mt-1.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-brand"
        />
        <span className="num text-sm w-16 text-right">
          {prefix}
          {value}
          {suffix}
        </span>
      </div>
    </label>
  );
}

function CodeRow({
  c,
  max,
  open,
  onToggle,
}: {
  c: Code;
  max: number;
  open: boolean;
  onToggle: () => void;
}) {
  const tone = TONE[c.owner] ?? TONE.unknown;
  return (
    <div className="rounded-lg border border-line overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left
                   hover:bg-raised/60 transition-colors"
      >
        <span className="num text-[12px] flex-1 min-w-0 truncate">{c.code}</span>

        <span className="hidden sm:block w-28 shrink-0">
          <span className="block h-1.5 rounded-full bg-raised overflow-hidden">
            <span
              className={`block h-full ${tone.bar}`}
              style={{ width: `${Math.max(3, (100 * c.total_paise) / max)}%` }}
            />
          </span>
        </span>

        {c.systemic && (
          <span className="chip-brand shrink-0 hidden md:inline-flex">
            {c.merchants} merchants
          </span>
        )}

        <span className="num text-[13px] w-24 text-right shrink-0">
          {inr(c.total_paise)}
        </span>
        <span className="text-[11px] text-faint w-14 text-right shrink-0">
          {c.count} pmts
        </span>
        <span className={`text-faint shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>
          ›
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-line bg-raised/40 space-y-2 animate-rise">
          {c.explanation && (
            <p className="text-[13px] text-muted leading-relaxed">{c.explanation}</p>
          )}
          {c.next_steps && (
            <div>
              <Eyebrow>Razorpay&rsquo;s own instruction</Eyebrow>
              <p className="text-[13px] mt-0.5 leading-relaxed">{c.next_steps}</p>
            </div>
          )}
          <div>
            <Eyebrow>Seen at</Eyebrow>
            <div className="flex flex-wrap gap-1 mt-1">
              {c.merchant_names.map((m) => (
                <span key={m} className="chip-neutral">
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
