import { useEffect, useMemo, useRef, useState } from "react";
import { formatCount, formatMoney } from "@/domain/money";
import type { Money } from "@/domain/types";
import { cn } from "@/lib/utils";

/**
 * The book, moving.
 *
 * Payments travel left to right through the stages the engine actually has,
 * and split at the policy kernel into the four decisions the ledger records.
 * Every count and every rupee here is passed in from the backend; the motion
 * carries real proportions — the number of particles routed down each branch
 * is that branch's real share, so the thin DENY stream and the fat awaiting
 * stream are thin and fat because the data says so.
 *
 * What this is NOT: a live feed of payments arriving. The book is a committed
 * batch, and the header says "committed batch" rather than "live" so nobody
 * reads the movement as traffic happening now. The animation is a way to see
 * a distribution, not a claim about the present tense.
 *
 * Canvas rather than DOM: a few hundred particles at 60fps would thrash the
 * layout engine as elements. Reduced motion drops the particles entirely and
 * leaves the diagram, which carries all the same numbers.
 */

export interface FlowBranch {
  key: string;
  label: string;
  count: number;
  amount?: Money;
  amountLabel?: string;
  tone: "measured" | "projected" | "denied" | "muted";
}

const TONE_HEX: Record<FlowBranch["tone"], string> = {
  measured: "#4ade80",
  projected: "#fbbf24",
  denied: "#f87171",
  muted: "#94a3b8",
};

interface Particle {
  t: number;
  speed: number;
  branch: number;
  lane: number;
}

export function RecoveryFlow({
  stages,
  branches,
  className,
}: {
  /** Sequential funnel stages, widest first. */
  stages: { key: string; label: string; count: number }[];
  /** How the kernel split them. Shares drive the particle routing. */
  branches: FlowBranch[];
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(
      typeof window !== "undefined" &&
        (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
    );
  }, []);

  // Routing weights are the real branch shares, so the picture cannot flatter
  // a branch that the ledger says is small.
  const weights = useMemo(() => {
    const total = branches.reduce((n, b) => n + Math.max(b.count, 0), 0) || 1;
    return branches.map((b) => Math.max(b.count, 0) / total);
  }, [branches]);

  useEffect(() => {
    if (reduced) return;
    const cv = canvas.current;
    const wrap = box.current;
    if (!cv || !wrap) return;

    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Pick a branch by real share, so routing is proportional, not round-robin.
    const pick = () => {
      let r = Math.random();
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i] ?? 0;
        if (r <= 0) return i;
      }
      return weights.length - 1;
    };

    const COUNT = 190;
    const parts: Particle[] = Array.from({ length: COUNT }, () => ({
      t: Math.random(),
      speed: 0.0016 + Math.random() * 0.0022,
      branch: pick(),
      lane: Math.random(),
    }));

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (w < 40) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const left = 10;
      const right = w - 10;
      const split = left + (right - left) * 0.55;
      const midY = h / 2;
      const n = branches.length || 1;
      // Branch lanes span most of the height so the split is unmistakable.
      const laneY = (i: number) => midY + ((i + 0.5) / n - 0.5) * (h * 0.82);

      // --- structure: stage columns and the fan, drawn faintly behind ------
      ctx.strokeStyle = "rgba(148,163,184,0.13)";
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(split, midY);
        ctx.bezierCurveTo(
          split + (right - split) * 0.45, midY,
          split + (right - split) * 0.55, laneY(i),
          right, laneY(i)
        );
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(left, midY);
      ctx.lineTo(split, midY);
      ctx.stroke();

      // stage tick columns along the trunk
      const cols = Math.max(stages.length, 1);
      ctx.fillStyle = "rgba(148,163,184,0.22)";
      for (let c = 0; c < cols; c++) {
        const x = left + ((split - left) * c) / Math.max(cols - 1, 1);
        for (let d = -3; d <= 3; d++) {
          ctx.beginPath();
          ctx.arc(x, midY + d * 9, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // --- the payments themselves ----------------------------------------
      for (const p of parts) {
        p.t += p.speed;
        if (p.t > 1) {
          p.t -= 1;
          p.branch = pick();
          p.lane = Math.random();
        }

        const target = laneY(p.branch);
        const spread = (p.lane - 0.5) * (h * 0.22);

        let x: number;
        let y: number;
        if (p.t < 0.55) {
          const k = p.t / 0.55;
          x = left + (split - left) * k;
          // wide at the failure end, tightening as the kernel takes it
          y = midY + spread * (1 - k * 0.8);
        } else {
          const k = (p.t - 0.55) / 0.45;
          const e = k * k * (3 - 2 * k);
          x = split + (right - split) * e;
          y = midY + (target - midY) * e;
        }

        const tone = branches[p.branch]?.tone ?? "muted";
        ctx.fillStyle = p.t < 0.55 ? "#94a3b8" : TONE_HEX[tone];
        ctx.globalAlpha = p.t < 0.55 ? 0.28 + (p.t / 0.55) * 0.34 : 0.9;
        ctx.beginPath();
        ctx.arc(x, y, p.t < 0.55 ? 1.2 : 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [branches, weights, reduced, stages]);

  return (
    <section
      aria-label="Payment recovery flow"
      className={cn("rounded-lg border border-hairline", className)}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
        <div>
          <h2 className="text-sm font-medium text-foreground">Payment recovery flow</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            How the committed batch moved through the kernel.
          </p>
        </div>
        <span className="label-meta text-[10px] tracking-[0.16em]">
          Committed batch · not live traffic
        </span>
      </header>

      <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
        {/* ------------------------------------------------ the moving part */}
        <div className="min-w-0">
          <div ref={box} className="relative h-[190px] w-full">
            <canvas
              ref={canvas}
              className="absolute inset-0"
              aria-hidden
              role="presentation"
            />
            {reduced && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-[12px] text-muted-foreground">
                  Motion reduced — the counts below carry the same information.
                </p>
              </div>
            )}
          </div>

          <ol className="mt-1 flex items-end justify-between gap-2">
            {stages.map((s) => (
              <li key={s.key} className="min-w-0">
                <p className="label-meta text-[9px] tracking-[0.14em]">{s.label}</p>
                <p className="numeral mt-0.5 text-sm tabular-nums text-foreground">
                  {formatCount(s.count)}
                </p>
              </li>
            ))}
          </ol>
        </div>

        {/* ---------------------------------------------------- the outcome */}
        <ul className="space-y-2">
          {branches.map((b) => (
            <li
              key={b.key}
              className="flex items-baseline justify-between gap-3 rounded-md border border-hairline px-3 py-2"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: TONE_HEX[b.tone] }}
                  aria-hidden
                />
                <span className="truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {b.label}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="numeral block text-[13px] tabular-nums text-foreground">
                  {formatCount(b.count)}
                </span>
                {(b.amount || b.amountLabel) && (
                  <span
                    className="numeral block text-[11px] tabular-nums"
                    style={{ color: TONE_HEX[b.tone] }}
                  >
                    {b.amountLabel ?? (b.amount ? formatMoney(b.amount) : "")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
