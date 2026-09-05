# VERITAS Foundation

Build Phase 1 of VERITAS — Revenue Recovery Intelligence.

IMPORTANT:

This is a frontend-only project.

The backend is separate and frozen. Do not create, modify, replace, or simulate a backend.

We will connect the real backend later.

==================================================

PRODUCT

==================================================

Brand:

VERITAS

Subtitle:

Revenue Recovery Intelligence

Tagline:

“Recover what you can. Prove what happened.”

Core philosophy:

AI recommends.

Policy authorizes.

Execution acts.

Gateway confirms.

Ledger records.

Evidence supports.

VERITAS proves.

The main product flow will eventually be:

PAYMENT

→ AGENT INVESTIGATES

→ DIAGNOSIS

→ PLAN

→ POLICY KERNEL

→ EXECUTION

→ OUTCOME

→ LEDGER

→ EVIDENCE

→ PROVE

For this phase, build the FOUNDATION and APPLICATION SHELL only.

Do not build the detailed recovery workflow yet.

==================================================

VISUAL DIRECTION

==================================================

Create a premium enterprise fintech interface.

Inspiration:

- Linear

- Stripe

- Ramp

- Vercel

But create an original VERITAS identity.

Dark-first.

Dark mode is the default.

Support:

- Dark

- Light

- System

Persist theme selection.

Dark palette:

Background #070A0C

Surface #0D1215

Elevated #151B20

Border #252D33

Primary text #F5F7F6

Secondary text #8E9994

Measured/success #35D39A

Projected #D5A84A

Denied #E06469

Observed #6FA8FF

Typography should feel like Inter/Geist.

Use:

- strong large financial numbers

- compact metadata

- clean hierarchy

- restrained borders

- minimal shadows

- 8–10px radius

Avoid:

- purple gradients

- generic AI graphics

- excessive glassmorphism

- excessive neon

- giant rounded cards

- random particle effects

- crypto aesthetic

- robot/brain imagery

==================================================

FINANCIAL INTELLIGENCE BACKGROUND

==================================================

Create a subtle animated background.

Visual metaphor:

financial events moving through an authority network.

Use:

- faint grid

- subtle connected nodes

- thin transaction/data lines

- occasional green data pulses

- tiny amber signals

- subtle shield/proof geometry

95% product.

5% atmosphere.

Do not allow the background to interfere with readability.

Login can have the strongest version of this background.

Overview should use a much subtler version.

==================================================

BRANDING

==================================================

Create a minimal VERITAS logo/mark suggesting:

- verification

- authority

- shield

- proof

Do not use a generic AI brain/logo.

VERITAS should feel like financial infrastructure.

==================================================

APPLICATION SHELL

==================================================

Create a polished desktop-first application shell.

Sidebar:

VERITAS

Overview

RECOVER

  Control Tower

  Payments

  Recovery Journey

INVESTIGATE

  Diagnosis

  Counterfactual Lab

PROVE

  Evidence

  Audit Trail

  Prove

Settings

Add a command/search button.

Keyboard shortcut:

Cmd/Ctrl + K

Create:

- sidebar

- topbar

- page headers

- breadcrumbs where useful

- notification area

- search/command palette

- theme switcher

- responsive navigation

The navigation should communicate:

Recover

Investigate

Prove

==================================================

LOGIN

==================================================

Build a premium dark login screen.

Include:

VERITAS

Revenue Recovery Intelligence

“Revenue recovery, under authority.”

Secondary copy:

“AI can recommend an action.

VERITAS determines whether it can be authorized, executed, and proven.”

Use the financial-intelligence network background.

Do not show fake live financial statistics.

==================================================

OVERVIEW

==================================================

Create an executive-grade Overview dashboard.

Primary metrics:

AT RISK

₹64.25L

RECOVERABLE

₹5,56,225

PROJECTED

RECOVERED

₹39,833

MEASURED

HELD

₹16,11,536

IMPORTANT:

Projected and measured money must look clearly different.

Never label projected money as recovered.

Use claim labels directly beside financial values.

Create sections for:

- revenue-at-risk

- recovery funnel

- intervention mix

- policy outcomes

- recent governed actions

- exception queue

- audit/proof health

Keep the dashboard operational and clean.

Do not overfill it with charts.

==================================================

CLAIM STATES

==================================================

Create a reusable semantic status system now.

Supported states:

VERIFIED

MEASURED

PROJECTED

OBSERVED

UNVERIFIED

ABSTAINED

Every state must include:

- text

- icon

- semantic visual treatment

- tooltip

Never rely on color alone.

Definitions:

VERIFIED:

Evidence sufficiently verified.

MEASURED:

Actual result/recovery observed and recorded.

PROJECTED:

Expected or estimated future recovery.

OBSERVED:

Observed state/event without necessarily proving monetary recovery.

UNVERIFIED:

Action/result exists but recovery cannot be established.

ABSTAINED:

No recovery claim is made.

Make this component reusable across the entire application.

==================================================

DATA ARCHITECTURE

==================================================

Create typed frontend domain models.

Create an adapter abstraction:

demoAdapter

backendAdapter

Components should consume typed services/models.

Prepare:

VITE_API_BASE_URL

for future backend connection.

Do not scatter API calls across components.

For now use carefully controlled demo data only where required for the Overview.

Clearly label demo information where appropriate.

Never expose secrets.

==================================================

RESPONSIVENESS

==================================================

Desktop-first.

Also support:

- tablet

- mobile

Collapse navigation appropriately.

Preserve financial hierarchy.

==================================================

ACCESSIBILITY

==================================================

Implement:

- keyboard navigation

- visible focus states

- semantic HTML

- ARIA labels

- accessible contrast

- text + icon for important states

==================================================

PHASE 1 BOUNDARY

==================================================

DO NOT build the detailed:

- Policy Kernel

- Recovery Journey

- Execution workflow

- Ledger

- Evidence

- Prove certificate

- Counterfactual Lab

yet.

Only create placeholders/navigation for those pages if necessary.

Focus on making the foundation extremely polished.

Before finishing, make sure the entire shell feels like one coherent premium fintech product.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/bec9284e-04e5-4c1d-b172-551a60ff8594).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
