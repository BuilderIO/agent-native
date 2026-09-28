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
  title: "Outbound in Your Voice",
  summary:
    "Turn a real trigger into a thoughtful first draft that sounds like your team.",
  primaryAction: "Draft outreach",
  queueLabel: "Signals to review",
  metric: { value: "6", label: "this week" },
  detailTitle: "Draft context",
  items: [
    {
      id: "rivet-security",
      name: "Rivet Security",
      meta: "New VP Platform hire",
      status: "Draft ready",
      score: "94",
      detail:
        "Their new platform leader is hiring around the exact workflow this team solves.",
      tags: ["New hire", "ICP"],
    },
    {
      id: "kindred-health",
      name: "Kindred Health",
      meta: "Operations post · 2d ago",
      status: "Review tone",
      score: "86",
      detail:
        "The signal is strong, but the post is personal and needs a lighter touch.",
      tags: ["Signal", "Tone"],
    },
    {
      id: "cinder-finance",
      name: "Cinder Finance",
      meta: "ICP match · no trigger",
      status: "Hold",
      score: "68",
      detail:
        "Good fit, but there is no timely reason to interrupt the team yet.",
      tags: ["ICP fit"],
    },
    {
      id: "redwood-robotics",
      name: "Redwood Robotics",
      meta: "New operations leader",
      status: "Needs research",
      score: "63",
      detail:
        "The hiring signal is promising, but the account context is still incomplete.",
      tags: ["New hire"],
    },
  ],
};
