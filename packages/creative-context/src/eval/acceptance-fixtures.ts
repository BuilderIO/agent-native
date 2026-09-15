import type { ContextAcceptanceCase } from "./acceptance.js";

const forbidden = [
  "INJECTION_EXECUTED",
  "system prompt",
  "secret token",
] as const;

export const CREATIVE_CONTEXT_ACCEPTANCE_CASES: readonly ContextAcceptanceCase[] =
  [
    {
      id: "launch-scorecard-slide",
      prompt: "Draft an executive launch scorecard slide.",
      reference:
        "Launch scorecard with four KPI tiles, a purple trend line, and one sentence of interpretation for each trend.",
      expectedContextKeys: ["upload:launch-system-v2"],
      requiredTerms: ["four KPI tiles", "purple trend line", "interpretation"],
      forbiddenTerms: forbidden,
      contextOff: {
        output: "Executive launch scorecard with key business metrics.",
        usedContextKeys: [],
      },
      contextOn: {
        output:
          "Launch scorecard with four KPI tiles, a purple trend line, and one sentence of interpretation for each trend.",
        usedContextKeys: ["upload:launch-system-v2"],
        contextPackId: "pack:launch-scorecard",
        provenanceKeys: ["upload:launch-system-v2"],
      },
    },
    {
      id: "pricing-hero-frame",
      prompt: "Design a pricing hero for the website.",
      reference:
        "Use an ink background, Inter 56 heading, three pricing cards, and one purple Start free trial button.",
      expectedContextKeys: ["figma:brand-system-v2"],
      requiredTerms: ["Inter 56", "three pricing cards", "Start free trial"],
      forbiddenTerms: forbidden,
      contextOff: {
        output: "A modern pricing hero with a headline, cards, and a button.",
        usedContextKeys: [],
      },
      contextOn: {
        output:
          "Use an ink background, Inter 56 heading, three pricing cards, and one purple Start free trial button.",
        usedContextKeys: ["figma:brand-system-v2"],
        contextPackId: "pack:pricing-hero",
        provenanceKeys: ["figma:brand-system-v2"],
      },
    },
    {
      id: "launch-voice-copy",
      prompt: "Write the launch announcement opening and CTA.",
      reference:
        "Lead with the user outcome in direct active voice, support it with one verified metric, and close with one explicit trial action.",
      expectedContextKeys: ["notion:launch-narrative-v2"],
      requiredTerms: ["user outcome", "verified metric", "trial action"],
      forbiddenTerms: forbidden,
      contextOff: {
        output:
          "We are thrilled to announce our revolutionary best-in-class platform. Learn more today.",
        usedContextKeys: [],
      },
      contextOn: {
        output:
          "Lead with the user outcome in direct active voice, support it with one verified metric, and close with one explicit trial action.",
        usedContextKeys: ["notion:launch-narrative-v2"],
        contextPackId: "pack:launch-voice",
        provenanceKeys: ["notion:launch-narrative-v2"],
      },
    },
    {
      id: "rendered-campaign-page",
      prompt: "Create a campaign page that proves adoption.",
      reference:
        "Use the purple and ink palette, show activation plus 18 percent in a four-metric proof grid, and end with Start free trial.",
      expectedContextKeys: ["web:rendered-brand-page"],
      requiredTerms: [
        "purple and ink",
        "activation plus 18 percent",
        "Start free trial",
      ],
      forbiddenTerms: forbidden,
      contextOff: {
        output:
          "Use an attractive palette, a collection of metrics, and a compelling call to action.",
        usedContextKeys: [],
      },
      contextOn: {
        output:
          "Use the purple and ink palette, show activation plus 18 percent in a four-metric proof grid, and end with Start free trial.",
        usedContextKeys: ["web:rendered-brand-page"],
        contextPackId: "pack:campaign-page",
        provenanceKeys: ["web:rendered-brand-page"],
      },
    },
  ] as const;
