import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { addPlanTextDetections } from "./analyze-plan.js";
import {
  contractDeepLink,
  contractPath,
  contractSourceSchema,
  loadContractBundle,
  newId,
  nowIso,
  writeEvent,
} from "./_contracts.js";

function inferTitle(planText: string): string {
  const firstHeading = planText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#{1,3}\s+\S/.test(line));
  if (firstHeading) return firstHeading.replace(/^#{1,3}\s+/, "").slice(0, 90);
  const firstLine = planText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 90) : "Imported visual plan";
}

export default defineAction({
  description:
    "Create an Agent-Native Plans companion from an existing Codex, Claude Code, Markdown, or pasted text plan. Use this to turn a text plan into a reviewable HTML plan with detected assumptions, proof gates, and a browser/MCP app link.",
  schema: z.object({
    title: z.string().optional().describe("Short title for the visual plan"),
    goal: z
      .string()
      .optional()
      .describe("Goal of the existing plan; defaults to the imported plan"),
    planText: z
      .string()
      .min(1)
      .describe("Existing Codex, Claude Code, Markdown, or pasted plan text"),
    source: contractSourceSchema.optional().default("imported"),
    repoPath: z.string().optional().describe("Repository path for the run"),
    currentPhase: z.string().optional().default("visual review"),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Visualize Plan",
    description:
      "Import an existing text plan and create an interactive Agent-Native Plans companion for review and feedback.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Plan Companion",
      description:
        "Open the Agent-Native Plans review surface for an imported Codex or Claude Code plan.",
      iframeTitle: "Agent-Native Plans",
      openLabel: "Open Plan",
      height: 820,
    }),
  },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Visualizing a plan requires an authenticated user.");
    }
    const id = newId("ctr");
    const now = nowIso();
    const title = args.title || inferTitle(args.planText);
    const goal =
      args.goal ||
      `Visual companion for an imported coding-agent plan:\n\n${args.planText.slice(
        0,
        4000,
      )}`;

    await getDb()
      .insert(schema.contracts)
      .values({
        id,
        title,
        goal,
        status: "review",
        source: args.source,
        repoPath: args.repoPath ?? null,
        currentPhase: args.currentPhase ?? "visual review",
        createdAt: now,
        updatedAt: now,
        approvedAt: null,
        ownerEmail,
        orgId: getRequestOrgId(),
        visibility: "private",
      });

    await writeEvent({
      contractId: id,
      type: "visual_plan.imported",
      message: "Imported text plan for visual review.",
      payload: {
        source: args.source,
        textLength: args.planText.length,
      },
      createdBy: "agent",
    });
    const detections = await addPlanTextDetections({
      contractId: id,
      planText: args.planText,
    });
    const bundle = await loadContractBundle(id);
    return {
      ...bundle,
      plan: bundle.contract,
      planId: id,
      path: contractPath(id),
      url: contractPath(id),
      detections,
      fallbackInstructions:
        "Open the Agent-Native Plans companion, react to the diagrams/options/wireframes and detected review items, then I will call get-plan-feedback before continuing. If this host cannot read live feedback, paste the feedback summary back into chat.",
    };
  },
  link: ({ result }) => {
    const contract = (result as { contract?: { id?: string } } | null)
      ?.contract;
    if (!contract?.id) return null;
    return {
      url: contractDeepLink(contract.id),
      label: "Open Plan",
      view: "plan",
    };
  },
});
