/**
 * Every colour resolves through a CSS variable, so light and dark are the same
 * class names with a different variable set. Pages never branch on theme.
 */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

module.exports = {
  darkMode: ["selector", ":root:not(.light)"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("--canvas"),
        subtle: v("--subtle"),
        surface: v("--surface"),
        raised: v("--raised"),
        line: v("--line"),
        edge: v("--edge"),

        brand: { DEFAULT: v("--brand"), soft: v("--brand-soft"), ink: v("--brand-ink") },
        mint: { DEFAULT: v("--mint"), soft: v("--mint-soft") },
        rose: { DEFAULT: v("--rose"), soft: v("--rose-soft") },
        sky: { DEFAULT: v("--sky"), soft: v("--sky-soft") },
        amber: { DEFAULT: v("--amber"), soft: v("--amber-soft") },
        iris: { DEFAULT: v("--iris"), soft: v("--iris-soft") },

        ink: v("--ink"),
        muted: v("--muted"),
        faint: v("--faint"),
      },
      fontFamily: {
        display: ["Inter", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      /**
       * One scale, two spellings.
       *
       * The app had grown two type systems side by side: 158 arbitrary
       * `text-[11px]` and friends, and 141 `text-sm` / 88 `text-xs` from
       * Tailwind's defaults, which resolve to different values. Anything
       * visually equivalent was therefore a coin flip between 12px and 13px.
       *
       * Rewriting five hundred call sites would have been a redesign. Instead
       * the named sizes are redefined onto the px values the arbitrary ones
       * already use, so `text-xs` IS `text-[11px]` and `text-sm` IS
       * `text-[13px]`. Both spellings now land on the same scale.
       */
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
        xs: ["11px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "20px" }],
        base: ["15px", { lineHeight: "23px" }],
        lg: ["20px", { lineHeight: "26px" }],
        xl: ["24px", { lineHeight: "30px" }],
        "2xl": ["32px", { lineHeight: "36px" }],
        "3xl": ["38px", { lineHeight: "42px" }],
      },
      letterSpacing: {
        tightest: "-0.035em",
      },
      backgroundImage: {
        // Stripe's signature: a soft spectral sweep behind the hero.
        spectrum:
          "linear-gradient(101deg, rgb(var(--grad-a)) 0%, rgb(var(--grad-b)) 45%, rgb(var(--grad-c)) 100%)",
        // Hatching still reads as "inferred, not observed".
        hatch:
          "repeating-linear-gradient(45deg, rgb(var(--amber) / 0.10) 0 5px, transparent 5px 10px)",
        grid:
          "linear-gradient(rgb(var(--line) / 0.55) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--line) / 0.55) 1px, transparent 1px)",
      },
      boxShadow: {
        // Stripe leans on layered, very soft shadows rather than borders.
        xs: "0 1px 1px 0 rgb(var(--shadow) / 0.04), 0 0 0 1px rgb(var(--shadow) / 0.04)",
        card: "0 2px 5px -1px rgb(var(--shadow) / 0.08), 0 1px 3px -1px rgb(var(--shadow) / 0.06)",
        lift: "0 12px 28px -12px rgb(var(--shadow) / 0.22), 0 4px 10px -4px rgb(var(--shadow) / 0.10)",
        ring: "0 0 0 3px rgb(var(--brand) / 0.18)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        sweep: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulseRing: {
          "0%,100%": { boxShadow: "0 0 0 0 rgb(var(--brand) / 0.35)" },
          "50%": { boxShadow: "0 0 0 6px rgb(var(--brand) / 0)" },
        },
        breathe: { "0%,100%": { opacity: "0.4" }, "50%": { opacity: "1" } },
      },
      animation: {
        rise: "rise .45s cubic-bezier(.22,1,.36,1) both",
        sweep: "sweep 2s linear infinite",
        pulseRing: "pulseRing 1.8s ease-out infinite",
        breathe: "breathe 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
