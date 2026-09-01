"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Detail,
  Empty,
  Eyebrow,
  Loading,
  Notes,
  PageHead,
  Panel,
  Stagger,
} from "@/components/ui";
import { inr } from "@/lib/types";

interface Candidate {
  txn_id: string;
  amount_paise: number;
  action_type: string;
  outcome: string;
  gate_reason: string;
}

interface Beat {
  key: string;
  at: string | null;
  title: string;
  detail: string;
  tone: string;
  facts: { k: string; v: string }[];
}

interface Check {
  n: number;
  key: string;
  label: string;
  compared: string;
  status: "pass" | "stopped" | "not_reached";
}

interface Journey {
  txn_id: string;
  merchant_name: string;
  amount_paise: number;
  bank: string;
  method: string;
  hour: number | null;
  error_code: string | null;
  error_class: string | null;
  code_explanation: string;
  code_next_steps: string;
  fault_owner: string;
  fault_label: string;
  beats: Beat[];
  final_outcome: string;
  final_reason: string;
  recovered_paise: number;
  would_have_converted: boolean | null;
  truth_note: string;
  checks: Check[];
  raw_entry: Record<string, any>;
  hash_preimage: string;
  mandate: Record<string, any>;
}

const OUTCOME_WORD: Record<string, string> = {
  executed: "the agent acted",
  merchant_action: "waiting on a person",
  escalated: "flagged for a human",
  denied: "the kernel refused",
  exception: "could not be acted on",
};

/**
 * One payment, stage by stage.
 *
 * The shape is borrowed from the hop-by-hop views payment tooling likes: a
 * rail of stages, one lit at a time, with a telemetry panel underneath. The
 * content deliberately is not. Those views show per-hop issuer latency, ISO
 * response codes and raw acquirer payloads, and this system is not the rail —
 * it never sees any of that. Rendering `1850ms` at an acquiring switch we
 * never observed would be the one invented number in a product whose whole
 * argument is that every figure traces to a file.
 *
 * So the stages here are DECISION hops, and every field is real: the mandate's
 * actual limits against this payment's actual amount, the reason code that
 * stopped it, the entry that was written, and — instead of a fabricated curl —
 * the exact bytes SHA-256 was taken over, so a reader can recompute the hash
 * rather than believe it.
 *
 * It advances one stage at a time on a timer, because the thing worth watching
 * is a rule refusing something, and twelve rules resolving instantly is not
 * something anyone can watch.
 */
export default function JourneyPage({ params }: { params: { runId: string } }) {
  const [list, setList] = useState<Candidate[] | null>(null);
  const [txn, setTxn] = useState<string | null>(null);
  const [j, setJ] = useState<Journey | null>(null);
  const [filter, setFilter] = useState<string>("all");

  // How far through the reveal we are, and how fast it runs.
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState<"fields" | "entry" | "verify">("fields");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    fetch(`/api/run/${params.runId}/journeys?limit=200`)
      .then((r) => r.json())
      .then((d) => {
        setList(d.payments);
        const deep = new URLSearchParams(window.location.search).get("txn");
        setTxn(deep ?? d.payments?.[0]?.txn_id ?? null);
      })
      .catch(() => setList([]));
  }, [params.runId]);

  const load = useCallback(
    (id: string) => {
      setJ(null);
      setAt(0);
      setPlaying(true);
      fetch(`/api/run/${params.runId}/journey/${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setJ)
        .catch(() => setJ(null));
    },
    [params.runId]
  );

  useEffect(() => {
    if (txn) load(txn);
  }, [txn, load]);

  // The stages: the beats, with the kernel's checks spliced in as their own
  // stages so a refusal is watched happening rather than reported afterwards.
  const stages = j
    ? [
        ...j.beats
          .filter((b) => !b.key.startsWith("gated_"))
          .map((b) => ({ kind: "beat" as const, beat: b })),
      ]
    : [];
  const gateAt = j
    ? Math.max(0, j.beats.filter((b) => b.key.startsWith("proposed_")).length)
    : 0;
  const full = j
    ? [
        ...stages.slice(0, gateAt + 1),
        ...j.checks.map((c) => ({ kind: "check" as const, check: c })),
        ...stages.slice(gateAt + 1),
      ]
    : [];

  useEffect(() => {
    clearTimeout(timer.current);
    if (!playing || !j || at >= full.length) return;
    const cur = full[at];
    // A check that stopped something is worth a beat longer than one that
    // waved a payment through.
    const base = cur?.kind === "check" ? 320 : 700;
    const extra = cur?.kind === "check" && cur.check.status === "stopped" ? 900 : 0;
    timer.current = setTimeout(() => setAt((n) => n + 1), (base + extra) / speed);
    return () => clearTimeout(timer.current);
  }, [at, playing, j, full.length, speed]);

  if (!list) return <Loading label="finding payments worth opening" />;
  if (list.length === 0)
    return <Empty label="no payments were decided in this run" />;

  const outcomes = Array.from(new Set(list.map((c) => c.outcome)));
  const shown = filter === "all" ? list : list.filter((c) => c.outcome === filter);
  const done = at >= full.length;

  return (
    <div className="space-y-6">
      <Stagger>
        <PageHead
          title="One payment, end to end"
          sub="Every other view here adds payments up. This one follows a single payment from the moment it failed to whatever finally happened to it — through each rule that weighed it, on the numbers it was actually weighed against."
          right={
            j && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    if (done) {
                      setAt(0);
                      setPlaying(true);
                    } else setPlaying(!playing);
                  }}
                  className="btn-secondary h-8 text-[12px]"
                >
                  {done ? "↺ Replay" : playing ? "❚❚ Pause" : "▶ Play"}
                </button>
                <button
                  onClick={() => {
                    setPlaying(false);
                    setAt((n) => Math.min(full.length, n + 1));
                  }}
                  className="btn-quiet h-8 text-[12px]"
                  title="One stage at a time"
                >
                  ▷❙ Step
                </button>
                <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-raised border border-line">
                  {[0.5, 1, 2, 4].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSpeed(s)}
                      className={`px-1.5 py-0.5 rounded text-[11px] num transition-colors ${
                        speed === s ? "bg-surface text-ink" : "text-muted hover:text-ink"
                      }`}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
            )
          }
        />
      </Stagger>

      <div className="grid lg:grid-cols-[17rem_1fr] gap-6 items-start">
        {/* ── the picker ── */}
        <Stagger i={1}>
          <div className="lg:sticky lg:top-4">
            <div className="flex flex-wrap gap-1">
              <Pill on={filter === "all"} onClick={() => setFilter("all")}>
                all {list.length}
              </Pill>
              {outcomes.map((o) => (
                <Pill key={o} on={filter === o} onClick={() => setFilter(o)}>
                  {o.replace("_", " ")}
                </Pill>
              ))}
            </div>
            <p className="text-[11px] text-faint mt-2 leading-tight">
              Refused first, then held, then acted on — a list that opened on
              forty successes would read as a log.
            </p>

            <div className="mt-3 max-h-[26rem] overflow-y-auto -mx-2">
              {shown.map((c) => (
                <button
                  key={c.txn_id}
                  onClick={() => setTxn(c.txn_id)}
                  className={`w-full text-left px-2 py-2 rounded transition-colors ${
                    txn === c.txn_id ? "bg-raised" : "hover:bg-raised/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-1 h-1 rounded-full shrink-0 ${
                        c.outcome === "denied"
                          ? "bg-rose"
                          : c.outcome === "executed"
                          ? "bg-mint"
                          : "bg-amber"
                      }`}
                    />
                    <span className="num text-[11px] flex-1 truncate">{c.txn_id}</span>
                    <span className="num text-[11px] shrink-0">
                      {inr(c.amount_paise)}
                    </span>
                  </div>
                  <div className="text-[10px] text-faint truncate pl-3">
                    {c.action_type?.replace(/_/g, " ")}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Stagger>

        {/* ── the file ── */}
        <Stagger i={2}>
          {!j ? (
            <Loading label="opening the file" />
          ) : (
            <div className="space-y-6">
              {/* the header */}
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="num">{j.txn_id}</h2>
                <span className="text-[13px] text-muted">
                  {inr(j.amount_paise)} · {j.bank} · {j.method.replace(/_/g, " ")}
                  {j.hour != null && ` · ${String(j.hour).padStart(2, "0")}:00`}
                </span>
                <span
                  className={`ml-auto text-[12px] ${
                    j.final_outcome === "denied"
                      ? "text-rose"
                      : j.final_outcome === "executed"
                      ? "text-mint"
                      : "text-amber"
                  }`}
                >
                  {OUTCOME_WORD[j.final_outcome] ?? j.final_outcome}
                </span>
              </div>

              {/* ── the rail ── */}
              <Rail full={full} at={at} />

              {/* ── the stages, revealed ── */}
              <div className="space-y-2.5">
                {full.slice(0, at).map((st, i) =>
                  st.kind === "beat" ? (
                    <BeatRow key={`b${i}`} b={st.beat} />
                  ) : (
                    <CheckRow key={`c${i}`} c={st.check} />
                  )
                )}
                {!done && (
                  <div className="text-[12px] text-faint animate-breathe pl-6">
                    {full[at]?.kind === "check"
                      ? `checking rule ${full[at].check.n} of ${j.checks.length}…`
                      : "…"}
                  </div>
                )}
              </div>

              {/* ── the telemetry panel ── */}
              {done && (
                <div className="border-t border-line pt-4 animate-rise">
                  <div className="flex items-center gap-1 mb-3">
                    {(
                      [
                        ["fields", "Fields"],
                        ["entry", "Ledger entry"],
                        ["verify", "Verify the hash"],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => setTab(k)}
                        className={`px-2.5 py-1 rounded text-[12px] transition-colors ${
                          tab === k
                            ? "bg-raised text-ink"
                            : "text-muted hover:text-ink"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      onClick={() =>
                        navigator.clipboard?.writeText(
                          tab === "verify"
                            ? j.hash_preimage
                            : JSON.stringify(
                                tab === "entry" ? j.raw_entry : j.mandate,
                                null,
                                2
                              )
                        )
                      }
                      className="ml-auto text-[11px] text-muted hover:text-ink"
                    >
                      copy
                    </button>
                  </div>

                  {tab === "fields" && <Fields j={j} />}

                  {tab === "entry" && (
                    <pre className="panel p-3 text-[11px] num overflow-x-auto max-h-96">
                      {JSON.stringify(j.raw_entry, null, 2)}
                    </pre>
                  )}

                  {tab === "verify" && (
                    <div className="space-y-2">
                      <p className="text-[12px] text-muted leading-relaxed">
                        These are the exact bytes SHA-256 was taken over — the
                        entry minus its own hash, canonically encoded, which is
                        the one field a hash cannot commit to. Run{" "}
                        <span className="num">sha256</span> over them and you
                        get the entry_hash below. Nothing here asks you to
                        believe the verification; it hands you the input.
                      </p>
                      <pre className="panel p-3 text-[10px] num overflow-x-auto max-h-56 whitespace-pre-wrap break-all">
                        {j.hash_preimage}
                      </pre>
                      <div className="num text-[11px]">
                        <span className="text-faint">entry_hash </span>
                        <span className="text-brand break-all">
                          {j.raw_entry?.entry_hash}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Stagger>
      </div>

      <Notes>
        <Detail summary="why there are no per-hop latencies here">
          <p>
            Tooling that draws a payment as eight network hops with a
            millisecond figure on each one is sitting on the rail and reading
            its telemetry. This system is not the rail — it receives a month of
            payment outcomes, so it never observes an acquiring switch, an MPIN
            verification or an issuer&rsquo;s response time. Rendering a number
            at each of those would be the one invented figure in a product
            whose entire argument is that every figure traces to a file, so the
            stages here are the decisions this system actually took, on the
            values it actually weighed.
          </p>
        </Detail>
        <Detail summary="what this page is reading">
          <p>
            Nothing is recomputed. Every stage is read off the run record — the
            transaction as it arrived, Razorpay&rsquo;s published wording for
            its error code, the action the agent proposed with its own reason
            text, and the ledger entry the kernel wrote. The rule sequence is
            derived from the mandate&rsquo;s real limits and stopped at
            whichever rule the stored reason code says stopped it, so the
            recorded outcome stays authoritative and this only explains which
            rule produced it.
          </p>
        </Detail>
      </Notes>
    </div>
  );
}

/** The stages as a rail, filling left to right. */
function Rail({ full, at }: { full: any[]; at: number }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
      {full.map((st, i) => {
        const on = i < at;
        const cur = i === at - 1;
        const stopped = st.kind === "check" && st.check.status === "stopped";
        const bad = st.kind === "beat" && st.beat.tone === "bad";
        const good = st.kind === "beat" && st.beat.tone === "good";
        return (
          <div key={i} className="flex items-center gap-1 shrink-0">
            <span
              title={st.kind === "check" ? st.check.label : st.beat.title}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                cur ? "w-8" : st.kind === "check" ? "w-4" : "w-6"
              } ${
                !on
                  ? "bg-line"
                  : stopped || bad
                  ? "bg-rose"
                  : good
                  ? "bg-mint"
                  : st.kind === "check"
                  ? "bg-brand/50"
                  : "bg-brand"
              }`}
            />
          </div>
        );
      })}
      <span className="text-[10px] text-faint num ml-2 shrink-0">
        {Math.min(at, full.length)}/{full.length}
      </span>
    </div>
  );
}

function BeatRow({ b }: { b: Beat }) {
  const dot =
    b.tone === "good"
      ? "bg-mint"
      : b.tone === "bad"
      ? "bg-rose"
      : b.tone === "held"
      ? "bg-amber"
      : "bg-line";
  return (
    <div className="relative pl-6 animate-rise">
      <span className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full ${dot}`} />
      <div className="text-[13px] font-medium">{b.title}</div>
      {b.detail && (
        <p className="text-[12px] text-muted mt-0.5 leading-relaxed max-w-3xl">
          {b.detail}
        </p>
      )}
      {b.facts?.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1.5">
          {b.facts.map((f) => (
            <span key={f.k} className="text-[11px]">
              <span className="text-faint">{f.k} </span>
              <span className="num">{f.v}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One rule, and the two values it actually weighed. */
function CheckRow({ c }: { c: Check }) {
  const stopped = c.status === "stopped";
  return (
    <div
      className={`relative pl-6 py-0.5 animate-rise ${
        stopped ? "text-ink" : "text-muted"
      }`}
    >
      <span
        className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full grid place-items-center
                    text-[7px] font-bold ${
                      stopped ? "bg-rose text-white" : "bg-mint/30 text-mint"
                    }`}
      >
        {stopped ? "!" : "✓"}
      </span>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="num text-[10px] text-faint">{c.n}</span>
        <span className="text-[12px]">{c.label}</span>
        {stopped && <span className="chip-warn">stopped here</span>}
      </div>
      <div
        className={`text-[11px] num mt-0.5 ${stopped ? "text-rose" : "text-faint"}`}
      >
        {c.compared}
      </div>
    </div>
  );
}

function Fields({ j }: { j: Journey }) {
  const rows: [string, string][] = [
    ["payment", j.txn_id],
    ["amount", inr(j.amount_paise)],
    ["bank", j.bank],
    ["method", j.method],
    ["hour of day", j.hour != null ? `${String(j.hour).padStart(2, "0")}:00` : "—"],
    ["error code", j.error_code ?? "—"],
    ["error class", j.error_class ?? "unclassified"],
    ["whose move", j.fault_label],
    ["outcome", j.final_outcome],
    ["reason code", j.final_reason],
    ["recovered", j.recovered_paise ? inr(j.recovered_paise) : "nothing"],
    ["acted by", j.raw_entry?.actor ?? "agent"],
    ["ledger entry", `#${j.raw_entry?.sequence ?? "—"}`],
  ];
  return (
    <div className="grid sm:grid-cols-2 gap-x-8">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex items-baseline gap-3 py-1.5 border-b border-line/60"
        >
          <span className="text-[11px] text-faint w-28 shrink-0">{k}</span>
          <span className="num text-[12px] break-all">{v}</span>
        </div>
      ))}
      {j.code_next_steps && (
        <div className="sm:col-span-2 pt-3">
          <Eyebrow>Razorpay&rsquo;s own instruction for this code</Eyebrow>
          <p className="text-[12px] text-muted mt-1 leading-relaxed">
            {j.code_next_steps}
          </p>
        </div>
      )}
      {j.would_have_converted !== null && (
        <div className="sm:col-span-2 pt-3">
          <Panel tone={j.would_have_converted ? "good" : "note"}>
            <div className="text-[13px] font-medium">
              {j.would_have_converted
                ? "It would have converted on retry"
                : "It would not have converted, whatever we did"}
            </div>
            <p className="text-[12px] text-muted mt-1 leading-relaxed">
              {j.truth_note}
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Pill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
        on ? "bg-raised text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
