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
  title: "Churn Early Warning",
  summary:
    "See which accounts need attention before renewal risk becomes urgent.",
  primaryAction: "Review risk",
  queueLabel: "Accounts to watch",
  metric: { value: "12", label: "need review" },
  detailTitle: "Risk context",
  items: [
    {
      id: "vector-works",
      name: "Vector Works",
      meta: "Renewal in 21 days · $84k ARR",
      status: "Intervene",
      score: "88",
      detail:
        "Weekly active users fell 41% and the executive sponsor has not replied to two check-ins.",
      tags: ["Usage drop", "Sponsor silent"],
    },
    {
      id: "lumen-payments",
      name: "Lumen Payments",
      meta: "Renewal in 46 days · $52k ARR",
      status: "Watch",
      score: "74",
      detail:
        "Support volume is elevated and the main workspace has not invited a new user in 30 days.",
      tags: ["Support", "Adoption"],
    },
    {
      id: "harbor-logistics",
      name: "Harbor Logistics",
      meta: "Renewal in 73 days · $29k ARR",
      status: "Healthy",
      score: "28",
      detail:
        "Usage is steady, key workflows are active, and the account added two teams this month.",
      tags: ["Healthy", "Adoption"],
    },
    {
      id: "sunroom-retail",
      name: "Sunroom Retail",
      meta: "Renewal in 9 days · $18k ARR",
      status: "Needs owner",
      score: "67",
      detail:
        "The renewal task is unassigned and the latest account note is six weeks old.",
      tags: ["Renewal", "Unassigned"],
    },
  ],
};
