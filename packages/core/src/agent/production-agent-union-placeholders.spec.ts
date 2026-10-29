import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAction } from "../action.js";
import { executeAgentToolCall, type ActionEntry } from "./production-agent.js";

const viewSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("create"),
      view: z.object({ name: z.string() }),
    })
    .strict(),
  z
    .object({
      operation: z.literal("update"),
      viewId: z.string(),
      patch: z
        .object({
          name: z.string().min(1).optional(),
          icon: z.string().nullable().optional(),
          filters: z
            .array(z.object({ key: z.string(), group: z.string().optional() }))
            .optional(),
          hiddenIds: z.array(z.string()).optional(),
          wrap: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
]);

describe("root-union tool placeholders", () => {
  it.each([false, true])(
    "repairs the selected branch before the action runs (normalized root %s)",
    async (normalizedRoot) => {
      const run = vi.fn(async (input: z.infer<typeof viewSchema>) => input);
      const action = defineAction({
        description: "Update a view",
        schema: viewSchema,
        run,
      });
      if (normalizedRoot)
        action.tool.parameters = {
          ...action.tool.parameters,
          type: "object",
          properties: {},
        };
      const result = await executeAgentToolCall({
        actions: { "update-view": action as unknown as ActionEntry },
        name: "update-view",
        input: {
          operation: "update",
          view: null,
          viewId: "view-1",
          patch: {
            name: null,
            icon: null,
            filters: [{ key: "context", group: null }],
            hiddenIds: [],
            wrap: false,
          },
        },
      });
      expect(result.status).toBe("completed");
      expect(run).toHaveBeenCalledOnce();
      expect(run.mock.calls[0]?.[0]).toEqual({
        operation: "update",
        viewId: "view-1",
        patch: {
          icon: null,
          filters: [{ key: "context" }],
          hiddenIds: [],
          wrap: false,
        },
      });
    },
  );

  it.each([{ view: { name: "unexpected" } }, { typo: null }])(
    "rejects extra fields that are not transport placeholders: %j",
    async (extra) => {
      const run = vi.fn(async (input: z.infer<typeof viewSchema>) => input);
      const action = defineAction({
        description: "Update a view",
        schema: viewSchema,
        run,
      });
      const result = await executeAgentToolCall({
        actions: { "update-view": action as unknown as ActionEntry },
        name: "update-view",
        input: {
          operation: "update",
          viewId: "view-1",
          patch: { wrap: false },
          ...extra,
        },
      });
      expect(result.status).toBe("failed");
      expect(run).not.toHaveBeenCalled();
    },
  );
});
