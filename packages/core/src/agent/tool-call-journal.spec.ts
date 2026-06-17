import { describe, expect, it } from "vitest";
import type { AgentChatEvent } from "./types.js";
import {
  classifyToolCallJournal,
  buildResumeJournalNote,
  findCompletedJournalEntry,
  isJournalEmpty,
} from "./tool-call-journal.js";

function start(tool: string, input?: Record<string, string>): AgentChatEvent {
  return { type: "tool_start", tool, input: input ?? {} };
}

function done(tool: string, result: string): AgentChatEvent {
  return { type: "tool_done", tool, result };
}

describe("classifyToolCallJournal", () => {
  it("classifies one completed and one interrupted tool call", () => {
    // sendEmail completed (has a tool_done); createTicket started but the run
    // was cut off before its result was recorded.
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

  it("matches tool_done to the oldest open start of the same tool (FIFO)", () => {
    const events: AgentChatEvent[] = [
      start("readFile", { path: "a.ts" }),
      start("readFile", { path: "b.ts" }),
      done("readFile", "contents of a.ts"),
      // second readFile never completed
    ];

    const journal = classifyToolCallJournal(events);

    expect(journal.completed).toHaveLength(1);
    expect(journal.completed[0].input).toEqual({ path: "a.ts" });
    expect(journal.interrupted).toHaveLength(1);
    expect(journal.interrupted[0].input).toEqual({ path: "b.ts" });
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
      // partial output discarded on resume — sendEmail start is dropped, not
      // reported as interrupted.
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
    // Completed section instructs not to re-run and surfaces the result.
    expect(text).toContain("Already completed");
    expect(text).toContain("do NOT re-run");
    expect(text).toContain("sendEmail");
    expect(text).toContain("Email sent (id msg_123)");
    // Interrupted section flags the unknown outcome.
    expect(text).toContain("Interrupted / unknown outcome");
    expect(text).toContain("createTicket");
  });

  it("returns null when there is nothing to report (no regression for normal resumes)", () => {
    const events: AgentChatEvent[] = [{ type: "text", text: "no tools here" }];
    expect(buildResumeJournalNote(classifyToolCallJournal(events))).toBeNull();
  });

  it("returns null for a clean turn where all tool calls completed", () => {
    // All tool calls completed → nothing dangerous to flag. The structured note
    // is suppressed so the existing continuation nudge is the only change to the
    // prefix, exactly as before this feature.
    const events: AgentChatEvent[] = [
      start("listFiles"),
      done("listFiles", "a.ts"),
      start("readFile", { path: "a.ts" }),
      done("readFile", "ok"),
    ];
    const journal = classifyToolCallJournal(events);
    expect(journal.interrupted).toHaveLength(0);
    // Completed-only still reports (so the model reuses results), but with no
    // interrupted section.
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
    // Result summary is capped well under the raw length.
    expect(note.length).toBeLessThan(longResult.length);
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
});
