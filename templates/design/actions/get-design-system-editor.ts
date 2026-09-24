import { defineAction, fail } from "@agent-native/core/action";
import { resolveBuilderDesignSystemEditor } from "@agent-native/core/server";
import { assertBuilderDsiAccess } from "@agent-native/core/server/builder-dsi-access";
import { z } from "zod";

import { resolveDesignSystemAccess } from "../server/lib/design-system-dsi-access.js";
import "../server/db/index.js";

export default defineAction({
  authorize: async () => {
    await assertBuilderDsiAccess();
  },
  description:
    "Resolve a Builder-backed design system's working project URL using its local ID. Returns ready with editorUrl or preparing with null; lookup failures throw. Preparing is not a request to wait for indexing to complete.",
  schema: z.object({
    id: z.string().trim().min(1).describe("Local design system ID"),
  }),
  agentTool: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = await resolveDesignSystemAccess(id);
    if (!access) {
      fail("Design system not found.", {
        errorCode: "design_system_not_found",
        statusCode: 404,
      });
    }
    return resolveBuilderDesignSystemEditor(access.resource.data);
  },
});
