import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadContractBundle } from "./_contracts.js";

export default defineAction({
  description:
    "Export a Contracts review as Markdown and structured JSON receipt.",
  schema: z.object({
    contractId: z.string(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Export contract",
    description: "Export a Contracts review as Markdown and JSON.",
  },
  run: async (args) => {
    const bundle = await loadContractBundle(args.contractId);
    const lines = [
      `# ${bundle.contract.title}`,
      "",
      bundle.contract.goal,
      "",
      `Status: ${bundle.contract.status}`,
      "",
      "## Review Summary",
      "",
      `- Needs review: ${bundle.summary.reviewCount}`,
      `- Verified criteria: ${bundle.summary.verifiedCount}`,
      `- Missing evidence: ${bundle.summary.missingEvidenceCount}`,
      "",
      "## Assumptions",
      "",
      ...bundle.items
        .filter((item) => item.type === "assumption")
        .map(
          (item) =>
            `- [${item.reviewState}] ${item.title}${item.impactSummary ? ` — ${item.impactSummary}` : ""}`,
        ),
      "",
      "## Acceptance Criteria",
      "",
      ...bundle.items
        .filter((item) => item.type === "acceptance_criterion")
        .map((item) => `- [${item.reviewState}] ${item.title}`),
      "",
      "## Evidence",
      "",
      ...bundle.evidence.map(
        (item) =>
          `- [${item.trustLevel}] ${item.summary}${item.command ? ` (${item.command})` : ""}`,
      ),
    ];
    return {
      markdown: lines.join("\n"),
      json: bundle,
    };
  },
});
