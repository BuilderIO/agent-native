export const LEGAL_POLICY_METADATA = [
  {
    key: "terms",
    slug: "terms",
    title: "Agent-Native Hosted Services Terms",
    description:
      "Standalone terms for Agent-Native hosted applications, hosted examples, demos, and related services.",
    filename: "terms.md",
  },
  {
    key: "privacy",
    slug: "privacy",
    title: "Agent-Native Privacy Policy",
    description:
      "Standalone privacy policy for Agent-Native hosted applications and related services.",
    filename: "privacy.md",
  },
  {
    key: "acceptableUse",
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    description:
      "Rules for safe and lawful use of Agent-Native hosted services.",
    filename: "acceptable-use.md",
  },
  {
    key: "aiTerms",
    slug: "ai-terms",
    title: "AI Terms",
    description: "Terms for AI features in Agent-Native hosted services.",
    filename: "ai-terms.md",
  },
  {
    key: "platformRules",
    slug: "platform-rules",
    title: "Platform Rules",
    description:
      "Plain-English rules for content and applications on Agent-Native hosted infrastructure.",
    filename: "platform-rules.md",
  },
  {
    key: "takedown",
    slug: "takedown",
    title: "Suspension, Takedown & Data-Handling Policy",
    description:
      "How the Service operator handles suspension, takedown, appeals, and hosted application data.",
    filename: "takedown.md",
  },
  {
    key: "lawEnforcement",
    slug: "law-enforcement",
    title: "Law Enforcement Request Policy",
    description:
      "How the Service operator responds to government requests for hosted Agent-Native information.",
    filename: "law-enforcement.md",
  },
] as const;

export const ADDITIONAL_LEGAL_POLICY_METADATA = LEGAL_POLICY_METADATA.slice(2);
