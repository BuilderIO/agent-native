import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { T3_CODE_AGENTS_LAB } from "../../labs/core-labs.js";
import { assertLabEnabled } from "../../labs/guard.js";
import { fetchMcpOriginBound } from "../../mcp-client/manager.js";
import { validateRemoteUrl } from "../../mcp-client/remote-url.js";

const PROBE_TIMEOUT_MS = 8_000;

export default defineAction({
  description:
    "Check that this server can reach a T3 Code MCP address before the user signs in to it.",
  schema: z.object({
    url: z.string().min(1).max(2048).describe("The T3 Code MCP URL."),
  }),
  outputSchema: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), url: z.string() }),
    z.object({
      ok: z.literal(false),
      reason: z.enum(["http", "invalid", "not-mcp", "unreachable"]),
    }),
  ]),
  mcpTool: false,
  run: async ({ url }, ctx) => {
    const email = ctx?.userEmail;
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    await assertLabEnabled(T3_CODE_AGENTS_LAB, ctx);
    const trimmed = url.trim();
    if (/^http:\/\//i.test(trimmed)) {
      const local = validateRemoteUrl(trimmed);
      if (!local.ok) return { ok: false as const, reason: "http" as const };
    }
    const checked = validateRemoteUrl(trimmed);
    if (!checked.ok || !checked.url) {
      return { ok: false as const, reason: "invalid" as const };
    }
    if (!/\/mcp\/?$/.test(checked.url.pathname)) {
      return { ok: false as const, reason: "not-mcp" as const };
    }
    try {
      const response = await fetchMcpOriginBound(
        checked.url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        },
        checked.url.origin,
      );
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 500) {
        return { ok: false as const, reason: "unreachable" as const };
      }
      return { ok: true as const, url: checked.url.toString() };
    } catch {
      return { ok: false as const, reason: "unreachable" as const };
    }
  },
});
