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
  title: "LinkedIn ICP Prospect Tracker",
  summary:
    "Keep a living prospect list ranked by fit and the reason to reach out now.",
  primaryAction: "Refresh prospect list",
  queueLabel: "Prospects in scope",
  metric: { value: "24", label: "prospects" },
  detailTitle: "Prospect context",
  items: [
    {
      id: "rivet-security",
      name: "Rivet Security",
      meta: "Series B · 220 employees",
      status: "Strong fit",
      score: "94",
      detail:
        "Hiring three platform engineers and recently opened a second data center in Chicago.",
      tags: ["Hiring", "Data infra"],
    },
    {
      id: "kindred-health",
      name: "Kindred Health",
      meta: "Series C · 480 employees",
      status: "Research",
      score: "86",
      detail:
        "The VP of Engineering posted about reducing operational drag across a fast-growing team.",
      tags: ["Exec signal", "Growth"],
    },
    {
      id: "cinder-finance",
      name: "Cinder Finance",
      meta: "Series A · 96 employees",
      status: "Watch",
      score: "68",
      detail:
        "Fits the company profile, but no timely trigger was found this week.",
      tags: ["ICP fit"],
    },
    {
      id: "redwood-robotics",
      name: "Redwood Robotics",
      meta: "Series B · 150 employees",
      status: "Strong fit",
      score: "83",
      detail:
        "A new operations leader joined after the company announced a second product line.",
      tags: ["New leader", "Product"],
    },
  ],
};
