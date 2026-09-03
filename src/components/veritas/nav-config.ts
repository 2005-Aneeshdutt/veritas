import {
  Activity,
  CreditCard,
  FileCheck2,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Route as RouteIcon,
  ScrollText,
  Settings,
  ShieldCheck,
  Stethoscope,
  Target,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AppRoute =
  | "/"
  | "/control-tower"
  | "/payments"
  | "/payment/$paymentId"
  | "/recovery-journey"
  | "/policy"
  | "/outcome"
  | "/diagnosis"
  | "/plan"
  | "/counterfactual-lab"
  | "/evidence"
  | "/audit-trail"
  | "/prove"
  | "/settings";

export interface NavItem {
  label: string;
  to: AppRoute;
  icon: LucideIcon;
  description: string;
}

export interface NavGroup {
  /** Undefined for ungrouped top-level items. */
  title?: string;
  caption?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      {
        label: "Overview",
        to: "/",
        icon: LayoutDashboard,
        description: "Executive view of revenue at risk, recovery and proof health",
      },
    ],
  },
  {
    title: "Recover",
    caption: "Act under authority",
    items: [
      {
        label: "Control Tower",
        to: "/control-tower",
        icon: Gauge,
        description: "Live operating view of governed recovery",
      },
      {
        label: "Payments",
        to: "/payments",
        icon: CreditCard,
        description: "Failing, disputed and stalled payments",
      },
      {
        label: "Recovery Journey",
        to: "/recovery-journey",
        icon: RouteIcon,
        description: "Payment to outcome, step by step",
      },
      {
        label: "Policy Kernel",
        to: "/policy",
        icon: ShieldCheck,
        description: "Deterministic authorization for recovery actions",
      },
    ],
  },
  {
    title: "Investigate",
    caption: "Understand the cause",
    items: [
      {
        label: "Diagnosis",
        to: "/diagnosis",
        icon: Stethoscope,
        description: "Why a payment failed and what could change it",
      },
      {
        label: "Counterfactual Lab",
        to: "/counterfactual-lab",
        icon: FlaskConical,
        description: "What would have happened otherwise",
      },
    ],
  },
  {
    title: "Prove",
    caption: "Stand behind the number",
    items: [
      {
        label: "Outcome",
        to: "/outcome",
        icon: Target,
        description: "What actually happened after execution",
      },
      {
        label: "Evidence",
        to: "/evidence",
        icon: FileCheck2,
        description: "Artifacts supporting every claim",
      },
      {
        label: "Audit Ledger",
        to: "/audit-trail",
        icon: ScrollText,
        description: "Append-only governance record with chain integrity",
      },
      {
        label: "Prove",
        to: "/prove",
        icon: Activity,
        description: "Attestations and recovery certificates",
      },
    ],
  },
  {
    items: [
      {
        label: "Settings",
        to: "/settings",
        icon: Settings,
        description: "Workspace, theme and connection settings",
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function navItemFor(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => i.to === pathname);
}

export function groupTitleFor(pathname: string): string | undefined {
  return NAV_GROUPS.find((g) => g.items.some((i) => i.to === pathname))?.title;
}
