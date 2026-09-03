# VERITAS — Phase 1: Foundation & Application Shell

Frontend only. No backend is created, simulated, or connected. All data flows through an adapter seam so the real backend can be plugged in later.

## What gets built

### 1. Design system
- Dark-first theme with the specified palette (bg #070A0C, surface #0D1215, elevated #151B20, border #252D33, text #F5F7F6 / #8E9994) plus semantic claim colors: measured #35D39A, projected #D5A84A, denied #E06469, observed #6FA8FF.
- Matching light theme derived from the same hues, so contrast holds in both.
- Inter/Geist-style typography scale: large tabular financial numerals, compact uppercase metadata labels, restrained borders, 8–10px radius, minimal shadows.
- Theme switcher: Dark / Light / System, persisted, with no flash on load.

### 2. VERITAS brand mark
An original geometric shield/checkmark mark suggesting verification and authority — drawn as inline SVG (crisp at any size, themeable), used in the sidebar, login, and favicon context. No AI/brain imagery.

### 3. Financial intelligence background
A canvas-based ambient layer: faint grid, sparse connected nodes, thin transaction lines, occasional green pulses and small amber signals, subtle shield geometry. Two intensity levels — strong on Login, very subtle on Overview. Respects reduced-motion and never sits above readable content.

### 4. Application shell
- Sidebar grouped as Overview / RECOVER (Control Tower, Payments, Recovery Journey) / INVESTIGATE (Diagnosis, Counterfactual Lab) / PROVE (Evidence, Audit Trail, Prove) / Settings, collapsible to an icon rail.
- Topbar with breadcrumbs, search/command button, notification area, theme switcher, account menu.
- Command palette on Cmd/Ctrl+K for navigation and actions.
- Consistent page header component (title, description, actions).
- Mobile/tablet: sidebar becomes a slide-over drawer; financial hierarchy preserved.

### 5. Login screen
Dark, centered card over the strongest background variant: VERITAS wordmark, "Revenue Recovery Intelligence", "Revenue recovery, under authority.", and the authority secondary copy. Email/password form is presentation-only (no auth backend). No fake live statistics.

### 6. Claim state system
One reusable `ClaimBadge` covering VERIFIED, MEASURED, PROJECTED, OBSERVED, UNVERIFIED, ABSTAINED. Each carries text + distinct icon + semantic treatment + tooltip definition — never color alone. Sizes and inline variants so it can sit directly beside a financial value anywhere in the app.

### 7. Overview dashboard
- Four primary metrics with claim labels beside the value: At Risk ₹64.25L, Recoverable ₹5,56,225 (PROJECTED), Recovered ₹39,833 (MEASURED), Held ₹16,11,536.
- Projected vs measured are visually distinct (amber vs green treatment, different value styling); projected money is never called recovered.
- Sections: revenue-at-risk breakdown, recovery funnel, intervention mix, policy outcomes, recent governed actions, exception queue, audit/proof health. Operational and restrained — no chart overload.
- A visible "Demo data" indicator so nothing reads as live truth.

### 8. Placeholder pages
Control Tower, Payments, Recovery Journey, Diagnosis, Counterfactual Lab, Evidence, Audit Trail, Prove, Settings each get a real route with the shell, page header, and a short "coming in a later phase" state. No workflow logic.

## Technical section

- Routes under `src/routes/`: `login`, and an app layout wrapping the nine section routes plus Overview at `/`. Each route defines its own head() metadata.
- Domain models in `src/domain/` (Money, ClaimState, Metric, Payment, Action, Exception, ProofHealth) as pure types.
- Adapter seam in `src/data/`: an `Adapter` interface, `demoAdapter` (static typed fixtures), and a `backendAdapter` stub that reads `import.meta.env.VITE_API_BASE_URL`. A single `getAdapter()` selects by env. Components call typed service functions via TanStack Query — no fetch calls in components.
- `.env` gets `VITE_API_BASE_URL` as an empty/placeholder public var. No secrets.
- Tokens in `src/styles.css` via `@theme inline`; no hardcoded color utilities in components.
- Accessibility: semantic landmarks, one `<main>` in the app layout, visible focus rings, ARIA labels on icon-only buttons, keyboard-navigable sidebar and palette, text+icon on every claim state.

## Explicitly out of scope this phase
Policy Kernel, Recovery Journey workflow, Execution, Ledger, Evidence detail, Prove certificate, Counterfactual Lab — navigation placeholders only.
