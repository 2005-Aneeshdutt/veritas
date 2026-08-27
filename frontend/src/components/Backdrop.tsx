"use client";

import { useEffect, useRef } from "react";

/**
 * A slow field of drifting points behind the app.
 *
 * Deliberately quiet: it sits at low opacity behind everything, moves at a
 * speed you notice only if you look for it, and never crosses into the
 * content. A background that competes with a number on screen is a background
 * that made the page worse.
 *
 * Three things it does not do, on purpose:
 *
 *   * it does not run when the tab is hidden, because burning a laptop
 *     battery to animate something nobody is looking at is rude
 *   * it does not run at all under prefers-reduced-motion; that setting is a
 *     medical accommodation, not a preference to weigh against a visual
 *   * it reads its colour from the theme's own CSS variable, so it follows
 *     light and dark rather than carrying a second palette that drifts out of
 *     step with the first
 */
export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let running = true;

    // Density scales with area so a laptop and a monitor look the same rather
    // than the big screen looking empty.
    type P = { x: number; y: number; vx: number; vy: number; r: number };
    let points: P[] = [];

    function ink() {
      // The theme's own token. Read live so a theme toggle is picked up
      // without re-seeding the field.
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue("--brand")
        .trim();
      return v || "99 91 255";
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const target = Math.min(70, Math.round((w * h) / 26000));
      points = Array.from({ length: target }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.14,
        vy: (Math.random() - 0.5) * 0.14,
        r: 0.8 + Math.random() * 1.6,
      }));
    }

    function frame() {
      if (!running) return;
      ctx!.clearRect(0, 0, w, h);
      const rgb = ink();

      for (const p of points) {
        p.x += p.vx;
        p.y += p.vy;
        // Wrap rather than bounce: a bounce makes the edges visible as walls.
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;
      }

      // Links first, so points sit on top of the threads they belong to.
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const a = points[i];
          const b = points[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > 24000) continue;
          const alpha = (1 - d2 / 24000) * 0.16;
          ctx!.strokeStyle = `rgb(${rgb} / ${alpha})`;
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(b.x, b.y);
          ctx!.stroke();
        }
      }

      for (const p of points) {
        ctx!.fillStyle = `rgb(${rgb} / 0.28)`;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }

      raf = requestAnimationFrame(frame);
    }

    function onVisibility() {
      const hidden = document.hidden;
      if (hidden && running) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!hidden && !running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    }

    resize();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 opacity-[0.55]"
    />
  );
}
