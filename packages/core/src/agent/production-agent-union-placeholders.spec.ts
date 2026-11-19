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
    "refuses ambiguous clears and accepts a sparse retry (normalized root %s)",
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
        callId: "mixed-input",
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
      expect(result.status).toBe("failed");
      expect(result.output).toContain("No action was run");
      expect(run).not.toHaveBeenCalled();
      const retry = await executeAgentToolCall({
        actions: { "update-view": action as unknown as ActionEntry },
        name: "update-view",
        callId: "sparse-retry",
        input: {
          operation: "update",
          view: null,
          viewId: "view-1",
          patch: {
            icon: null,
            filters: [{ key: "context" }],
            hiddenIds: [],
            wrap: false,
          },
        },
      });
      expect(retry.status).toBe("completed");
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
        callId: "invalid-extra",
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

  describe("padded calls that are not ambiguous", () => {
    const padded = {
      designId: "design-1",
      name: null,
      reuseLabels: [],
      includeContent: false,
    };
    const schema = z.object({
      designId: z.string(),
      name: z.string().optional(),
      reuseLabels: z.array(z.string()).optional().default([]),
      includeContent: z.boolean().optional().default(false),
    });
    const call = async (
      options: { readOnly?: boolean },
      input: Record<string, unknown>,
    ) => {
      const run = vi.fn(async (args: Record<string, unknown>) => args);
      const action = defineAction({
        description: "Do something",
        schema,
        ...options,
        run,
      });
      const result = await executeAgentToolCall({
        actions: { act: action as unknown as ActionEntry },
        name: "act",
        callId: "padded",
        input,
      });
      return { result, run };
    };

    it("runs when every empty value equals its schema default", async () => {
      const { result, run } = await call({}, padded);
      expect(result.status).toBe("completed");
      expect(run.mock.calls[0]?.[0]).not.toHaveProperty("name");
    });

    it("still refuses an empty value that differs from its default", async () => {
      const run = vi.fn(async (args: Record<string, unknown>) => args);
      const action = defineAction({
        description: "Update a thing",
        schema: z.object({
          id: z.string(),
          name: z.string().optional(),
          tags: z.string().optional().default("a"),
        }),
        run,
      });
      const result = await executeAgentToolCall({
        actions: { update: action as unknown as ActionEntry },
        name: "update",
        callId: "differs",
        input: { id: "1", name: null, tags: "" },
      });
      expect(result.status).toBe("failed");
      expect(run).not.toHaveBeenCalled();
    });

    it("runs a read-only call with an empty value beside a null", async () => {
      const readSchema = z.object({
        query: z.string().optional(),
        ids: z.array(z.string()).optional(),
      });
      const run = vi.fn(async (args: Record<string, unknown>) => args);
      const action = defineAction({
        description: "List things",
        schema: readSchema,
        readOnly: true,
        run,
      });
      const result = await executeAgentToolCall({
        actions: { list: action as unknown as ActionEntry },
        name: "list",
        callId: "read",
        input: { query: null, ids: [] },
      });
      expect(result.status).toBe("completed");
      expect(run.mock.calls[0]?.[0]).toMatchObject({ ids: [] });
    });

    it("sees an empty value that arrives as a stringified object", async () => {
      const run = vi.fn(async (args: Record<string, unknown>) => args);
      const action = defineAction({
        description: "Update a thing",
        schema: z.object({
          id: z.string(),
          name: z.string().optional(),
          meta: z.record(z.string(), z.string()).optional(),
        }),
        run,
      });
      const result = await executeAgentToolCall({
        actions: { update: action as unknown as ActionEntry },
        name: "update",
        callId: "stringified",
        input: { id: "1", name: null, meta: "{}" },
      });
      expect(result.status).toBe("failed");
      expect(run).not.toHaveBeenCalled();
    });

    it("still refuses a write whose empty value has no default", async () => {
      const writeSchema = z.object({
        id: z.string(),
        name: z.string().optional(),
        hidden: z.string().optional(),
      });
      const run = vi.fn(async (args: Record<string, unknown>) => args);
      const action = defineAction({
        description: "Update a thing",
        schema: writeSchema,
        run,
      });
      const result = await executeAgentToolCall({
        actions: { update: action as unknown as ActionEntry },
        name: "update",
        callId: "write",
        input: { id: "1", name: null, hidden: "" },
      });
      expect(result.status).toBe("failed");
      expect(result.output).toContain("No action was run");
      expect(run).not.toHaveBeenCalled();
    });
  });
});
