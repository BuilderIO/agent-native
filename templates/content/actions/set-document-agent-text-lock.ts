import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { isAgentCall } from "./_document-agent-lock.js";

export default defineAction({
  description:
    "Set what agents can do on one page: locked is Can comment, unlocked is Can edit. Only a person can change it, from the Agents tab of the page's Share panel.",
  schema: z.object({
    id: z.string().describe("Document ID"),
    locked: z.boolean().describe("true stops agents editing the page's text"),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    id: z.string(),
    agentTextLocked: z.boolean(),
  }),
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  authorize: (_args, ctx) => ctx?.caller === "frontend" && !isAgentCall(ctx),
  run: async ({ id, locked }) => {
    await assertAccess("document", id, "admin");
    await getDb()
      .update(schema.documents)
      .set({ agentTextLocked: locked ? 1 : 0 })
      .where(eq(schema.documents.id, id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { ok: true as const, id, agentTextLocked: locked };
  },
});
