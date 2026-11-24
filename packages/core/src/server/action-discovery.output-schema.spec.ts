import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAction } from "../action.js";
import { loadActionsFromStaticRegistry } from "./action-discovery.js";

describe("registered action output contract", () => {
  it("preserves the same output validator for every registry module shape", async () => {
    const outputSchema = z.object({ id: z.string(), body: z.string() });
    const action = defineAction({
      description: "Read the visible document body.",
      schema: z.object({ id: z.string() }),
      outputSchema,
      readOnly: true,
      run: ({ id }) => ({ id, body: "Visible body" }),
    });
    const registered = loadActionsFromStaticRegistry({
      direct: action,
      module: { default: action },
    });
    for (const entry of Object.values(registered)) {
      expect(entry.outputSchema).toBe(outputSchema);
      expect(await entry.run({ id: "document-1" })).toEqual({
        id: "document-1",
        body: "Visible body",
      });
    }
  });
});
