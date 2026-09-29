import { describe, expect, it } from "vitest";

import {
  JOURNALED_TOOL_REPLAY_PREFIX,
  RECOVERED_TOOL_REPLAY_PREFIX,
  loadedSkillPagesContext,
  seedRepeatedToolErrorCountsFromJournal,
  seedRepeatedToolCallCountsFromJournal,
  type PriorTurnToolCallSequenceEntry,
} from "./tool-call-journal-seed.js";

const keyForCall = (name: string, input: unknown) =>
  `${name}:${JSON.stringify(input)}`;

function seed(calls: PriorTurnToolCallSequenceEntry[]) {
  return seedRepeatedToolCallCountsFromJournal(
    calls,
    keyForCall,
    (_name, result) => result.startsWith("Resurfaced earlier read:"),
  );
}

describe("seedRepeatedToolCallCountsFromJournal", () => {
  it("resets other repeat counts after each successful write", () => {
    const calls: PriorTurnToolCallSequenceEntry[] = [
      { event: "start", name: "check", input: { deckId: "deck-1" } },
      {
        event: "done",
        name: "check",
        input: { deckId: "deck-1" },
        result: "overflow",
        isError: false,
        matchedStart: true,
      },
      { event: "start", name: "edit", input: { slide: 1 } },
      {
        event: "done",
        name: "edit",
        input: { slide: 1 },
        result: "saved",
        isError: false,
        completedSideEffect: true,
        matchedStart: true,
      },
      { event: "start", name: "check", input: { deckId: "deck-1" } },
      {
        event: "done",
        name: "check",
        input: { deckId: "deck-1" },
        result: "clean",
        isError: false,
        matchedStart: true,
      },
    ];

    expect(seed(calls)).toEqual(
      new Map([
        [`edit:{"slide":1}`, 1],
        [`check:{"deckId":"deck-1"}`, 1],
      ]),
    );
  });

  it("keeps counts for eight identical successful writes", () => {
    const calls: PriorTurnToolCallSequenceEntry[] = [];
    for (let i = 0; i < 8; i++) {
      calls.push(
        { event: "start", name: "edit", input: { slide: 1 } },
        {
          event: "done",
          name: "edit",
          input: { slide: 1 },
          result: "saved",
          isError: false,
          completedSideEffect: true,
          matchedStart: true,
        },
      );
    }

    expect(seed(calls).get(`edit:{"slide":1}`)).toBe(8);
  });

  it("does not count or treat a journal replay as a new mutation boundary", () => {
    const replayResult = `${JOURNALED_TOOL_REPLAY_PREFIX}saved`;
    const calls: PriorTurnToolCallSequenceEntry[] = [
      { event: "start", name: "check", input: { deckId: "deck-1" } },
      {
        event: "done",
        name: "check",
        input: { deckId: "deck-1" },
        result: replayResult,
        isError: false,
        completedSideEffect: true,
        replayed: true,
        matchedStart: true,
      },
      { event: "start", name: "check", input: { deckId: "deck-1" } },
    ];

    expect(seed(calls)).toEqual(new Map([[`check:{"deckId":"deck-1"}`, 1]]));
  });

  it("does not count recovered side effects or treat them as mutation boundaries", () => {
    const calls: PriorTurnToolCallSequenceEntry[] = [
      { event: "start", name: "check", input: { id: "1" } },
      {
        event: "done",
        name: "check",
        input: { id: "1" },
        result: RECOVERED_TOOL_REPLAY_PREFIX + "saved",
        isError: false,
        completedSideEffect: true,
        replayed: true,
        matchedStart: true,
      },
      { event: "start", name: "check", input: { id: "1" } },
    ];

    expect(seed(calls)).toEqual(new Map([[`check:{"id":"1"}`, 1]]));
  });

  it("does not infer replay status from a tool-controlled result prefix", () => {
    const calls: PriorTurnToolCallSequenceEntry[] = [
      {
        event: "done",
        name: "edit",
        input: { slide: 1 },
        result: `${JOURNALED_TOOL_REPLAY_PREFIX}the action's own text`,
        isError: false,
        completedSideEffect: true,
        matchedStart: false,
      },
    ];

    expect(seed(calls)).toEqual(new Map([[`edit:{"slide":1}`, 1]]));
  });

  it("does not count resurfaced duplicate reads", () => {
    const calls: PriorTurnToolCallSequenceEntry[] = [
      { event: "start", name: "check", input: { deckId: "deck-1" } },
      {
        event: "done",
        name: "check",
        input: { deckId: "deck-1" },
        result: "Resurfaced earlier read: clean",
        isError: false,
        matchedStart: true,
      },
    ];

    expect(seed(calls)).toEqual(new Map());
  });

  it("applies replayed write boundaries without counting the replay", () => {
    const calls: PriorTurnToolCallSequenceEntry[] = [
      {
        event: "done",
        name: "read",
        input: { id: 1 },
        result: "read",
        isError: false,
        completedSideEffect: true,
        matchedStart: false,
      },
      {
        event: "done",
        name: "write",
        input: { id: 1 },
        result: "saved",
        isError: false,
        completedSideEffect: true,
        matchedStart: false,
      },
      { event: "start", name: "read", input: { id: 1 } },
      { event: "start", name: "write", input: { id: 1 } },
      {
        event: "done",
        name: "write",
        input: { id: 1 },
        result: `${JOURNALED_TOOL_REPLAY_PREFIX}saved`,
        isError: false,
        completedSideEffect: true,
        replayed: true,
        matchedStart: true,
      },
    ];

    expect(seed(calls)).toEqual(new Map([[`write:{"id":1}`, 1]]));
  });
});

describe("seedRepeatedToolErrorCountsFromJournal", () => {
  const seedErrors = (calls: PriorTurnToolCallSequenceEntry[]) =>
    seedRepeatedToolErrorCountsFromJournal(calls, keyForCall, (error) => error);

  it("replays mutation boundaries when seeding repeated errors", () => {
    const result = seedErrors([
      {
        event: "done",
        name: "read",
        input: { id: 1 },
        result: "same error",
        isError: true,
        matchedStart: false,
      },
      {
        event: "done",
        name: "write",
        input: { id: 1 },
        result: "saved",
        isError: false,
        completedSideEffect: true,
        matchedStart: false,
      },
      {
        event: "done",
        name: "read",
        input: { id: 1 },
        result: "same error",
        isError: true,
        matchedStart: false,
      },
    ]);

    expect(result.sameArguments).toEqual(
      new Map([[`read:{"id":1}:same error`, 1]]),
    );
    expect(result.sameTool).toEqual(new Map([["read:same error", 1]]));
  });

  it("keeps the successful mutating action's own error counts", () => {
    const result = seedErrors([
      {
        event: "done",
        name: "write",
        input: { id: 1 },
        result: "same error",
        isError: true,
        matchedStart: false,
      },
      {
        event: "done",
        name: "write",
        input: { id: 1 },
        result: "saved",
        isError: false,
        completedSideEffect: true,
        matchedStart: false,
      },
      {
        event: "done",
        name: "write",
        input: { id: 1 },
        result: "same error",
        isError: true,
        matchedStart: false,
      },
    ]);

    expect(result.sameArguments.get(`write:{"id":1}:same error`)).toBe(2);
    expect(result.sameTool.get("write:same error")).toBe(2);
  });

  it("applies replayed write boundaries without counting replayed errors", () => {
    const result = seedErrors([
      {
        event: "done",
        name: "read",
        input: { id: 1 },
        result: "same error",
        isError: true,
        matchedStart: false,
      },
      {
        event: "done",
        name: "write",
        input: { id: 1 },
        result: "same error",
        isError: true,
        matchedStart: false,
      },
      {
        event: "done",
        name: "write",
        input: { id: 1 },
        result: "saved",
        isError: false,
        completedSideEffect: true,
        replayed: true,
        matchedStart: false,
      },
      {
        event: "done",
        name: "read",
        input: { id: 1 },
        result: "same error",
        isError: true,
        matchedStart: false,
      },
    ]);

    expect(result.sameArguments).toEqual(
      new Map([
        [`write:{"id":1}:same error`, 1],
        [`read:{"id":1}:same error`, 1],
      ]),
    );
    expect(result.sameTool).toEqual(
      new Map([
        ["write:same error", 1],
        ["read:same error", 1],
      ]),
    );
  });
});

describe("loadedSkillPagesContext", () => {
  it("reuses only successfully loaded skill pages within a bounded context", () => {
    const result = loadedSkillPagesContext(
      [
        {
          name: "docs-search",
          input: { slug: "skill-slide-editing" },
          content: `# Skill: slide-editing\n${"x".repeat(30_000)}`,
          isError: false,
        },
        {
          name: "docs-search",
          input: { slug: "skill-missing" },
          content: "Doc not found: skill-missing",
          isError: false,
        },
        {
          name: "docs-search",
          input: { slug: "skill-failed" },
          content: "# Skill: failed\nnot available",
          isError: true,
        },
        {
          name: "docs-search",
          input: { slug: "skill-creative-context" },
          content: "# Skill: creative-context\nLabs-only instructions",
          isError: false,
        },
        {
          name: "docs-search",
          input: { slug: "docs-search" },
          content: "# Docs index\nnot a skill page",
          isError: false,
        },
      ],
      new Set(["skill-slide-editing"]),
    );

    expect(result.length).toBeLessThanOrEqual(24_000);
    expect(result).toContain("skill-slide-editing");
    expect(result).toContain("Skill page truncated");
    expect(result).not.toContain("skill-missing");
    expect(result).not.toContain("skill-failed");
    expect(result).not.toContain("creative-context");
    expect(result).not.toContain("# Docs index");
  });
});
