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
  title: "LinkedIn Signal Watch",
  summary:
    "Turn the people and company changes you care about into a focused signal feed.",
  primaryAction: "Scan new signals",
  queueLabel: "Signals worth review",
  metric: { value: "9", label: "new signals" },
  detailTitle: "Signal context",
  items: [
    {
      id: "rivet-vp",
      name: "Rivet Security hired a VP Platform",
      meta: "LinkedIn · 11m ago",
      status: "High relevance",
      score: "94",
      detail:
        "Avery Patel joined this week and is hiring three platform engineers.",
      tags: ["New hire", "Hiring"],
    },
    {
      id: "kindred-post",
      name: "Kindred Health posted about operational drag",
      meta: "LinkedIn · 42m ago",
      status: "High relevance",
      score: "86",
      detail:
        "The post names handoffs across a growing engineering team as a current focus.",
      tags: ["Exec signal", "Growth"],
    },
    {
      id: "northstar-champion",
      name: "Northstar Labs changed champions",
      meta: "CRM · 2h ago",
      status: "Needs context",
      score: "72",
      detail:
        "The former champion moved teams; a new operations contact opened the latest brief.",
      tags: ["Champion", "CRM"],
    },
    {
      id: "lumen-office",
      name: "Lumen Payments opened a Chicago office",
      meta: "Company site · Yesterday",
      status: "Low confidence",
      score: "41",
      detail:
        "A new office is listed on the company site, but no related hiring signal is confirmed.",
      tags: ["Company change"],
    },
  ],
};
