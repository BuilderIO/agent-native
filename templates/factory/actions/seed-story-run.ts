import { defineAction, fail } from "@agent-native/core/action";
import { resolveDeployEnvironment } from "@agent-native/core/server";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  resolveWorkflowScope,
  withWorkflowFailures,
} from "../server/lib/factory-workflow-context.js";
import deleteFactoryWorkflow from "./delete-factory-workflow.js";
import saveFactoryWorkflow from "./save-factory-workflow.js";

const STATUS: Record<string, number> = {
  story_not_found: 404,
  scenario_not_found: 404,
  workflow_name_taken: 409,
  workflow_changed: 409,
  scenario_conflict: 409,
  partial_replay: 409,
  replay_failed: 500,
};

export default defineAction({
  description:
    "Local development only: replay one of the ten story scenarios through the real workflow engine into this machine's database, with fake providers, model, Slack and clock, so the Workflows, Items, journey and node-audit screens have data without any provider credentials. Saves a disabled workflow named 'Seeded story NN: ...' and records its runs as started by seed-story-run. Running it again for the same scenario changes nothing; purge: true removes only what it seeded for that story in that factory. Never use it for real work, to test a real provider, or for a user's own workflow, and it refuses anywhere but a local dev server.",
  schema: z.object({
    factoryId: factoryIdSchema,
    storyId: z
      .union([
        z.number().int().min(1).max(10),
        z.string().trim().min(1).max(80),
      ])
      .describe(
        "Which story: 1 to 10, '03', or the slug such as 'morning-digest'.",
      ),
    scenario: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe(
        "A scenario name from the story's script.json. Defaults to the story's first, which is its headline scenario.",
      ),
    purge: z
      .boolean()
      .default(false)
      .describe(
        "Remove what a replay of this story seeded in this factory (its workflow, runs, items) and replay nothing.",
      ),
  }),
  http: false,
  mcpTool: false,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  audit: {
    target: (_args: unknown, result: unknown) => ({
      type: "factory-workflow",
      id: (result as { workflowId?: string } | undefined)?.workflowId,
      visibility: "org",
    }),
    summary: (
      args: { storyId: string | number; purge: boolean },
      result: unknown,
    ) =>
      result
        ? `${args.purge ? "Purged" : "Replayed"} seeded story ${args.storyId}`
        : `Seeded story ${args.storyId} refused`,
  },
  run: async ({ factoryId, storyId, scenario, purge }, context) => {
    // Decided per call, never at load, and closed for beta and preview too:
    // seeding writes fake items into whatever database this process is on.
    const environment = resolveDeployEnvironment();
    if (environment !== "local") {
      fail(
        `seed-story-run only runs on a local dev server, and this is "${environment}".`,
        { errorCode: "seed_story_run_not_allowed", statusCode: 403 },
      );
    }
    // The story fixtures and fakes load here, not at cold start.
    const seed = await import("../server/workflow-host/seed-story.js");
    try {
      return await withWorkflowFailures(async () => {
        const story = seed.resolveStory(storyId);
        const scoped = await resolveWorkflowScope(factoryId, context);
        const getDatabase = () => getDb();
        if (purge) {
          return await seed.purgeStory({
            scope: scoped.scope,
            story,
            getDatabase,
            deleteWorkflow: async (workflowId) => {
              await deleteFactoryWorkflow.run(
                { factoryId, workflowId, force: true },
                context,
              );
            },
          });
        }
        return await seed.seedStory({
          scope: scoped.scope,
          ownerEmail: scoped.userEmail,
          story,
          ...(scenario === undefined ? {} : { scenario }),
          getDatabase,
          saveWorkflow: async ({ name, graph, summary }) => {
            const saved = await saveFactoryWorkflow.run(
              { factoryId, name, summary, graph },
              context,
            );
            return { workflowId: saved.workflowId };
          },
        });
      });
    } catch (error) {
      if (!(error instanceof seed.SeedStoryError)) throw error;
      return fail(error.message, {
        errorCode: `seed_story_${error.code}`,
        statusCode: STATUS[error.code] ?? 500,
        details: error.details,
      });
    }
  },
});
