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
  title: "Account Expert",
  summary: "Give every account conversation a concise, current point of view.",
  primaryAction: "Build account brief",
  queueLabel: "Accounts recently viewed",
  metric: { value: "31", label: "with fresh context" },
  detailTitle: "Account brief",
  items: [
    {
      id: "acme-health",
      name: "Acme Health",
      meta: "Enterprise · Renewal in 64 days",
      status: "Brief current",
      score: "96",
      detail:
        "The security review is the next decision point; usage and procurement activity both support expansion.",
      tags: ["Renewal", "Expansion"],
    },
    {
      id: "northstar-labs",
      name: "Northstar Labs",
      meta: "Mid-market · 84 seats",
      status: "Brief needs update",
      score: "81",
      detail:
        "The champion changed roles and the account team has not yet confirmed the new operating owner.",
      tags: ["Champion", "Open question"],
    },
    {
      id: "fieldwire",
      name: "Fieldwire",
      meta: "Growth · 42 seats",
      status: "Brief current",
      score: "72",
      detail:
        "The active teams are approaching the next plan threshold and the pilot has a clear success signal.",
      tags: ["Usage", "Pilot"],
    },
    {
      id: "meridian-bio",
      name: "Meridian Bio",
      meta: "Growth · 28 seats",
      status: "Needs research",
      score: "54",
      detail:
        "The account has been quiet for 30 days; confirm whether the original workflow is still a priority.",
      tags: ["Low activity"],
    },
  ],
};
