export interface DefaultDetectorDefinition {
  id: string;
  name: string;
  description: string;
  kind: "keyword" | "smart";
  keywords?: string[];
  classifierPrompt?: string;
  enabled: true;
}

export const DEFAULT_CRM_DETECTORS: DefaultDetectorDefinition[] = [
  {
    id: "pricing",
    name: "Pricing",
    description: "Price, budget, quote, cost, or discount discussion.",
    kind: "keyword",
    keywords: ["price", "pricing", "quote", "cost", "discount"],
    enabled: true,
  },
  {
    id: "budget",
    name: "Budget",
    description: "Budget availability, approval, or constraint is discussed.",
    kind: "keyword",
    keywords: ["budget", "approved funds", "procurement"],
    enabled: true,
  },
  {
    id: "competitors",
    name: "Competitors",
    description: "A competing product, vendor, or current tool is mentioned.",
    kind: "smart",
    classifierPrompt:
      "Match a named competitor or a clear reference to another evaluated or current solution.",
    enabled: true,
  },
  {
    id: "objections",
    name: "Objections",
    description: "A prospect raises concern, hesitation, or pushback.",
    kind: "smart",
    classifierPrompt:
      "Match concerns about fit, timing, price, security, implementation, or team buy-in.",
    enabled: true,
  },
  {
    id: "next-steps",
    name: "Next steps",
    description:
      "A concrete future action, meeting, deliverable, or follow-up.",
    kind: "smart",
    classifierPrompt:
      "Match explicit commitments such as sending a proposal, booking a meeting, or looping in a stakeholder.",
    enabled: true,
  },
  {
    id: "timing",
    name: "Timing",
    description: "A deadline, renewal, launch, or urgency signal.",
    kind: "smart",
    classifierPrompt:
      "Match a concrete timeline, deadline, renewal, quarter, or urgency signal.",
    enabled: true,
  },
];
