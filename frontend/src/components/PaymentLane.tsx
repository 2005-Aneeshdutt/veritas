"use client";

/**
 * What happens to each payment as it arrives.
 *
 * The brief asks for ingest → classify → detect → signal, and three of those
 * four are things this system genuinely does to every payment on the tape: it
 * reads it, it classifies the error code against the published taxonomy with
 * no model call, and it feeds the bank's running window to the detector. The
 * fourth only lights when the detector actually speaks.
 *
 * So the lane is drawn from the payment itself rather than from a timer. A
 * success stops at classify because there is no error code to sort; a failure
 * carries its class; and SIGNAL is dark unless this payment is the one whose
 * arrival pushed a bank's confidence interval across the published rate. That
 * last state is rare on purpose — a lane that lit up for every payment would
 * be telling you nothing.
 */

export interface LanePayment {
  txn_id: string;
  bank: string;
  method: string;
  amount_paise: number;
  succeeded: boolean;
  error_code: string | null;
  error_class: string | null;
}

const CLASS_TONE: Record<string, string> = {
  soft_decline: "text-amber",
  technical: "text-sky",
  hard_decline: "text-rose",
  unrecoverable: "text-rose",
};

export function PaymentLane({
  p,
  signalled,
}: {
  p: LanePayment;
  /** True only when this payment's arrival is what tripped the detector. */
  signalled?: boolean;
}) {
  const steps = [
    { k: "ingest", on: true, tone: "bg-sky" },
    { k: "classify", on: !p.succeeded, tone: "bg-iris" },
    { k: "detect", on: !p.succeeded, tone: "bg-brand" },
    { k: "signal", on: Boolean(signalled), tone: "bg-rose" },
  ];

  return (
    <div className="flex items-center gap-1" aria-hidden>
      {steps.map((s, i) => (
        <span key={s.k} className="flex items-center gap-1" title={s.k}>
          <span
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              s.on ? s.tone : "bg-line"
            } ${s.k === "signal" && s.on ? "animate-pulse-ring" : ""}`}
          />
          {i < steps.length - 1 && (
            <span
              className={`w-2 h-px ${steps[i + 1].on ? "bg-edge" : "bg-line"}`}
            />
          )}
        </span>
      ))}
    </div>
  );
}

/** The four stages named once, above the tape, so the dots mean something. */
export function LaneLegend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-faint">
      {[
        ["ingest", "bg-sky"],
        ["classify", "bg-iris"],
        ["detect", "bg-brand"],
        ["signal", "bg-rose"],
      ].map(([k, tone]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${tone}`} />
          {k}
        </span>
      ))}
    </div>
  );
}

/** The error class, when there is one, in the colour it carries elsewhere. */
export function ErrorClass({ cls }: { cls: string | null }) {
  if (!cls) return null;
  return (
    <span className={`chip ${CLASS_TONE[cls] ?? "text-muted"}`}>
      {cls.replace(/_/g, " ")}
    </span>
  );
}
