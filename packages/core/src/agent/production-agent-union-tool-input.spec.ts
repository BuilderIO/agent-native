import { describe, expect, it, vi } from "vitest";

import type { AgentEngine, EngineEvent } from "./engine/types.js";
import { runAgentLoop, type ActionEntry } from "./production-agent.js";

function patchDeckParameters(unionKeyword: "oneOf" | "anyOf") {
  return {
    type: "object" as const,
    properties: {
      deckId: { type: "string" },
      operations: {
        type: "array",
        items: {
          [unionKeyword]: [
            {
              type: "object",
              properties: {
                op: { const: "patch-slide" },
                slideId: { type: "string" },
                fields: {
                  type: "object",
                  properties: { content: { type: "string" } },
                },
              },
              required: ["op", "slideId", "fields"],
            },
            {
              type: "object",
              properties: {
                op: { const: "reorder-slides" },
                orderedIds: { type: "array", items: { type: "string" } },
              },
              required: ["op", "orderedIds"],
            },
            {
              type: "object",
              properties: {
                op: { const: "patch-deck-fields" },
                fields: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    designSystemId: { type: "string" },
                    tweaks: { type: "object" },
                    aspectRatio: { enum: ["16:9", "4:3"] },
                    shareToken: { type: "string" },
                    visibility: { enum: ["private", "org", "public"] },
                    starred: { type: "boolean" },
                  },
                },
              },
              required: ["op", "fields"],
            },
          ],
        },
      },
    },
    required: ["deckId", "operations"],
  };
}

function engineCallingPatchDeck(input: unknown): AgentEngine {
  let calls = 0;
  return {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: true,
    },
    async *stream(): AsyncIterable<EngineEvent> {
      calls += 1;
      if (calls > 1) {
        yield { type: "text", text: "done" };
        yield { type: "stop", reason: "end_turn" };
        return;
      }
      yield {
        type: "tool-call",
        id: "call-1",
        name: "patch-deck",
        input,
      } as EngineEvent;
      yield { type: "stop", reason: "tool_use" };
    },
  } as AgentEngine;
}

async function runPatchDeck(
  unionKeyword: "oneOf" | "anyOf",
  input: unknown,
): Promise<{
  run: ReturnType<typeof vi.fn>;
  result: string;
  errorClause: string;
}> {
  const run = vi.fn(async () => ({ ok: true }));
  const events: any[] = [];
  await runAgentLoop({
    engine: engineCallingPatchDeck(input),
    model: "test-model",
    systemPrompt: "system",
    tools: [],
    messages: [{ role: "user", content: [{ type: "text", text: "rename" }] }],
    actions: {
      "patch-deck": {
        tool: {
          description: "Patch a deck",
          parameters: patchDeckParameters(unionKeyword),
        },
        run,
      } as unknown as ActionEntry,
    },
    send: (event) => events.push(event),
    signal: new AbortController().signal,
  });
  const result = String(
    events.find((e) => e.type === "tool_done" && e.tool === "patch-deck")
      ?.result ?? "",
  );
  const errorClause = result.slice(
    result.indexOf("patch-deck: "),
    result.indexOf(". Received:"),
  );
  return { run, result, errorClause };
}

describe.each(["oneOf", "anyOf"] as const)(
  "discriminated-union tool input (%s)",
  (unionKeyword) => {
    it("strips gateway placeholders nested inside a union branch", async () => {
      const { run } = await runPatchDeck(unionKeyword, {
        deckId: "MB8Yb3BKQe",
        operations: [
          {
            op: "patch-deck-fields",
            fields: {
              title: "Giraffes vs Horses",
              designSystemId: "",
              tweaks: null,
              aspectRatio: "",
              shareToken: "",
              visibility: "",
              starred: false,
            },
          },
        ],
      });

      expect(run).toHaveBeenCalledTimes(1);
      expect((run.mock.calls[0] as any)[0]).toEqual({
        deckId: "MB8Yb3BKQe",
        operations: [
          { op: "patch-deck-fields", fields: { title: "Giraffes vs Horses" } },
        ],
      });
    });

    it("keeps intentional clears when every empty value is schema-valid", async () => {
      const { run } = await runPatchDeck(unionKeyword, {
        deckId: "d1",
        operations: [
          {
            op: "patch-deck-fields",
            fields: { designSystemId: "", starred: false },
          },
        ],
      });

      expect((run.mock.calls[0] as any)[0].operations[0].fields).toEqual({
        designSystemId: "",
        starred: false,
      });
    });

    it("reports only the branch the discriminator selects", async () => {
      const { run, errorClause } = await runPatchDeck(unionKeyword, {
        deckId: "d1",
        operations: [
          {
            op: "patch-deck-fields",
            fields: { title: 42, visibility: "everyone" },
          },
        ],
      });

      expect(run).not.toHaveBeenCalled();
      expect(errorClause).not.toContain("slideId");
      expect(errorClause).not.toContain("orderedIds");
      expect(errorClause).toContain("visibility");
    });

    it("spells out nested enums in the expected signature", async () => {
      const { result } = await runPatchDeck(unionKeyword, {
        deckId: "d1",
        operations: [
          {
            op: "patch-deck-fields",
            fields: { title: 42, visibility: "everyone" },
          },
        ],
      });

      expect(result).toContain('"private"|"org"|"public"');
      expect(result).toContain('"patch-deck-fields"');
    });

    it("narrows each array element against its own discriminator", async () => {
      const { errorClause } = await runPatchDeck(unionKeyword, {
        deckId: "d1",
        operations: [
          { op: "patch-deck-fields", fields: { visibility: "everyone" } },
          { op: "patch-slide", fields: { content: "hi" } },
        ],
      });

      expect(errorClause).toContain("visibility");
      expect(errorClause).toContain("slideId");
      expect(errorClause).not.toContain("orderedIds");
    });

    it("keeps every branch error when no discriminator matches", async () => {
      const { errorClause } = await runPatchDeck(unionKeyword, {
        deckId: "d1",
        operations: [{ op: "not-a-real-op", fields: {} }],
      });

      expect(errorClause).toContain("slideId");
      expect(errorClause).toContain("orderedIds");
    });
  },
);
