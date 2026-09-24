import { describe, expect, it, vi } from "vitest";

import type { AgentEngine, EngineEvent } from "./engine/types.js";
import { runAgentLoop, type ActionEntry } from "./production-agent.js";

// The real `patch-deck` shape: a discriminated union of operations whose only
// interesting enums live three levels down, under an operation's `fields`.
//
// Parametrized by union keyword because both are reachable for the same Zod
// schema — Zod v4's own `toJSONSchema` emits `oneOf` for a discriminated union,
// while the manual fallback converter in `action.ts` emits `anyOf`.
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
  // Only the validation complaints, not the `Expected:` signature that follows
  // them — the signature legitimately names every branch.
  const errorClause = result.slice(
    result.indexOf("patch-deck: "),
    result.indexOf(". Received:"),
  );
  return { run, result, errorClause };
}

describe.each(["oneOf", "anyOf"] as const)(
  "discriminated-union tool input (%s)",
  (unionKeyword) => {
    // The observed failure: a gateway pre-filled every optional field of the
    // leaf `fields` object, so a title rename was rejected over `tweaks` /
    // `aspectRatio` / `visibility` and re-sent verbatim until the
    // identical-error breaker fired.
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
      // The branches the caller never meant must not be complained about.
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

    // Every element of an array shares one `items` schema, so all their branch
    // errors share a schemaPath and differ only by instancePath. Narrowing on
    // schemaPath alone lets operation 0's chosen branch delete operation 1's
    // errors, and vice versa, until nothing survives.
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
