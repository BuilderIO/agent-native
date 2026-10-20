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
  title: "Demo Clip Library",
  summary:
    "Find the short customer moments worth reusing in the next conversation.",
  primaryAction: "Find a clip",
  queueLabel: "Recent clips",
  metric: { value: "48", label: "clips" },
  detailTitle: "Clip context",
  items: [
    {
      id: "clip-security",
      name: "Security review without the handoff tax",
      meta: "Acme Health · 02:18 · Security",
      status: "Recommended",
      score: "96",
      detail:
        "A customer explains how the team kept security review moving while adding a new workspace.",
      tags: ["Security", "Enterprise"],
    },
    {
      id: "clip-pilot",
      name: "A pilot with a finish line",
      meta: "Fieldwire · 01:42 · Pilot",
      status: "Recommended",
      score: "88",
      detail:
        "The customer names the first three workflows and the adoption signal that earns expansion.",
      tags: ["Pilot", "Expansion"],
    },
    {
      id: "clip-operations",
      name: "Making the operations owner visible",
      meta: "Northstar Labs · 03:05 · Operations",
      status: "Review transcript",
      score: "77",
      detail:
        "The account team describes the moment a new operations owner became the right project sponsor.",
      tags: ["Operations", "Sponsor"],
    },
    {
      id: "clip-onboarding",
      name: "Onboarding the first three teams",
      meta: "Harbor Logistics · 01:16 · Onboarding",
      status: "Available",
      score: "61",
      detail:
        "A concise walkthrough of the first week and the signal that told the team to expand.",
      tags: ["Onboarding"],
    },
  ],
};
