import { describe, expect, it, vi } from "vitest";

import * as runStore from "../run-store.js";
import {
  JOURNALED_TOOL_REPLAY_PREFIX,
  RECOVERED_TOOL_REPLAY_PREFIX,
  loadedSkillPagesContext,
  loadPriorTurnToolCallJournal,
  overlayCompletedExecutionStepOutcomes,
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

  it("resets other repeat counts after a write that failed once its changes saved", () => {
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
        result: "Its changes are already applied: do not retry it.",
        isError: true,
        completedSideEffect: true,
        matchedStart: true,
      },
    ];

    expect(seed(calls)).toEqual(new Map([[`edit:{"slide":1}`, 1]]));
  });

  it("preserves pending parallel calls across successful-write resets", () => {
    const calls: PriorTurnToolCallSequenceEntry[] = [
      { event: "start", name: "write-a", input: { id: "a" } },
      { event: "start", name: "write-b", input: { id: "b" } },
      { event: "start", name: "write-c", input: { id: "c" } },
      {
        event: "done",
        name: "write-a",
        input: { id: "a" },
        result: "saved",
        isError: false,
        completedSideEffect: true,
        matchedStart: true,
      },
      {
        event: "done",
        name: "write-b",
        input: { id: "b" },
        result: "saved",
        isError: false,
        completedSideEffect: true,
        matchedStart: true,
      },
      {
        event: "done",
        name: "write-c",
        input: { id: "c" },
        result: "saved",
        isError: false,
        completedSideEffect: true,
        matchedStart: true,
      },
    ];

    expect(seed(calls)).toEqual(new Map([[`write-c:{"id":"c"}`, 1]]));
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

    expect(seed(calls)).toEqual(
      new Map([
        [`read:{"id":1}`, 1],
        [`write:{"id":1}`, 1],
      ]),
    );
  });
});

describe("seedRepeatedToolErrorCountsFromJournal", () => {
  const seedErrors = (calls: PriorTurnToolCallSequenceEntry[]) =>
    seedRepeatedToolErrorCountsFromJournal(calls, keyForCall, (error) => error);

  it("does not treat approval pauses or skipped calls as successful executions", () => {
    const calls: PriorTurnToolCallSequenceEntry[] = [
      {
        event: "done",
        name: "edit",
        input: {},
        result: "bad input",
        isError: true,
        matchedStart: true,
      },
      {
        event: "done",
        name: "edit",
        input: {},
        result: "approval required",
        isError: false,
        approvalPause: true,
        matchedStart: true,
      },
      {
        event: "done",
        name: "edit",
        input: {},
        result: "not executed",
        isError: false,
        notExecuted: true,
        matchedStart: true,
      },
    ];
    expect(seedErrors(calls).failureStreaks.get("edit")).toBe(1);
  });

  it("keeps changing errors across continuation and resets only a successful tool", () => {
    const calls: PriorTurnToolCallSequenceEntry[] = [
      {
        event: "done",
        name: "edit",
        input: { id: 1 },
        result: "bad field",
        isError: true,
        matchedStart: true,
      },
      {
        event: "done",
        name: "read",
        input: {},
        result: "found",
        isError: false,
        matchedStart: true,
      },
      {
        event: "done",
        name: "edit",
        input: { id: 2 },
        result: "bad filter",
        isError: true,
        matchedStart: true,
      },
      {
        event: "done",
        name: "edit",
        input: { id: 2 },
        result: "bad filter",
        isError: true,
        replayed: true,
        matchedStart: true,
      },
    ];
    expect(seedErrors(calls).failureStreaks.get("edit")).toBe(2);
    calls.push({
      event: "done",
      name: "edit",
      input: { id: 3 },
      result: "saved",
      isError: false,
      completedSideEffect: true,
      matchedStart: true,
    });
    expect(seedErrors(calls).failureStreaks.has("edit")).toBe(false);
  });

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
    expect(result.sameTool).toEqual(
      new Map([["read", new Map([["same error", 1]])]]),
    );
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
    expect(result.sameTool.get("write")?.get("same error")).toBe(2);
  });

  it("counts a committed failure's error and resets the others", () => {
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
        result: "do not retry",
        isError: true,
        completedSideEffect: true,
        matchedStart: false,
      },
    ]);

    expect(result.sameArguments).toEqual(
      new Map([[`write:{"id":1}:do not retry`, 1]]),
    );
    expect(result.sameTool).toEqual(
      new Map([["write", new Map([["do not retry", 1]])]]),
    );
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
        ["write", new Map([["same error", 1]])],
        ["read", new Map([["same error", 1]])],
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
          content: `# Skill: slide-editing\n${"x".repeat(50_000)}`,
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
      new Map(),
      new Map([["skill-slide-editing", "x".repeat(50_000)]]),
    );

    expect(result.length).toBeLessThanOrEqual(40_000);
    expect(result).toContain("skill-slide-editing");
    expect(result).toContain("Skill page truncated");
    expect(result).not.toContain("skill-missing");
    expect(result).not.toContain("skill-failed");
    expect(result).not.toContain("creative-context");
    expect(result).not.toContain("# Docs index");
  });

  it("keeps both slides skills whole and prefers this run's reads", () => {
    const editing = `# Skill: slide-editing\n${"e".repeat(17_100)}`;
    const design = `# Skill: slide-design\n${"d".repeat(8_200)}`;
    const result = loadedSkillPagesContext(
      [
        {
          name: "docs-search",
          input: { slug: "skill-slide-design" },
          content: `${design}\nfresh`,
          isError: false,
        },
      ],
      new Map([
        ["skill-slide-design", design],
        ["skill-slide-editing", editing],
      ]),
      new Map([["skill-slide-design", "d".repeat(8_200)]]),
    );

    expect(result).toContain("earlier in this conversation");
    expect(result).toContain(editing);
    expect(result).toContain(`${design}\nfresh`);
    expect(result).not.toContain("Skill page truncated");
    expect(result.indexOf("## skill-slide-design")).toBeLessThan(
      result.indexOf("## skill-slide-editing"),
    );
  });

  it("skips journaled reads that no longer match the current skill body", () => {
    const result = loadedSkillPagesContext(
      [
        {
          name: "docs-search",
          input: { slug: "skill-slide-editing" },
          content: "# Skill: slide-editing\nOld guidance.",
          isError: false,
        },
      ],
      new Map(),
      new Map([["skill-slide-editing", "New guidance."]]),
    );

    expect(result).toBe("");
  });

  it("skips pages still intact in the model's history", () => {
    const page = "# Skill: slide-editing\nGuidance.";
    const result = loadedSkillPagesContext(
      [
        {
          name: "docs-search",
          input: { slug: "skill-slide-editing" },
          content: page,
          isError: false,
        },
      ],
      new Map([["skill-slide-design", "# Skill: slide-design\nDesign."]]),
      new Map([["skill-slide-editing", "Guidance."]]),
      (slug) => slug === "skill-slide-editing",
    );

    expect(result).not.toContain("## skill-slide-editing");
    expect(result).toContain("## skill-slide-design");
  });

  it("lists skill pages dropped by the budget so they can be re-read", () => {
    const result = loadedSkillPagesContext(
      [],
      new Map([
        ["skill-old", `# Skill: old\n${"o".repeat(100)}`],
        ["skill-big", `# Skill: big\n${"b".repeat(50_000)}`],
        ["skill-older", `# Skill: older\n${"x".repeat(100)}`],
      ]),
      new Map(),
    );

    expect(result).toContain("Skill page truncated");
    expect(result).toContain("read with docs-search if needed: skill-old]");
    expect(result).not.toContain("## skill-old\n");
  });

  it("keeps the omitted notice within the context cap for many long slugs", () => {
    const pages = new Map<string, string>();
    for (let i = 0; i < 16; i++) {
      pages.set(
        `skill-${i}-${"s".repeat(190)}`,
        `# Skill: s\n${"p".repeat(30_000)}`,
      );
    }
    const result = loadedSkillPagesContext([], pages, new Map());

    expect(result.length).toBeLessThanOrEqual(40_000);
    expect(result).toContain("Omitted to fit loaded-skill context");
  });
});

const SYNTHETIC_PRIVATE_REPLAY_IDENTITY = `hmac-v1:${"a".repeat(64)}`;

describe("private prior-turn recovery", () => {
  it("resumes a completed private tool pair with an HMAC replay identity without persisting private content", async () => {
    const read = vi
      .spyOn(runStore, "getCurrentTurnEventsForThread")
      .mockResolvedValue([
        {
          type: "tool_start",
          id: "private-call",
          tool: "write",
          input: {},
          omitFromPersistedHistory: true,
        },
        {
          type: "tool_done",
          id: "private-call",
          tool: "write",
          input: {},
          result: "[Private content omitted]",
          completedSideEffect: true,
          privateReplayIdentity: SYNTHETIC_PRIVATE_REPLAY_IDENTITY,
          omitFromPersistedHistory: true,
        },
      ]);
    try {
      const result = await loadPriorTurnToolCallJournal("thread", "turn");
      expect(result).toMatchObject({
        status: "read",
        toolCallJournal: {
          completed: [
            expect.objectContaining({
              id: "private-call",
              tool: "write",
              result: "[Private content omitted]",
              committed: true,
              privateReplayIdentity: SYNTHETIC_PRIVATE_REPLAY_IDENTITY,
            }),
          ],
          interrupted: [],
        },
      });
    } finally {
      read.mockRestore();
    }
  });

  it("resumes a completed private tool pair from its redacted ledger entry", async () => {
    const read = vi
      .spyOn(runStore, "getCurrentTurnEventsForThread")
      .mockResolvedValue([
        {
          type: "tool_start",
          id: "private-call-no-identity",
          tool: "write",
          input: {},
          omitFromPersistedHistory: true,
        },
        {
          type: "tool_done",
          id: "private-call-no-identity",
          tool: "write",
          input: {},
          result: "[Private content omitted]",
          completedSideEffect: true,
          omitFromPersistedHistory: true,
        },
      ]);
    try {
      expect(
        await loadPriorTurnToolCallJournal("thread", "turn"),
      ).toMatchObject({
        status: "read",
        priorToolResults: [
          {
            name: "write",
            content: "[Private content omitted]",
            isError: false,
          },
        ],
      });
    } finally {
      read.mockRestore();
    }
  });

  it("keeps a recovered private step private", async () => {
    const steps = vi
      .spyOn(runStore, "getCompletedAgentExecutionSteps")
      .mockResolvedValue([
        {
          stepId: "private-call",
          operationId: "private-call",
          toolName: "write",
          inputJson: JSON.stringify({
            argumentsHash: "a".repeat(64),
            input: {},
          }),
          resultJson: JSON.stringify({
            result: "[Private content omitted]",
            isError: false,
            completedSideEffect: true,
          }),
        },
      ]);
    try {
      const events = await overlayCompletedExecutionStepOutcomes(
        "thread",
        "turn",
        [
          {
            type: "tool_start",
            id: "private-call",
            tool: "write",
            input: {},
            omitFromPersistedHistory: true,
          },
        ],
      );
      expect(events.at(-1)).toMatchObject({
        type: "tool_done",
        completedSideEffect: true,
        omitFromPersistedHistory: true,
      });
    } finally {
      steps.mockRestore();
    }
  });

  it.each([
    [
      "an unfinished private call",
      [
        {
          type: "tool_start" as const,
          id: "private-call",
          tool: "write",
          input: {},
          omitFromPersistedHistory: true as const,
        },
      ],
    ],
    [
      "a private call whose outcome is unknown",
      [
        {
          type: "tool_start" as const,
          id: "private-call",
          tool: "write",
          input: {},
          omitFromPersistedHistory: true as const,
        },
        {
          type: "tool_done" as const,
          id: "private-call",
          tool: "write",
          input: {},
          result: "[Private content omitted]",
          isError: true,
          outcomeUnknown: true as const,
          omitFromPersistedHistory: true as const,
        },
      ],
    ],
    [
      "a failed private call with no side-effect status",
      [
        {
          type: "tool_start" as const,
          id: "private-call",
          tool: "write",
          input: {},
          omitFromPersistedHistory: true as const,
        },
        {
          type: "tool_done" as const,
          id: "private-call",
          tool: "write",
          input: {},
          result: "[Private content omitted]",
          isError: true,
          omitFromPersistedHistory: true as const,
        },
      ],
    ],
  ])("refuses to resume %s", async (_label, events) => {
    const read = vi
      .spyOn(runStore, "getCurrentTurnEventsForThread")
      .mockResolvedValue(events);
    try {
      expect(
        await loadPriorTurnToolCallJournal("thread", "turn"),
      ).toMatchObject({
        status: "unreadable",
        code: "private_history_unrecoverable",
      });
    } finally {
      read.mockRestore();
    }
  });

  it("resumes a private approval pause followed by the approved private execution", async () => {
    const read = vi
      .spyOn(runStore, "getCurrentTurnEventsForThread")
      .mockResolvedValue([
        {
          type: "tool_start",
          id: "approval-call",
          tool: "write",
          input: {},
          omitFromPersistedHistory: true,
        },
        {
          type: "tool_done",
          id: "approval-call",
          tool: "write",
          input: {},
          result: "[Private content omitted]",
          approvalPause: true,
          completedSideEffect: false,
          omitFromPersistedHistory: true,
        },
        {
          type: "tool_start",
          id: "approval-call",
          tool: "write",
          input: {},
          omitFromPersistedHistory: true,
        },
        {
          type: "tool_done",
          id: "approval-call",
          tool: "write",
          input: {},
          result: "[Private content omitted]",
          completedSideEffect: true,
          privateReplayIdentity: SYNTHETIC_PRIVATE_REPLAY_IDENTITY,
          omitFromPersistedHistory: true,
        },
      ]);
    try {
      expect(
        await loadPriorTurnToolCallJournal("thread", "turn"),
      ).toMatchObject({
        status: "read",
      });
    } finally {
      read.mockRestore();
    }
  });

  it("refuses to resume an interrupted private tool or unknown private outcome", async () => {
    for (const events of [
      [
        {
          type: "tool_start" as const,
          id: "interrupted-private-call",
          tool: "write",
          input: {},
          omitFromPersistedHistory: true as const,
        },
      ],
      [
        {
          type: "tool_start" as const,
          id: "unknown-private-call",
          tool: "write",
          input: {},
          omitFromPersistedHistory: true as const,
        },
        {
          type: "tool_done" as const,
          id: "unknown-private-call",
          tool: "write",
          input: {},
          result: "[Private content omitted]",
          outcomeUnknown: true as const,
          omitFromPersistedHistory: true as const,
        },
      ],
    ]) {
      const read = vi
        .spyOn(runStore, "getCurrentTurnEventsForThread")
        .mockResolvedValue(events);
      try {
        expect(
          await loadPriorTurnToolCallJournal("thread", "turn"),
        ).toMatchObject({
          status: "unreadable",
          code: "private_history_unrecoverable",
        });
      } finally {
        read.mockRestore();
      }
    }
  });
});

it("resumes a matched private approval pause that did not execute", async () => {
  const read = vi
    .spyOn(runStore, "getCurrentTurnEventsForThread")
    .mockResolvedValue([
      {
        type: "tool_start",
        id: "approval-call",
        tool: "write",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "approval-call",
        tool: "write",
        input: {},
        result: "[Private content omitted]",
        approvalPause: true,
        completedSideEffect: false,
        omitFromPersistedHistory: true,
      },
    ]);
  try {
    expect(await loadPriorTurnToolCallJournal("thread", "turn")).toMatchObject({
      status: "read",
    });
  } finally {
    read.mockRestore();
  }
});

it("continues to read a public prior tool journal", async () => {
  const read = vi
    .spyOn(runStore, "getCurrentTurnEventsForThread")
    .mockResolvedValue([
      {
        type: "tool_start",
        id: "public-call",
        tool: "write",
        input: { id: "public" },
      },
      {
        type: "tool_done",
        id: "public-call",
        tool: "write",
        input: { id: "public" },
        result: "done",
        completedSideEffect: true,
      },
    ]);
  try {
    expect(await loadPriorTurnToolCallJournal("thread", "turn")).toMatchObject({
      status: "read",
    });
  } finally {
    read.mockRestore();
  }
});

it("finishes a resumed private turn without repeating its write", async () => {
  const read = vi
    .spyOn(runStore, "getCurrentTurnEventsForThread")
    .mockResolvedValue([
      {
        type: "tool_start",
        id: "earlier-call",
        tool: "write",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "earlier-call",
        tool: "write",
        input: {},
        result: "[Private content omitted]",
        completedSideEffect: true,
        omitFromPersistedHistory: true,
      },
    ]);
  const { runAgentLoop } = await import("../production-agent.js");
  const { z } = await import("zod");
  const run = vi.fn(async () => "saved");
  const events: import("../types.js").AgentChatEvent[] = [];
  const engine: import("./types.js").AgentEngine = {
    name: "synthetic",
    label: "Synthetic",
    defaultModel: "synthetic",
    supportedModels: ["synthetic"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream() {
      streams += 1;
      if (streams > 1) {
        yield { type: "text-delta" as const, text: "Saved your draft." };
        yield {
          type: "assistant-content" as const,
          parts: [{ type: "text" as const, text: "Saved your draft." }],
        };
        yield { type: "stop" as const, reason: "end_turn" as const };
        return;
      }
      yield {
        type: "assistant-content" as const,
        parts: [
          {
            type: "tool-call" as const,
            id: "new-call",
            name: "write",
            input: { text: "synthetic" },
          },
        ],
      };
      yield { type: "stop" as const, reason: "tool_use" as const };
    },
  };
  let streams = 0;
  try {
    await runAgentLoop({
      engine,
      model: "synthetic",
      systemPrompt: "synthetic",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "new checkpoint" }] },
      ],
      actions: {
        write: {
          schema: z.object({ text: z.string() }),
          tool: {
            description: "Synthetic write",
            parameters: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
          readOnly: false,
          persistInChatHistory: false,
          run,
        },
      },
      threadId: "thread",
      turnId: "same-turn",
      historyPrivacyState: { private: true, recorded: true },
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    });
    expect(run).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_done",
          id: "new-call",
          notExecuted: true,
          completedSideEffect: false,
        }),
        expect.objectContaining({ type: "text", text: "Saved your draft." }),
      ]),
    );
    expect(events.some((event) => event.type === "error")).toBe(false);
  } finally {
    read.mockRestore();
  }
});

it("skips execution-step overlay lookups for already-completed private tool calls", async () => {
  const read = vi
    .spyOn(runStore, "getCurrentTurnEventsForThread")
    .mockResolvedValue([
      {
        type: "tool_start",
        id: "private-done-call",
        tool: "create-draft",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "private-done-call",
        tool: "create-draft",
        input: {},
        result: "[Private content omitted]",
        completedSideEffect: true,
        omitFromPersistedHistory: true,
      },
    ]);
  const getCompleted = vi
    .spyOn(runStore, "getCompletedAgentExecutionSteps")
    .mockResolvedValue(new Map());
  try {
    const result = await loadPriorTurnToolCallJournal("thread", "turn", {
      recoverCompletedExecutionSteps: true,
    });
    expect(result).toMatchObject({ status: "read" });
    expect(getCompleted).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
    getCompleted.mockRestore();
  }
});

it("rejects duplicate completion for a non-approval private tool id while allowing approval pause followed by completion", async () => {
  const duplicateRead = vi
    .spyOn(runStore, "getCurrentTurnEventsForThread")
    .mockResolvedValue([
      {
        type: "tool_start",
        id: "dup-private",
        tool: "create-draft",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "dup-private",
        tool: "create-draft",
        input: {},
        result: "[Private content omitted]",
        completedSideEffect: true,
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_start",
        id: "dup-private",
        tool: "create-draft",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "dup-private",
        tool: "create-draft",
        input: {},
        result: "[Private content omitted]",
        completedSideEffect: true,
        omitFromPersistedHistory: true,
      },
    ]);
  try {
    expect(await loadPriorTurnToolCallJournal("thread", "turn")).toMatchObject({
      status: "unreadable",
      code: "private_history_unrecoverable",
    });
  } finally {
    duplicateRead.mockRestore();
  }

  const approvedRead = vi
    .spyOn(runStore, "getCurrentTurnEventsForThread")
    .mockResolvedValue([
      {
        type: "tool_start",
        id: "approved-private",
        tool: "create-draft",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "approved-private",
        tool: "create-draft",
        input: {},
        result: "[Private content omitted]",
        approvalPause: true,
        completedSideEffect: false,
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_start",
        id: "approved-private",
        tool: "create-draft",
        input: {},
        omitFromPersistedHistory: true,
      },
      {
        type: "tool_done",
        id: "approved-private",
        tool: "create-draft",
        input: {},
        result: "[Private content omitted]",
        completedSideEffect: true,
        omitFromPersistedHistory: true,
      },
    ]);
  try {
    expect(await loadPriorTurnToolCallJournal("thread", "turn")).toMatchObject({
      status: "read",
    });
  } finally {
    approvedRead.mockRestore();
  }
});
