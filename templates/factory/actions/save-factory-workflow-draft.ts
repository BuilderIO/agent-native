import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  resolveWorkflowScope,
  withWorkflowFailures,
} from "../server/lib/factory-workflow-context.js";
import { draftGraphProblem } from "../server/workflow/store-rules.js";

export default defineAction({
  description:
    "Editor autosave, not for the agent: keeps the signed-in person's unsaved graph for a workflow as their private draft. The graph is JSON text and is not validated, so a graph with problems is kept; text that cannot be a graph (not JSON, no nodes and edges arrays, over 256 KB) fails with draft_malformed. Last write wins and baseVersion is not checked here. A draft is never run and is not a version: save-factory-workflow still validates and saves.",
  agentTool: false,
  schema: z.object({
    factoryId: factoryIdSchema,
    workflowId: z.string().trim().min(1).max(64),
    baseVersion: z
      .number()
      .int()
      .min(1)
      .describe("The saved version the edits started from."),
    graph: z.string().describe("The editor's graph as JSON text."),
  }),
  outputSchema: z.object({ updatedAt: z.string() }),
  http: { method: "POST" },
  // Replaces the member's one draft, so a repeat lands in the same place.
  retrySafe: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  // An autosave runs every few seconds and carries up to 256 KB.
  audit: { enabled: false },
  run: async ({ factoryId, workflowId, baseVersion, graph }, context) =>
    withWorkflowFailures(async () => {
      const scoped = await resolveWorkflowScope(factoryId, context);
      const problem = draftGraphProblem(graph);
      if (problem) {
        fail(problem, { errorCode: "draft_malformed", statusCode: 422 });
      }
      const saved = await scoped.store.saveWorkflowDraft(scoped.scope, {
        workflowId,
        ownerEmail: scoped.userEmail,
        baseVersion,
        graphJson: graph,
      });
      return { updatedAt: saved.updatedAt };
    }),
});
