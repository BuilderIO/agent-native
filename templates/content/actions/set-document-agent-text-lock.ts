import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  AGENT_LEVELS,
  agentLevelFromStored,
  storedAgentLevel,
} from "../shared/agent-level.js";
import { isAgentCall } from "./_document-agent-lock.js";

export default defineAction({
  description:
    "Set what agents can do on one page: Can view (read only), Can comment (read, comment and suggest edits) or Can edit. Only a person can change it, from the Agents tab of the page's Share panel.",
  schema: z
    .object({
      id: z.string().describe("Document ID"),
      level: z
        .enum(AGENT_LEVELS)
        .optional()
        .describe("What agents can do on the page"),
      locked: z
        .boolean()
        .optional()
        .describe(
          "From a page loaded before Can view: true is Can comment, false Can edit",
        ),
    })
    .refine(
      (args) => (args.level === undefined) !== (args.locked === undefined),
      {
        message: "Pass level, or locked from an older page, but not both",
      },
    ),
  outputSchema: z.object({
    ok: z.literal(true),
    id: z.string(),
    agentLevel: z.enum(AGENT_LEVELS),
    agentTextLocked: z.boolean(),
  }),
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  authorize: (_args, ctx) => ctx?.caller === "frontend" && !isAgentCall(ctx),
  run: async ({ id, level, locked }) => {
    await assertAccess("document", id, "admin");
    const stored = schema.documents.agentTextLocked;
    // A page loaded before Can view sends locked: true to limit agents; that
    // leaves a page someone has set to Can view where it is, decided in the
    // write so a level set meanwhile still counts.
    const [row] = await getDb()
      .update(schema.documents)
      .set({
        agentTextLocked:
          level !== undefined
            ? storedAgentLevel(level)
            : locked
              ? sql<number>`CASE WHEN ${stored} IN (0, 1) THEN 1 ELSE ${stored} END`
              : storedAgentLevel("edit"),
      })
      .where(eq(schema.documents.id, id))
      .returning({ agentTextLocked: stored });
    const agentLevel =
      level ??
      (row
        ? agentLevelFromStored(row.agentTextLocked)
        : locked
          ? "comment"
          : "edit");

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      ok: true as const,
      id,
      agentLevel,
      agentTextLocked: agentLevel !== "edit",
    };
  },
});
