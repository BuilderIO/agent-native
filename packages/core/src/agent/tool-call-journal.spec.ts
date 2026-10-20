import { describe, expect, it } from "vitest";

import { actionArgumentsHash } from "../action-arguments-identity.js";
import { stripInlineBytes } from "../shared/inline-bytes.js";
import type { EngineMessage } from "./engine/types.js";
import {
  classifyToolCallJournal,
  buildResumeJournalNote,
  findReplayableJournalEntry,
  isJournalEmpty,
  journalEntriesRepresentedInHistory,
  journalCallEffects,
  journalCallIdentities,
  toolCallInputFingerprint,
} from "./tool-call-journal.js";
import type { AgentChatEvent, AgentToolInput } from "./types.js";

function start(tool: string, input?: AgentToolInput): AgentChatEvent {
  return { type: "tool_start", tool, input: input ?? {} };
}

function done(
  tool: string,
  result: string,
  options?: {
    input?: AgentToolInput;
    isError?: boolean;
    completedSideEffect?: boolean;
    replayed?: true;
  },
): AgentChatEvent {
  return { type: "tool_done", tool, result, ...options };
}

it("includes own __proto__ JSON keys in a call's fingerprint", () => {
  const first = JSON.parse(
    '{"__proto__":{"destination":"a"},"attachments":[{"type":"file","data":"QQ=="}]}',
  );
  const second = JSON.parse(
    '{"__proto__":{"destination":"b"},"attachments":[{"type":"file","data":"QQ=="}]}',
  );
  expect(toolCallInputFingerprint(first)).not.toBe(
    toolCallInputFingerprint(second),
  );
  const journal = classifyToolCallJournal([
    start("send-report", first),
    done("send-report", "A sent", { input: first }),
  ]);
  expect(journal.completed).toEqual([
    expect.objectContaining({ tool: "send-report", result: "A sent" }),
  ]);
  expect(toolCallInputFingerprint(journal.completed[0]!.input)).toBe(
    toolCallInputFingerprint(first),
  );
});

it("does not erase contradictory own JSON keys while normalizing redacted receipts", () => {
  const first = JSON.parse(
    '{"__proto__":{"destination":"a"},"attachments":[{"type":"file","omitted":"inline-bytes"}]}',
  );
  const second = JSON.parse(
    '{"__proto__":{"destination":"b"},"attachments":[{"type":"file","omitted":"inline-bytes"}]}',
  );
  const fingerprint = toolCallInputFingerprint(
    JSON.parse(
      '{"__proto__":{"destination":"a"},"attachments":[{"type":"file","data":"QQ=="}]}',
    ),
  );
  const journal = classifyToolCallJournal([
    {
      type: "tool_start",
      tool: "send-report",
      id: "call-a",
      input: first,
      inputFingerprint: fingerprint,
      inputStoredFingerprint: toolCallInputFingerprint(first),
    },
    {
      type: "tool_done",
      tool: "send-report",
      id: "call-a",
      input: second,
      inputFingerprint: fingerprint,
      inputStoredFingerprint: toolCallInputFingerprint(second),
      result: "B sent",
    },
  ]);
  expect(journal.completed).toHaveLength(0);
  expect(journal.interrupted).toHaveLength(1);
});

describe("classifyToolCallJournal", () => {
  it("classifies one completed and one interrupted tool call", () => {
    const events: AgentChatEvent[] = [
      start("sendEmail", { to: "a@example.com" }),
      done("sendEmail", "Email sent to a@example.com (id msg_123)"),
      start("createTicket", { title: "Bug" }),
      // no matching tool_done for createTicket — interrupted
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed).toHaveLength(1);
    expect(journal.completed[0].tool).toBe("sendEmail");
    expect(journal.completed[0].result).toContain("Email sent");

    expect(journal.interrupted).toHaveLength(1);
    expect(journal.interrupted[0].tool).toBe("createTicket");
    expect(journal.interrupted[0].result).toBeUndefined();

    expect(isJournalEmpty(journal)).toBe(false);
  });

  it("keeps concurrent calls unknown when a receipt has no call identity", () => {
    const events: AgentChatEvent[] = [
      start("readFile", { path: "a.ts" }),
      start("readFile", { path: "b.ts" }),
      done("readFile", "contents of a.ts"),
      // second readFile never completed
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted.map((entry) => entry.input)).toEqual([
      { path: "a.ts" },
      { path: "b.ts" },
    ]);
  });

  it("associates an inputless receipt with its call ID instead of an earlier call", () => {
    const inputA = { to: "a@example.com" };
    const inputB = { to: "b@example.com" };
    const journal = classifyToolCallJournal([
      { type: "tool_start", tool: "sendEmail", id: "call-a", input: inputA },
      { type: "tool_start", tool: "sendEmail", id: "call-b", input: inputB },
      { type: "tool_done", tool: "sendEmail", id: "call-b", result: "B sent" },
    ]);
    expect(journal.completed).toEqual([
      expect.objectContaining({
        id: "call-b",
        input: inputB,
        result: "B sent",
      }),
    ]);
    expect(journal.interrupted.map((entry) => entry.input)).toEqual([inputA]);
  });

  it("does not assign a receipt for another ID to the only pending call", () => {
    const journal = classifyToolCallJournal([
      {
        type: "tool_start",
        tool: "sendEmail",
        id: "call-a",
        input: { to: "a@example.com" },
      },
      { type: "tool_done", tool: "sendEmail", id: "call-b", result: "B sent" },
    ]);
    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(1);
  });

  it("does not fall back to another call when the receipt input differs", () => {
    const journal = classifyToolCallJournal([
      start("sendEmail", { to: "a@example.com" }),
      done("sendEmail", "B sent", { input: { to: "b@example.com" } }),
    ]);
    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(1);
  });

  it("keeps contradictory call and input identities unknown", () => {
    const journal = classifyToolCallJournal([
      {
        type: "tool_start",
        tool: "sendEmail",
        id: "call-a",
        input: { to: "a@example.com" },
      },
      {
        type: "tool_start",
        tool: "sendEmail",
        id: "call-b",
        input: { to: "b@example.com" },
      },
      {
        type: "tool_done",
        tool: "sendEmail",
        id: "call-a",
        inputFingerprint: toolCallInputFingerprint({ to: "b@example.com" }),
        result: "B sent",
      },
    ]);
    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(2);
  });

  it("rejects a receipt whose input contradicts its matching ID and fingerprint", () => {
    const inputA = { to: "a@example.com" };
    const inputB = { to: "b@example.com" };
    const journal = classifyToolCallJournal([
      { type: "tool_start", tool: "sendEmail", id: "call-a", input: inputA },
      { type: "tool_start", tool: "sendEmail", id: "call-b", input: inputB },
      {
        type: "tool_done",
        tool: "sendEmail",
        id: "call-a",
        input: inputB,
        inputFingerprint: toolCallInputFingerprint(inputA),
        result: "B sent",
      },
    ]);
    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(2);
  });

  it("does not certify an inconsistent start with an inputless receipt", () => {
    const journal = classifyToolCallJournal([
      {
        type: "tool_start",
        tool: "sendEmail",
        input: { to: "a@example.com" },
        inputFingerprint: toolCallInputFingerprint({ to: "b@example.com" }),
      },
      { type: "tool_done", tool: "sendEmail", result: "sent" },
    ]);
    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(1);
  });

  it("rejects contradictory visible arguments even when both inputs were redacted", () => {
    const fingerprint = toolCallInputFingerprint({
      to: "a@example.com",
      attachments: [{ type: "file", data: "QQ==" }],
    });
    const journal = classifyToolCallJournal([
      {
        type: "tool_start",
        tool: "sendEmail",
        id: "call-a",
        input: {
          to: "a@example.com",
          attachments: [{ type: "file", omitted: "inline-bytes" }],
        },
        inputFingerprint: fingerprint,
        inputStoredFingerprint: toolCallInputFingerprint({
          to: "a@example.com",
          attachments: [{ type: "file", omitted: "inline-bytes" }],
        }),
      },
      {
        type: "tool_done",
        tool: "sendEmail",
        id: "call-a",
        input: {
          to: "b@example.com",
          attachments: [{ type: "file", omitted: "inline-bytes" }],
        },
        inputFingerprint: fingerprint,
        inputStoredFingerprint: toolCallInputFingerprint({
          to: "b@example.com",
          attachments: [{ type: "file", omitted: "inline-bytes" }],
        }),
        result: "B sent",
      },
    ]);
    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(1);
  });

  it("matches a fingerprinted redacted receipt to a legacy original-input start", () => {
    const input = {
      to: "a@example.com",
      attachments: [{ type: "file", data: "QQ==" }],
    };
    const journal = classifyToolCallJournal([
      { type: "tool_start", tool: "sendEmail", id: "call-a", input },
      {
        type: "tool_done",
        tool: "sendEmail",
        id: "call-a",
        input: stripInlineBytes(input, "placeholder"),
        inputFingerprint: toolCallInputFingerprint(input),
        inputStoredFingerprint: toolCallInputFingerprint(
          stripInlineBytes(input, "placeholder"),
        ),
        result: "A sent",
      },
    ]);
    expect(journal.completed).toEqual([
      expect.objectContaining({ id: "call-a", input, result: "A sent" }),
    ]);
    expect(journal.interrupted).toHaveLength(0);
  });

  it("keeps duplicate call IDs unknown when their receipt omits input", () => {
    const journal = classifyToolCallJournal([
      {
        type: "tool_start",
        tool: "sendEmail",
        id: "call-a",
        input: { to: "a@example.com" },
      },
      {
        type: "tool_start",
        tool: "sendEmail",
        id: "call-a",
        input: { to: "b@example.com" },
      },
      { type: "tool_done", tool: "sendEmail", id: "call-a", result: "sent" },
    ]);
    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(2);
  });

  it("does not choose between concurrent IDless invocations with identical arguments", () => {
    const input = { to: "a@example.com" };
    const journal = classifyToolCallJournal([
      start("sendEmail", input),
      start("sendEmail", input),
      done("sendEmail", "sent", { input }),
    ]);
    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(2);
  });

  it("matches a raw legacy receipt to a fingerprinted stripped start", () => {
    const input = {
      to: "a@example.com",
      attachments: [{ type: "file", data: "QQ==", fileId: "fixture-file" }],
    };
    const stored = stripInlineBytes(input, "placeholder");
    const journal = classifyToolCallJournal([
      {
        type: "tool_start",
        tool: "sendEmail",
        id: "call-a",
        input: stored,
        inputFingerprint: toolCallInputFingerprint(input),
        inputStoredFingerprint: toolCallInputFingerprint(stored),
      },
      {
        type: "tool_done",
        tool: "sendEmail",
        id: "call-a",
        input,
        result: "sent",
      },
    ]);
    expect(journal.completed).toEqual([
      expect.objectContaining({
        id: "call-a",
        inputFingerprint: toolCallInputFingerprint(input),
        result: "sent",
      }),
    ]);
    expect(journal.interrupted).toHaveLength(0);
  });

  it("uses tool_done input to match the correct same-name start when available", () => {
    const events: AgentChatEvent[] = [
      start("readFile", { path: "a.ts" }),
      start("readFile", { path: "b.ts" }),
      done("readFile", "contents of b.ts", { input: { path: "b.ts" } }),
      // a.ts never completed
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed).toHaveLength(1);
    expect(journal.completed[0].input).toEqual({ path: "b.ts" });
    expect(journal.completed[0].result).toBe("contents of b.ts");
    expect(journal.interrupted).toHaveLength(1);
    expect(journal.interrupted[0].input).toEqual({ path: "a.ts" });
  });

  it("preserves valid artifact receipts and filters malformed persisted elements", () => {
    const events: AgentChatEvent[] = [
      start("generate-asset", { prompt: "cover" }),
      {
        type: "tool_done",
        tool: "generate-asset",
        result: "...[truncated]",
        artifacts: [
          { kind: "image", id: "asset-1", url: "/asset/asset-1" },
          null,
          {},
        ],
      } as unknown as AgentChatEvent,
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed[0].artifacts).toEqual([
      { kind: "image", id: "asset-1", url: "/asset/asset-1" },
    ]);
  });

  it("treats all tool calls as completed when every start has a done", () => {
    const events: AgentChatEvent[] = [
      { type: "text", text: "working on it" },
      start("listFiles"),
      done("listFiles", "a.ts\nb.ts"),
      start("readFile", { path: "a.ts" }),
      done("readFile", "ok"),
      { type: "text", text: "done" },
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed).toHaveLength(2);
    expect(journal.interrupted).toHaveLength(0);
  });

  it("returns an empty journal for a turn with no tool calls", () => {
    const events: AgentChatEvent[] = [
      { type: "text", text: "hello" },
      { type: "thinking", text: "considering" },
      { type: "text", text: "world" },
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(0);
    expect(isJournalEmpty(journal)).toBe(true);
  });

  it("preserves unknown outcomes across a draft clear until a matching result", () => {
    const events: AgentChatEvent[] = [
      start("sendEmail", { to: "a@example.com" }),
      { type: "clear" },
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(1);
    expect(journal.interrupted[0]?.tool).toBe("sendEmail");

    const settled = classifyToolCallJournal([
      ...events,
      done("sendEmail", "sent"),
    ]);
    expect(settled.completed).toHaveLength(1);
    expect(settled.interrupted).toHaveLength(0);
  });

  it("ignores a tool_done with no matching open start", () => {
    const events: AgentChatEvent[] = [done("ghost", "result with no start")];
    const journal = classifyToolCallJournal(events);
    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(0);
  });

  it("does not classify failed tool_done events as completed writes", () => {
    const events: AgentChatEvent[] = [
      start("add-slide", { deckId: "deck-1", layout: "content" }),
      done("add-slide", "Error running add-slide: Run aborted", {
        isError: true,
      }),
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(0);
  });

  it.each([
    JSON.stringify({
      id: "fixture-ticket",
      title: "Previous step did NOT execute",
    }),
    "Skipped old entries; created fixture-ticket",
    "Awaiting human approval was the prior state; created fixture-ticket",
  ])(
    "retains explicit completed receipts regardless of result prose: %s",
    (result) => {
      const input = { title: "Previous step did NOT execute" };
      for (const outcome of [
        { completedSideEffect: true },
        { isError: false },
      ]) {
        const journal = classifyToolCallJournal([
          { type: "tool_start", tool: "open-ticket", id: "call-1", input },
          {
            type: "tool_done",
            tool: "open-ticket",
            id: "call-1",
            input,
            result,
            ...outcome,
          },
        ]);
        expect(journal.completed).toEqual([
          expect.objectContaining({ id: "call-1", input, result }),
        ]);
        expect(journal.interrupted).toHaveLength(0);
      }
    },
  );

  it("keeps a call that failed after its side effect completed as completed, with its failure", () => {
    const input = { title: "fixture" };
    const result =
      'Error running open-ticket: "open-ticket" returned a result that does not match its declared output contract. Its changes are already applied: do not retry it.';
    const journal = classifyToolCallJournal([
      start("open-ticket", input),
      done("open-ticket", result, {
        input,
        isError: true,
        completedSideEffect: true,
      }),
    ]);
    expect(journal.completed).toHaveLength(1);
    expect(journal.completed[0]).toMatchObject({ result, isError: true });
    expect(journal.interrupted).toHaveLength(0);
    expect(buildResumeJournalNote(journal)).toContain(
      "failed after its changes were saved",
    );
  });

  it.each([
    { completedSideEffect: false, isError: true },
    { completedSideEffect: false, isError: false },
    { completedSideEffect: true, replayed: true as const },
  ])(
    "keeps explicit failed, skipped, and replayed outcomes out of new completion evidence: %j",
    (outcome) => {
      const input = { title: "fixture" };
      const journal = classifyToolCallJournal([
        start("open-ticket", input),
        {
          type: "tool_done",
          tool: "open-ticket",
          input,
          result: "fixture result",
          ...outcome,
        },
      ]);
      expect(journal.completed).toHaveLength(0);
      expect(journal.interrupted).toHaveLength(0);
    },
  );

  it("does not classify legacy blocked tool_done text as completed writes", () => {
    const events: AgentChatEvent[] = [
      start("add-slide", { deckId: "deck-1", layout: "content" }),
      done(
        "add-slide",
        "Plan mode blocked `add-slide`. Switch to Act mode after the user approves the plan, then retry the action.",
      ),
      start("update-slide", { slideId: "slide-1" }),
      done("update-slide", 'Error: Unknown tool "update-slide"'),
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(0);
  });

  it("does not classify explicitly skipped tool_done events as completed writes", () => {
    const events: AgentChatEvent[] = [
      start("add-slide", { deckId: "deck-1", layout: "content" }),
      done(
        "add-slide",
        "Skipped add-slide because the call was blocked by a guard.",
        { completedSideEffect: false },
      ),
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed).toHaveLength(0);
    expect(journal.interrupted).toHaveLength(0);
  });

  it("keeps replay provenance out of the completed side-effect journal", () => {
    const events: AgentChatEvent[] = [
      start("sendEmail", { to: "a@example.com" }),
      done("sendEmail", "(Already completed) Email sent", {
        completedSideEffect: true,
        replayed: true,
      }),
    ];

    expect(classifyToolCallJournal(events).completed).toHaveLength(0);
  });
});

describe("buildResumeJournalNote", () => {
  it("lists completed (don't re-run) and interrupted/unknown tool calls", () => {
    const events: AgentChatEvent[] = [
      start("sendEmail", { to: "a@example.com" }),
      done("sendEmail", "Email sent (id msg_123)"),
      start("createTicket", { title: "Bug" }),
    ];

    const note = buildResumeJournalNote(classifyToolCallJournal(events));

    expect(note).not.toBeNull();
    const text = note as string;
    expect(text).toContain("Already completed");
    expect(text).toContain("do NOT re-run");
    expect(text).toContain("sendEmail");
    expect(text).toContain("Email sent (id msg_123)");
    expect(text).toContain("Interrupted / unknown outcome");
    expect(text).toContain("createTicket");
  });

  it("returns null when there is nothing to report (no regression for normal resumes)", () => {
    const events: AgentChatEvent[] = [{ type: "text", text: "no tools here" }];
    expect(buildResumeJournalNote(classifyToolCallJournal(events))).toBeNull();
  });

  it("returns null for a clean turn where all tool calls completed", () => {
    const events: AgentChatEvent[] = [
      start("listFiles"),
      done("listFiles", "a.ts"),
      start("readFile", { path: "a.ts" }),
      done("readFile", "ok"),
    ];
    const journal = classifyToolCallJournal(events);
    expect(journal.interrupted).toHaveLength(0);
    const note = buildResumeJournalNote(journal);
    expect(note).toContain("Already completed");
    expect(note).not.toContain("Interrupted / unknown outcome");
  });

  it("truncates very long results in the summary", () => {
    const longResult = "x".repeat(2000);
    const events: AgentChatEvent[] = [
      start("bigRead"),
      done("bigRead", longResult),
    ];
    const note = buildResumeJournalNote(classifyToolCallJournal(events)) ?? "";
    expect(note).toContain("…");
    expect(note.length).toBeLessThan(longResult.length);
  });

  it("keeps nextRequiredAction visible when the tool result summary is truncated", () => {
    const result = JSON.stringify({
      designId: "design-1",
      files: [
        {
          id: "file-1",
          content: "x".repeat(2000),
        },
      ],
      nextRequiredAction:
        "Call edit-design exactly once with designId design-1 and fileId file-1. Do not call get-design-snapshot again.",
    });
    const events: AgentChatEvent[] = [
      start("get-design-snapshot", {
        designId: "design-1",
        fileId: "file-1",
      }),
      done("get-design-snapshot", result),
    ];

    const note = buildResumeJournalNote(classifyToolCallJournal(events)) ?? "";

    expect(note).toContain("Next required action from result");
    expect(note).toContain("Call edit-design exactly once");
    expect(note).toContain("Do not call get-design-snapshot again");
    expect(note).toContain("…");
    expect(note.length).toBeLessThan(result.length);
  });
});

it("does not count a call that failed before any effect as completed", () => {
  const journal = classifyToolCallJournal([
    start("add-slide", { deckId: "deck-1", layout: "content" }),
    done("add-slide", "Error running add-slide: Run aborted", {
      isError: true,
    }),
  ]);
  expect(journal).toEqual({ completed: [], interrupted: [] });
});

describe("recorded call effects", () => {
  const events: AgentChatEvent[] = [
    { type: "tool_start", id: "read", tool: "read-draft", input: {} },
    {
      type: "tool_done",
      id: "read",
      tool: "read-draft",
      input: {},
      result: "ok",
    },
    { type: "tool_start", id: "check", tool: "check-draft", input: {} },
    {
      type: "tool_done",
      id: "check",
      tool: "check-draft",
      input: {},
      result: "Saved, but the result broke its contract.",
      isError: true,
      completedSideEffect: true,
      argumentsHash: actionArgumentsHash({ mode: "check" }),
    },
    { type: "tool_start", id: "lost", tool: "check-draft", input: { x: 1 } },
    {
      type: "tool_done",
      id: "lost",
      tool: "check-draft",
      input: { x: 1 },
      result: "Tool call timed out after 1 seconds",
      isError: true,
      outcomeUnknown: true,
    },
    { type: "tool_start", id: "cut", tool: "read-draft", input: { x: 2 } },
    { type: "tool_start", id: "slow", tool: "read-draft", input: { x: 3 } },
    {
      type: "tool_done",
      id: "slow",
      tool: "read-draft",
      input: { x: 3 },
      result: "Tool call timed out after 1 seconds",
      isError: true,
      completedSideEffect: false,
    },
  ];

  it("names each call that recorded no effect, committed, or left an unknown outcome, by id", () => {
    expect(journalCallEffects(classifyToolCallJournal(events), events)).toEqual(
      new Map([
        ["slow", "none"],
        ["check", "committed"],
        ["lost", "unknown"],
      ]),
    );
  });

  it("names the identity each call recorded running with, by id", () => {
    expect(journalCallIdentities(events, [])).toEqual(
      new Map([["check", actionArgumentsHash({ mode: "check" })]]),
    );
  });

  it("names no identity for an id more than one call used", () => {
    const page = (id: string, n: number): AgentChatEvent[] => [
      { type: "tool_start", id, tool: "read", input: { page: n } },
      {
        type: "tool_done",
        id,
        tool: "read",
        input: { page: n },
        result: `page ${n}`,
        argumentsHash: actionArgumentsHash({ page: n }),
      },
    ];
    const call = (id: string): EngineMessage => ({
      role: "assistant",
      content: [{ type: "tool-call", id, name: "read", input: {} }],
    });
    // Repeated in the journal.
    expect(
      journalCallIdentities([...page("a", 1), ...page("a", 2)], [call("a")]),
    ).toEqual(new Map());
    // Repeated only in the history.
    expect(
      journalCallIdentities(
        [...page("a", 1), ...page("b", 2)],
        [call("a"), call("b"), call("a")],
      ),
    ).toEqual(new Map([["b", actionArgumentsHash({ page: 2 })]]));
    // Distinct ids keep theirs.
    expect(
      journalCallIdentities(
        [...page("a", 1), ...page("b", 2)],
        [call("a"), call("b")],
      ),
    ).toEqual(
      new Map([
        ["a", actionArgumentsHash({ page: 1 })],
        ["b", actionArgumentsHash({ page: 2 })],
      ]),
    );
  });

  it("replays only a committed call prepared to the same arguments, once", () => {
    const journal = classifyToolCallJournal(events);
    const hash = actionArgumentsHash({ mode: "check" });
    // An ordinary completion is never replayed, whatever the new call is.
    expect(
      findReplayableJournalEntry(journal, "read-draft", hash),
    ).toBeUndefined();
    // The same call as sent, prepared differently, runs fresh.
    expect(
      findReplayableJournalEntry(
        journal,
        "check-draft",
        actionArgumentsHash({ mode: "apply" }),
      ),
    ).toBeUndefined();
    const consumed = new Set<string>();
    expect(
      findReplayableJournalEntry(journal, "check-draft", hash, consumed),
    ).toMatchObject({ isError: true, committed: true, argumentsHash: hash });
    expect(
      findReplayableJournalEntry(journal, "check-draft", hash, consumed),
    ).toBeUndefined();
  });

  it("recognizes completed journal calls already represented in turn history", () => {
    const journal = classifyToolCallJournal([
      {
        type: "tool_start",
        id: "first-call",
        tool: "send",
        input: { message: "same" },
      },
      {
        type: "tool_done",
        id: "first-call",
        tool: "send",
        input: { message: "same" },
        result: "sent",
        completedSideEffect: true,
        argumentsHash: actionArgumentsHash({ message: "same" }),
      },
    ]);
    const history: EngineMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "first-call",
            name: "send",
            input: { message: "same" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "first-call",
            toolName: "send",
            toolInput: '{"message":"same"}',
            content: "sent",
          },
        ],
      },
    ];

    expect(journalEntriesRepresentedInHistory(journal, history)).toEqual(
      new Set([journal.completed[0]!.key]),
    );
    expect(
      journalEntriesRepresentedInHistory(journal, history.slice(0, 1)),
    ).toEqual(new Set());
  });

  it("replays a call sharing its id with another only for its own identity", () => {
    // Each entry's result and identity come from one tool_done.
    const journal = classifyToolCallJournal([
      { type: "tool_start", id: "same", tool: "send", input: { n: 1 } },
      {
        type: "tool_done",
        id: "same",
        tool: "send",
        input: { n: 1 },
        result: "sent 1",
        completedSideEffect: true,
        argumentsHash: actionArgumentsHash({ n: 1 }),
      },
      { type: "tool_start", id: "same", tool: "send", input: { n: 2 } },
      {
        type: "tool_done",
        id: "same",
        tool: "send",
        input: { n: 2 },
        result: "Error running send: refused",
        isError: true,
        completedSideEffect: false,
        argumentsHash: actionArgumentsHash({ n: 2 }),
      },
    ]);
    expect(
      findReplayableJournalEntry(
        journal,
        "send",
        actionArgumentsHash({ n: 2 }),
      ),
    ).toBeUndefined();
    expect(
      findReplayableJournalEntry(
        journal,
        "send",
        actionArgumentsHash({ n: 1 }),
      ),
    ).toMatchObject({ result: "sent 1" });
  });

  it("matches a call recorded without an identity by its raw input, for a write only", () => {
    const journal = classifyToolCallJournal([
      { type: "tool_start", id: "old", tool: "send", input: { to: "a" } },
      {
        type: "tool_done",
        id: "old",
        tool: "send",
        input: { to: "a" },
        result: "sent",
        completedSideEffect: true,
      },
    ]);
    const hash = actionArgumentsHash({ to: "a" });
    // Prepared as a read, or sent other input, it runs fresh.
    expect(findReplayableJournalEntry(journal, "send", hash)).toBeUndefined();
    expect(
      findReplayableJournalEntry(journal, "send", hash, undefined, {
        input: { to: "b" },
      }),
    ).toBeUndefined();
    const consumed = new Set<string>();
    expect(
      findReplayableJournalEntry(journal, "send", hash, consumed, {
        input: { to: "a" },
      }),
    ).toMatchObject({ result: "sent" });
    expect(
      findReplayableJournalEntry(journal, "send", hash, consumed, {
        input: { to: "a" },
      }),
    ).toBeUndefined();
  });
});
