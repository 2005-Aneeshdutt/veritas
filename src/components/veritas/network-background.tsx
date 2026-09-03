import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Intensity = "strong" | "subtle";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  authority: boolean;
}

interface Pulse {
  from: number;
  to: number;
  t: number;
  speed: number;
  tone: "measured" | "projected";
}

/**
 * Financial events moving through an authority network.
 * Faint grid, sparse nodes, thin transaction lines, occasional pulses.
 * Purely atmospheric — always behind content, disabled for reduced motion.
 */
export function NetworkBackground({
  intensity = "subtle",
  className,
}: {
  intensity?: Intensity;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const strong = intensity === "strong";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const styles = getComputedStyle(document.documentElement);
    const measured = styles.getPropertyValue("--measured").trim() || "oklch(0.77 0.15 164)";
    const projected = styles.getPropertyValue("--projected").trim() || "oklch(0.75 0.12 83)";
    const line = styles.getPropertyValue("--hairline").trim() || "oklch(0.29 0.02 240)";

    let width = 0;
    let height = 0;
    let raf = 0;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];

    const nodeCount = () => {
      const base = Math.round((window.innerWidth * window.innerHeight) / (strong ? 26000 : 46000));
      return Math.max(14, Math.min(strong ? 68 : 34, base));
    };

    const init = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nodes = Array.from({ length: nodeCount() }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        authority: i % 7 === 0,
      }));
      pulses = [];
    };

    const grid = () => {
      const step = 48;
      ctx.strokeStyle = line;
      ctx.globalAlpha = strong ? 0.55 : 0.18;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= width; x += step) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
      }
      for (let y = 0; y <= height; y += step) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const shields = () => {
      // Subtle shield/proof geometry anchored to the canvas corners.
      const draw = (cx: number, cy: number, r: number) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.78, cy - r * 0.55);
        ctx.lineTo(cx + r * 0.78, cy + r * 0.22);
        ctx.quadraticCurveTo(cx + r * 0.7, cy + r * 0.85, cx, cy + r);
        ctx.quadraticCurveTo(cx - r * 0.7, cy + r * 0.85, cx - r * 0.78, cy + r * 0.22);
        ctx.lineTo(cx - r * 0.78, cy - r * 0.55);
        ctx.closePath();
        ctx.stroke();
      };
      ctx.strokeStyle = measured;
      ctx.globalAlpha = strong ? 0.14 : 0.04;
      ctx.lineWidth = 1.2;
      draw(width * 0.18, height * 0.32, Math.min(width, height) * 0.22);
      draw(width * 0.84, height * 0.72, Math.min(width, height) * 0.16);
      ctx.globalAlpha = 1;
    };

    const maxDist = strong ? 190 : 165;

    const frame = () => {
      ctx.clearRect(0, 0, width, height);
      grid();
      shields();

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > width) n.vx *= -1;
        if (n.y < 0 || n.y > height) n.vy *= -1;
      }

      // transaction lines
      ctx.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i]!.x - nodes[j]!.x;
          const dy = nodes[i]!.y - nodes[j]!.y;
          const d = Math.hypot(dx, dy);
          if (d > maxDist) continue;
          ctx.strokeStyle = line;
          ctx.globalAlpha = (1 - d / maxDist) * (strong ? 0.85 : 0.3);
          ctx.beginPath();
          ctx.moveTo(nodes[i]!.x, nodes[i]!.y);
          ctx.lineTo(nodes[j]!.x, nodes[j]!.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // nodes
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.authority ? 2.1 : 1.3, 0, Math.PI * 2);
        ctx.fillStyle = n.authority ? measured : line;
        ctx.globalAlpha = n.authority ? (strong ? 0.9 : 0.36) : strong ? 0.85 : 0.45;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // spawn pulses
      if (!reduce && nodes.length > 2 && Math.random() < (strong ? 0.035 : 0.014)) {
        const from = Math.floor(Math.random() * nodes.length);
        let to = Math.floor(Math.random() * nodes.length);
        if (to === from) to = (to + 1) % nodes.length;
        pulses.push({
          from,
          to,
          t: 0,
          speed: 0.004 + Math.random() * 0.005,
          tone: Math.random() < 0.75 ? "measured" : "projected",
        });
      }

      pulses = pulses.filter((p) => p.t <= 1);
      for (const p of pulses) {
        p.t += p.speed;
        const a = nodes[p.from];
        const b = nodes[p.to];
        if (!a || !b) continue;
        const x = a.x + (b.x - a.x) * p.t;
        const y = a.y + (b.y - a.y) * p.t;
        const fade = Math.sin(p.t * Math.PI);
        const color = p.tone === "measured" ? measured : projected;
        const r = p.tone === "measured" ? 2.6 : 1.8;
        ctx.globalAlpha = fade * (strong ? 0.85 : 0.5);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = fade * (strong ? 0.22 : 0.12);
        ctx.beginPath();
        ctx.arc(x, y, r * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    };

    init();
    if (reduce) {
      ctx.clearRect(0, 0, width, height);
      grid();
      shields();
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => {
      init();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [intensity]);

  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <canvas ref={ref} className="h-full w-full" />
      <div
        className={cn(
          "absolute inset-0",
          intensity === "strong"
            ? "bg-[radial-gradient(circle_at_50%_45%,color-mix(in_oklab,var(--background)_88%,transparent)_0%,color-mix(in_oklab,var(--background)_55%,transparent)_38%,color-mix(in_oklab,var(--background)_92%,transparent)_100%)]"
            : "bg-gradient-to-b from-transparent via-background/60 to-background",
        )}
      />
    </div>
  );
}
