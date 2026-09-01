"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/Chrome";
import {
  Detail,
  Empty,
  Eyebrow,
  Figure,
  Figures,
  Hero,
  Loading,
  Notes,
  PageHead,
  SectionHeader,
  Stagger,
  Ticker,
} from "@/components/ui";
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
    <div className="min-h-screen bg-canvas lg:pl-56">
      <TopBar />
      <main className="max-w-[1180px] mx-auto px-8 py-8 space-y-8">{body}</main>
    </div>
  );

  if (dead) return shell(<Empty label="the API did not respond" />);
  if (!b) return shell(<Loading label="reading every write-off in the book" />);

  const merchantGroup = b.groups.find((g) => g.owner === "merchant");

  return shell(
    <>
      <Stagger>
        <PageHead
          title="Platform"
          sub={`${b.total_count.toLocaleString("en-IN")} payments across ${b.merchants} merchants failed this month for reasons no retry can fix. Here they are attributed to whoever actually has to act.`}
        />
      </Stagger>

      {/* One number, then who owns it. The split is a single bar rather
          than four tiles: these are shares of one pile, and four boxes state
          them as four unrelated facts. */}
      <Stagger i={1}>
        <div className="grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] gap-8 items-start">
          <div>
            <div className="flex items-center gap-2">
              <span className="ui text-[10px] uppercase tracking-[0.12em] text-faint">
                Unrecoverable
              </span>
              <span className="chip-measured">measured</span>
            </div>
            <div className="num text-[34px] font-semibold leading-none mt-2.5">
              <Ticker value={b.total_paise / 100} prefix="₹" />
            </div>
            <div className="text-[12px] text-muted mt-2.5 leading-relaxed">
              <span className="num">{b.total_count.toLocaleString("en-IN")}</span>{" "}
              payments across{" "}
              <span className="num">{b.merchants}</span> merchants failed for
              reasons no retry can fix. Nothing on this page is forecast, so
              nothing on it carries an error bar.
            </div>
          </div>

          <div>
            <div className="ui text-[10px] uppercase tracking-[0.12em] text-faint mb-2.5">
              Who has to act
            </div>
            <div className="flex h-3 rounded-full overflow-hidden bg-raised">
              {b.groups.map((g) => (
                <div
                  key={g.owner}
                  className={TONE[g.owner]?.bar ?? "bg-line"}
                  style={{ width: `${g.share_pct}%` }}
                  title={`${g.label} — ${g.share_pct}%`}
                />
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 mt-4">
              {b.groups.map((g) => (
                <div key={g.owner} className="flex items-baseline gap-2.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                      TONE[g.owner]?.bar
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="ui text-[11px] uppercase tracking-[0.1em] text-muted">
                        {g.owner}
                      </span>
                      <span
                        className={`num text-lg font-semibold ml-auto ${
                          g.owner === "platform" ? "text-brand" : ""
                        }`}
                      >
                        {g.share_pct}%
                      </span>
                    </span>
                    <span className="block text-[11px] text-faint mt-0.5">
                      {inr(g.total_paise)} · {g.count} payments
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Stagger>

      {/* ── the platform's own backlog ── */}
      <Stagger i={2}>
        <SectionHeader
          title="Razorpay's defect backlog"
          sub="One merchant seeing a code twelve times sees twelve bad account numbers. Six merchants seeing it in one month is a statement about the rail."
          right={
            <span className="text-[12px] text-muted whitespace-nowrap">
              <span className="num text-brand">{inr(b.platform_paise)}</span> ·{" "}
              {b.systemic_codes} of {b.platform_codes.length} codes systemic
            </span>
          }
        />

        {b.platform_codes.length === 0 ? (
          <Empty label="nothing attributable to the platform this month" />
        ) : (
          <div>
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

        <p className="text-[11px] text-faint mt-3 leading-relaxed">
          Ranked by money, not by count, because an engineer&rsquo;s afternoon
          should go where the rupees are. Systemic means two or more merchants
          — below that it is one integration having a bad month, and calling
          it a platform defect would waste the ticket.
        </p>
      </Stagger>

      {/* ── the tickets that never need a person ── */}
      <Stagger i={3}>
        <Deflection backlog={b} />
      </Stagger>

      {/* ── what the reader can fix today ── */}
      {merchantGroup && (
        <Stagger i={4}>
          <SectionHeader
            title="What a merchant can fix this afternoon"
            sub="Configuration, not bad luck. This used to sit in a bucket labelled permanently unusable, which told merchants nothing could be done while they lost money on every affected payment."
            right={
              <span className="text-[12px] text-muted whitespace-nowrap">
                <span className="num">{inr(merchantGroup.total_paise)}</span> ·{" "}
                {merchantGroup.count} payments
              </span>
            }
          />
          <div>
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
        </Stagger>
      )}

      <Notes>
        <Detail summary="where the attribution comes from">
          <p>
            Razorpay publishes a <span className="num">next_steps</span> line
            for every one of its 110 error codes, and that line is addressed to
            somebody. &ldquo;The customer must use a different card&rdquo; is
            the customer&rsquo;s. &ldquo;Please reach out to Razorpay&rdquo; is
            the platform&rsquo;s. &ldquo;Please make sure the payment amount
            is…&rdquo; is the merchant&rsquo;s. Reading the owner off that
            sentence means the split is grounded in the same published source
            as the taxonomy, and a code Razorpay adds tomorrow is classified by
            its own guidance rather than by a list here that has quietly gone
            stale.
          </p>
          <p>
            Codes whose wording is genuinely ambiguous — &ldquo;retry with a
            different payment method&rdquo; could be either party — come out{" "}
            <span className="num">unknown</span> and are reported as unknown.
            Putting a merchant to work on something that was never theirs is
            worse than admitting we cannot tell.
          </p>
        </Detail>
        <Detail summary="why nothing here has an error bar">
          <p>
            Every rupee on this page is measured. These payments already failed
            for a reason the taxonomy says is not retryable, so nothing here is
            forecast — unlike every recovery figure elsewhere in the product,
            which is, and which carries one.
          </p>
        </Detail>
      </Notes>
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
    <>
      <SectionHeader
        title="Every one of these already has an answer"
        sub="All of them failed for a code Razorpay publishes a next step for. Shown to the customer at the moment of failure, that is a support contact that never happens."
      />

      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-3
                      divide-y divide-line sm:divide-y-0 sm:divide-x">
        <Figure
          label="failures with a published answer"
          kind="measured"
          value={answerable.toLocaleString("en-IN")}
          sub={
            answerable === backlog.total_count
              ? "every one, with no exceptions"
              : `of ${backlog.total_count.toLocaleString("en-IN")}`
          }
        />
        <Figure
          label="of those, the customer's own"
          kind="measured"
          value={(customer?.count ?? 0).toLocaleString("en-IN")}
          sub="wrong PIN, expired OTP, exhausted credit limit — the ones people ring about"
        />
        <Figure
          label="contacts avoided, at your numbers"
          kind="projected"
          tone="bad"
          value={`₹${saved.toLocaleString("en-IN")}`}
          sub={`${contacts.toLocaleString("en-IN")} contacts × ₹${cost} — your assumption, not our measurement`}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4 mt-6">
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
    </>
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
  // A list of codes is a list, not fourteen bordered boxes. One hairline
  // between rows, and the row itself opens.
  return (
    <div className="border-b border-line/70 last:border-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 py-2 text-left -mx-2 px-2 rounded
                   hover:bg-raised transition-colors"
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
        <div className="pb-4 pt-1 pl-3 border-l-2 border-l-line ml-1 space-y-2.5 animate-rise">
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
