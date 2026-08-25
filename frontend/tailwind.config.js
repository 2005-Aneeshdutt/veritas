/** Design tokens. Components never hardcode a hex. */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep, slightly blue-black. Warmer than pure #000 so gold sits on it
        // without vibrating.
        void: "#05070C",
        bg: "#080B12",
        surface: "#0C1018",
        raised: "#121826",
        line: "#1B2333",
        edge: "#2A3548",

        gold: { DEFAULT: "#E5B94E", dim: "#A88536", glow: "#FFD97A" },
        mint: { DEFAULT: "#34D399", dim: "#1F7A5A" },
        rose: { DEFAULT: "#FB7185", dim: "#9F3A4B" },
        sky: { DEFAULT: "#60A5FA", dim: "#2E5C94" },
        amber: { DEFAULT: "#FBBF24", dim: "#996F14" },
        iris: { DEFAULT: "#A78BFA", dim: "#5F4CA0" },

        ink: "#F2F5FA",
        muted: "#9AA7BD",
        faint: "#5C6880",
      },
      fontFamily: {
        display: ["Space Grotesk", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.04em" }],
      },
      backgroundImage: {
        // Hatching reads instinctively as "inferred, not observed".
        hatch:
          "repeating-linear-gradient(45deg, rgba(251,191,36,0.10) 0 5px, transparent 5px 10px)",
        "gold-sheen":
          "linear-gradient(135deg, rgba(229,185,78,0.16), rgba(229,185,78,0.02) 55%)",
        "glass":
          "linear-gradient(160deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012))",
        "grid":
          "linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(229,185,78,0.28), 0 0 28px -6px rgba(229,185,78,0.35)",
        "glow-mint": "0 0 0 1px rgba(52,211,153,0.3), 0 0 24px -8px rgba(52,211,153,0.4)",
        "glow-rose": "0 0 0 1px rgba(251,113,133,0.3), 0 0 24px -8px rgba(251,113,133,0.4)",
        lift: "0 18px 40px -22px rgba(0,0,0,0.95)",
        inset: "inset 0 1px 0 0 rgba(255,255,255,0.05)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        sweep: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulseRing: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(229,185,78,0.45)" },
          "50%": { boxShadow: "0 0 0 7px rgba(229,185,78,0)" },
        },
        dash: { to: { strokeDashoffset: "-14" } },
        breathe: {
          "0%,100%": { opacity: "0.35" },
          "50%": { opacity: "0.75" },
        },
      },
      animation: {
        rise: "rise .5s cubic-bezier(.22,1,.36,1) both",
        sweep: "sweep 2.2s linear infinite",
        pulseRing: "pulseRing 1.8s ease-out infinite",
        dash: "dash .6s linear infinite",
        breathe: "breathe 3.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
