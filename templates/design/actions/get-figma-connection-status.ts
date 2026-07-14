import { defineAction } from "@agent-native/core";
import { resolveSecret } from "@agent-native/core/server";
import { z } from "zod";

const FIGMA_ACCESS_TOKEN_KEY = "FIGMA_ACCESS_TOKEN";

/**
 * Return only whether the current authenticated request can use Figma.
 *
 * The registered-secrets endpoint intentionally reports user-vault metadata
 * only. Local and single-tenant Design runtimes may instead provide a managed
 * credential, so the import UI needs a request-scoped availability check that
 * follows the exact same resolver as the importer without returning the
 * credential, its suffix, or its source.
 */
export default defineAction({
  description:
    "Check whether this authenticated Design session can use the Figma API without returning credential values or metadata.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async () => ({
    available: Boolean(await resolveSecret(FIGMA_ACCESS_TOKEN_KEY)),
  }),
});
