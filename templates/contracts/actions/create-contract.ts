import { defineAction, embedApp } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  contractDeepLink,
  contractPath,
  contractSourceSchema,
  itemInputSchema,
  loadContractBundle,
  newId,
  nowIso,
  writeEvent,
} from "./_contracts.js";

export default defineAction({
  description:
    "Create a Contracts review queue for a coding-agent task. Use this before complex or risky work to record material assumptions, acceptance criteria, and proof obligations.",
  schema: z.object({
    title: z.string().optional().describe("Short contract title"),
    goal: z.string().min(1).describe("Goal the agent is trying to accomplish"),
    source: contractSourceSchema.optional().default("manual"),
    repoPath: z.string().optional().describe("Repository path for the run"),
    currentPhase: z.string().optional().describe("Current phase of work"),
    items: z
      .array(itemInputSchema)
      .optional()
      .default([])
      .describe("Initial material assumptions, decisions, tasks, and criteria"),
  }),
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    isConsequential: true,
    title: "Create Contracts review",
    description:
      "Create a review queue where a person can correct assumptions and proof obligations before the agent continues.",
  },
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Contracts review",
      description:
        "Open the Contracts review inbox for assumptions, feedback, and proof status.",
      iframeTitle: "Agent-Native Contracts",
      openLabel: "Open Contracts review",
      height: 820,
    }),
  },
  run: async (args) => {
    const id = newId("ctr");
    const now = nowIso();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Creating a contract requires an authenticated user.");
    }
    const orgId = getRequestOrgId();
    const db = getDb();
    await db.insert(schema.contracts).values({
      id,
      title: args.title || "Untitled contract",
      goal: args.goal,
      status: "review",
      source: args.source,
      repoPath: args.repoPath ?? null,
      currentPhase: args.currentPhase ?? "review",
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
      ownerEmail,
      orgId,
      visibility: "private",
    });
    if (args.items.length > 0) {
      await db.insert(schema.contractItems).values(
        args.items.map((item) => ({
          id: item.id ?? newId("itm"),
          contractId: id,
          type: item.type,
          title: item.title,
          body: item.body,
          status: item.status,
          risk: item.risk,
          reviewState: item.reviewState,
          actedOn: item.actedOn,
          impactSummary: item.impactSummary ?? null,
          affectedFiles: JSON.stringify(item.affectedFiles),
          sourceRefs: JSON.stringify(item.sourceRefs),
          linkedItemIds: JSON.stringify(item.linkedItemIds),
          createdBy: item.createdBy,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    await writeEvent({
      contractId: id,
      type: "contract.created",
      message: "Contract review queue created.",
      createdBy: "agent",
    });
    return {
      ...(await loadContractBundle(id)),
      path: contractPath(id),
      url: contractPath(id),
      fallbackInstructions:
        "Open the Contracts link, review the queue, then I will call get-feedback before continuing. If this host cannot read live feedback, paste the feedback summary back into chat.",
    };
  },
  link: ({ result }) => {
    const contract = (result as { contract?: { id?: string } } | null)
      ?.contract;
    if (!contract?.id) return null;
    return {
      url: contractDeepLink(contract.id),
      label: "Open Contracts review",
      view: "contract",
    };
  },
});
