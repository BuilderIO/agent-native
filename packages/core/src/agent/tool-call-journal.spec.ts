import { describe, expect, it } from "vitest";

import { stripInlineBytes } from "../shared/inline-bytes.js";
import {
  classifyToolCallJournal,
  buildResumeJournalNote,
  findCompletedJournalEntry,
  isJournalEmpty,
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

it("includes own __proto__ JSON keys in replay identity", () => {
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
  expect(
    findCompletedJournalEntry(journal, "send-report", second),
  ).toBeUndefined();
  expect(findCompletedJournalEntry(journal, "send-report", first)?.result).toBe(
    "A sent",
  );
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
    expect(
      findCompletedJournalEntry(journal, "sendEmail", inputA),
    ).toBeUndefined();
    expect(
      findCompletedJournalEntry(journal, "sendEmail", inputB)?.result,
    ).toBe("B sent");
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
    expect(
      findCompletedJournalEntry(journal, "sendEmail", inputA),
    ).toBeUndefined();
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
        result: "A sent",
      },
    ]);
    expect(findCompletedJournalEntry(journal, "sendEmail", input)?.result).toBe(
      "A sent",
    );
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

  it("drops not-yet-completed starts on a clear event (discarded partial output)", () => {
    const events: AgentChatEvent[] = [
      start("sendEmail", { to: "a@example.com" }),
      { type: "clear" },
      start("sendEmail", { to: "a@example.com" }),
      done("sendEmail", "sent"),
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed).toHaveLength(1);
    expect(journal.interrupted).toHaveLength(0);
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

describe("findCompletedJournalEntry", () => {
  it("matches completed entries by tool and input, and consumes each match once", () => {
    const journal = classifyToolCallJournal([
      start("sendEmail", { to: "a@example.com" }),
      done("sendEmail", "sent A"),
      start("sendEmail", { to: "b@example.com" }),
      done("sendEmail", "sent B"),
    ]);
    const consumed = new Set<string>();

    const first = findCompletedJournalEntry(
      journal,
      "sendEmail",
      { to: "a@example.com" },
      consumed,
    );
    expect(first?.result).toBe("sent A");
    expect(
      findCompletedJournalEntry(
        journal,
        "sendEmail",
        { to: "a@example.com" },
        consumed,
      ),
    ).toBeUndefined();

    expect(
      findCompletedJournalEntry(
        journal,
        "sendEmail",
        { to: "b@example.com" },
        consumed,
      )?.result,
    ).toBe("sent B");
    expect(
      findCompletedJournalEntry(
        journal,
        "sendEmail",
        { to: "c@example.com" },
        consumed,
      ),
    ).toBeUndefined();
  });

  it("matches nested inputs regardless of object key insertion order", () => {
    const journal = classifyToolCallJournal([
      start("save-card", {
        id: "card-1",
        fields: { title: "Launch", priority: "high" },
      }),
      done("save-card", "saved"),
    ]);

    expect(
      findCompletedJournalEntry(journal, "save-card", {
        fields: { priority: "high", title: "Launch" },
        id: "card-1",
      })?.result,
    ).toBe("saved");
  });

  it("does not match a tool call whose prior journal entry was an error", () => {
    const journal = classifyToolCallJournal([
      start("add-slide", { deckId: "deck-1", layout: "content" }),
      done("add-slide", "Error running add-slide: Run aborted", {
        isError: true,
      }),
    ]);

    expect(
      findCompletedJournalEntry(journal, "add-slide", {
        deckId: "deck-1",
        layout: "content",
      }),
    ).toBeUndefined();
  });

  it("does not match different long inputs that share a truncated prefix", () => {
    const sharedPrefix = "<section>".repeat(30);
    const journal = classifyToolCallJournal([
      start("add-slide", {
        deckId: "deck-1",
        html: `${sharedPrefix}<h1>First slide</h1>`,
      }),
      done("add-slide", "slide added"),
    ]);

    expect(
      findCompletedJournalEntry(journal, "add-slide", {
        deckId: "deck-1",
        html: `${sharedPrefix}<h1>Second slide</h1>`,
      }),
    ).toBeUndefined();
  });
});
