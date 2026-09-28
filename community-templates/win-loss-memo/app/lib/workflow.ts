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
  title: "Win/Loss Memo",
  summary:
    "Make the reason behind each deal outcome easy to review and compare.",
  primaryAction: "Write memo",
  queueLabel: "Recent outcomes",
  metric: { value: "17", label: "outcomes" },
  detailTitle: "Outcome context",
  items: [
    {
      id: "vector-win",
      name: "Vector Works",
      meta: "Won · $84k ARR · Enterprise",
      status: "Memo ready",
      score: "91",
      detail:
        "The buyer chose the team after a short pilot made the implementation path concrete.",
      tags: ["Won", "Pilot"],
    },
    {
      id: "lumen-loss",
      name: "Lumen Payments",
      meta: "Lost · $52k ARR · Mid-market",
      status: "Needs context",
      score: "76",
      detail:
        "The deal went to the incumbent after procurement prioritized an existing contract.",
      tags: ["Lost", "Incumbent"],
    },
    {
      id: "harbor-win",
      name: "Harbor Logistics",
      meta: "Won · $29k ARR · Growth",
      status: "Memo ready",
      score: "73",
      detail:
        "A clear operations owner and a narrow first workflow shortened the decision cycle.",
      tags: ["Won", "Operations"],
    },
    {
      id: "sunroom-loss",
      name: "Sunroom Retail",
      meta: "Lost · $18k ARR · Growth",
      status: "Needs context",
      score: "58",
      detail:
        "The opportunity closed without a final buyer interview, so the reason is still uncertain.",
      tags: ["Lost", "Unknown"],
    },
  ],
};
