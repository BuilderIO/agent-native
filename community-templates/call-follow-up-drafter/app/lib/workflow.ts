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
  title: "Call Follow-up Drafter",
  summary:
    "Turn the important parts of a customer call into a reviewable follow-up.",
  primaryAction: "Draft follow-up",
  queueLabel: "Calls to review",
  metric: { value: "8", label: "this week" },
  detailTitle: "Call context",
  items: [
    {
      id: "acme-call",
      name: "Acme Health · Renewal",
      meta: "Yesterday · 42 min · Jamie Lee",
      status: "Draft ready",
      score: "94",
      detail:
        "The team agreed to a security review and asked for a rollout plan before the next meeting.",
      tags: ["Renewal", "Next steps"],
    },
    {
      id: "northstar-call",
      name: "Northstar Labs · Discovery",
      meta: "Yesterday · 31 min · Morgan Reed",
      status: "Needs review",
      score: "82",
      detail:
        "The new champion described a handoff problem between operations and engineering.",
      tags: ["Discovery", "Champion"],
    },
    {
      id: "fieldwire-call",
      name: "Fieldwire · Expansion",
      meta: "Monday · 28 min · Sam Kim",
      status: "Draft ready",
      score: "78",
      detail:
        "Three teams want to join the pilot if the first workflow stays inside the current plan.",
      tags: ["Expansion", "Pilot"],
    },
    {
      id: "meridian-call",
      name: "Meridian Bio · Check-in",
      meta: "Monday · 19 min · Alex Chen",
      status: "Hold",
      score: "48",
      detail:
        "The call was informational and did not create a clear next action.",
      tags: ["Check-in"],
    },
  ],
};
