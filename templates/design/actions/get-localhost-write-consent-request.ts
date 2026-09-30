import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

const requestSchema = z.object({
  designId: z.string(),
  connectionId: z.string(),
  rootPath: z.string(),
  files: z.array(z.string()),
  requestedAt: z.string(),
});

export default defineAction({
  description: "Internal editor handoff for pending localhost write consent.",
  schema: z.object({ designId: z.string() }),
  readOnly: true,
  agentTool: false,
  capabilityScopes: ["visual-edit"],
  http: { method: "GET" },
  run: async ({ designId }) => {
    await assertAccess("design", designId, "editor");
    const value = await readAppState(
      `design-localhost-write-consent-request:${designId}`,
    );
    if (value == null) return { request: null };
    const request = requestSchema.parse(value);
    if (request.designId !== designId) {
      throw new Error(
        "Localhost consent request design does not match its key",
      );
    }
    return { request };
  },
});
