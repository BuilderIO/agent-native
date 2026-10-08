import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentEngine, EngineEvent } from "./engine/types.js";

const loadSkillDocPagesMock = vi.hoisted(() => vi.fn());

vi.mock("./run-store.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getCurrentTurnEventsForThread: vi.fn(async () => []),
    writeLedgerEntry: vi.fn(async () => {}),
    readLedgerEntry: vi.fn(async () => null),
  };
});

vi.mock("../scripts/docs/search.js", () => {
  return { loadSkillDocPages: loadSkillDocPagesMock };
});

const { runAgentLoop, normalizeLoadedSkillSlugs } =
  await import("./production-agent.js");

function capturingEngine(capture: (systemPrompt: string) => void) {
  const engine: AgentEngine = {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(options): AsyncIterable<EngineEvent> {
      capture(options.systemPrompt);
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "Done." }],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
  return engine;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("skill pages read in earlier turns", () => {
  it("are added to a new turn unless still whole in history", async () => {
    const designPage = "# Skill: slide-design\nUse scale contrast.";
    const editingPage = "# Skill: slide-editing\nKeep layout in flow.";
    loadSkillDocPagesMock.mockResolvedValueOnce(
      new Map([
        ["skill-slide-design", designPage],
        ["skill-slide-editing", editingPage],
      ]),
    );
    let systemPrompt = "";

    await runAgentLoop({
      engine: capturingEngine((prompt) => (systemPrompt = prompt)),
      model: "test-model",
      systemPrompt: "base system prompt",
      tools: [],
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "read-editing",
              name: "docs-search",
              input: { slug: "skill-slide-editing" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "read-editing",
              toolName: "docs-search",
              toolInput: JSON.stringify({ slug: "skill-slide-editing" }),
              content: editingPage,
            },
          ],
        },
        { role: "user", content: [{ type: "text", text: "Polish slide 2." }] },
      ],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-cross-turn-skills",
      loadedSkillSlugs: ["skill-slide-design", "skill-slide-editing"],
    });

    expect(loadSkillDocPagesMock).toHaveBeenCalledWith(
      ["skill-slide-design", "skill-slide-editing"],
      undefined,
    );
    expect(systemPrompt).toContain("<already-loaded-skills>");
    expect(systemPrompt).toContain(designPage);
    expect(systemPrompt).not.toContain(editingPage);
  });

  it("add nothing to a turn without prior skill reads", async () => {
    let systemPrompt = "";

    await runAgentLoop({
      engine: capturingEngine((prompt) => (systemPrompt = prompt)),
      model: "test-model",
      systemPrompt: "base system prompt",
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      actions: {},
      send: () => {},
      signal: new AbortController().signal,
      threadId: "thread-no-skills",
    });

    expect(loadSkillDocPagesMock).not.toHaveBeenCalled();
    expect(systemPrompt).not.toContain("<already-loaded-skills>");
  });
});

describe("normalizeLoadedSkillSlugs", () => {
  it("keeps valid skill slugs once, most recent last", () => {
    expect(
      normalizeLoadedSkillSlugs([
        "skill-slide-design",
        "agents-template",
        "skill-../etc",
        42,
        "skill-design-systems--tokens",
        "skill-slide-design",
      ]),
    ).toEqual(["skill-design-systems--tokens", "skill-slide-design"]);
  });

  it("caps the list to the most recent sixteen", () => {
    const slugs = Array.from({ length: 20 }, (_, i) => `skill-s${i}`);
    expect(normalizeLoadedSkillSlugs(slugs)).toEqual(slugs.slice(4));
  });

  it("ignores a non-array value", () => {
    expect(normalizeLoadedSkillSlugs("skill-slide-design")).toEqual([]);
  });
});
