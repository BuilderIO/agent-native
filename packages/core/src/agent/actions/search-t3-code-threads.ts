import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { T3_CODE_AGENTS_LAB } from "../../labs/core-labs.js";
import { assertLabEnabled } from "../../labs/guard.js";
import {
  toT3CodeThread,
  withT3Code,
  type T3CodeThread,
} from "../../mcp-client/t3-code.js";

export default defineAction({
  description:
    "List or search the current user's own T3 Code threads for one agent, newest first.",
  schema: z.object({
    agent: z.enum(["claude-code", "codex"]),
    query: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  outputSchema: z.object({
    threads: z.array(
      z.object({
        threadId: z.string(),
        title: z.string(),
        status: z.string(),
        agent: z.enum(["claude-code", "codex"]).nullable(),
        projectId: z.string().nullable(),
        updatedAt: z.string().nullable(),
      }),
    ),
  }),
  http: { method: "GET" },
  mcpTool: false,
  run: async ({ agent, query, limit = 12 }, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    await assertLabEnabled(T3_CODE_AGENTS_LAB, ctx);
    const search = query?.trim();
    const list = await withT3Code(email, async (call) => {
      if (search) {
        const found = await call<{ matches?: unknown[] }>("t3_thread_search", {
          query: search,
          limit: 30,
        });
        return found.matches ?? [];
      }
      const listed = await call<{ threads?: unknown[] }>("t3_thread_list", {
        allProjects: true,
        limit: 60,
      });
      return listed.threads ?? [];
    });
    const threads = list
      .map((item) => toT3CodeThread(item))
      .filter(
        (thread): thread is T3CodeThread =>
          thread !== null && (thread.agent === agent || thread.agent === null),
      )
      .slice(0, limit);
    return { threads };
  },
});
