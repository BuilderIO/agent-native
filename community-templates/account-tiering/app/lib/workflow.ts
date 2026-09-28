export interface WorkflowItem {
  id: string;
  name: string;
  meta: string;
  status: string;
  score: string;
  detail: string;
  tags: string[];
}

export interface WorkflowDefinition {
  title: string;
  summary: string;
  primaryAction: string;
  queueLabel: string;
  metric: { value: string; label: string };
  detailTitle: string;
  items: WorkflowItem[];
}

export interface WorkflowSnapshot {
  workflow: WorkflowDefinition;
  selectedId: string;
}

export const workflow: WorkflowDefinition = {
  title: "Account Tiering",
  summary: "Keep account priority aligned with the signals that matter now.",
  primaryAction: "Review priorities",
  queueLabel: "Accounts in scope",
  metric: { value: "24", label: "accounts" },
  detailTitle: "Account context",
  items: [
    {
      id: "acme-health",
      name: "Acme Health",
      meta: "Enterprise · 1,240 seats",
      status: "Expansion ready",
      score: "96",
      detail:
        "Usage is up 34% and the procurement contact opened the security pack twice.",
      tags: ["Expansion", "Product signal"],
    },
    {
      id: "northstar-labs",
      name: "Northstar Labs",
      meta: "Mid-market · 84 seats",
      status: "Review tier",
      score: "81",
      detail:
        "The champion changed roles. Keep the account high-touch until the new owner is confirmed.",
      tags: ["Champion change", "Renewal"],
    },
    {
      id: "fieldwire",
      name: "Fieldwire",
      meta: "Growth · 42 seats",
      status: "Review tier",
      score: "72",
      detail:
        "Three active teams are approaching the usage threshold for the next plan.",
      tags: ["Usage", "Plan fit"],
    },
    {
      id: "meridian-bio",
      name: "Meridian Bio",
      meta: "Growth · 28 seats",
      status: "Nurture",
      score: "54",
      detail: "Low activity and no open opportunity in the last 30 days.",
      tags: ["Low activity"],
    },
  ],
};
