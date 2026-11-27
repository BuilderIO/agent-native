import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({ completeText: vi.fn() }));
vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("./automation-model.js", () => ({
  isUnavailableEngineError: () => false,
  resolveTextAutomationModelSettings: vi.fn(),
}));

import type { EmailMessage } from "../../shared/types.js";
import {
  buildSummaryInput,
  messageText,
  parseSummaryReply,
  summaryMessages,
} from "./thread-summary.js";

function message(overrides: Partial<EmailMessage>): EmailMessage {
  return {
    id: "m1",
    threadId: "t1",
    from: { name: "Ana", email: "ana@example.com" },
    to: [{ name: "", email: "me@example.com" }],
    subject: "Launch plan",
    snippet: "",
    body: "",
    date: "2026-11-20T10:00:00.000Z",
    isRead: true,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: [],
    ...overrides,
  };
}

describe("messageText", () => {
  it("turns HTML into text without scripts, styles or entities", () => {
    expect(
      messageText(
        message({
          body: "<html><head><style>p{color:red}</style></head><body><p>Ship it&nbsp;Friday &amp; tell QA</p><script>alert(1)</script><div>Thanks<br>Ana</div></body></html>",
        }),
      ),
    ).toBe("Ship it Friday & tell QA\nThanks\nAna");
  });

  it("drops the quoted history a reply carries", () => {
    expect(
      messageText(
        message({
          body: [
            "Friday works.",
            "",
            "On Thu, Nov 19, 2026 at 9:00 AM Bo <bo@example.com>",
            "wrote:",
            "> Can we ship Friday?",
          ].join("\n"),
        }),
      ),
    ).toBe("Friday works.");
    expect(
      messageText(
        message({
          body: "Sounds good\n> earlier line\nMore of mine\n-----Original Message-----\nFrom: Bo",
        }),
      ),
    ).toBe("Sounds good\nMore of mine");
  });

  it("falls back to the snippet when a message has no body", () => {
    expect(messageText(message({ snippet: "Short note" }))).toBe("Short note");
  });
});

describe("buildSummaryInput", () => {
  it("leaves drafts out and orders messages oldest first", () => {
    const messages = summaryMessages([
      message({ id: "m2", date: "2026-11-21T10:00:00.000Z", body: "Second" }),
      message({ id: "d1", isDraft: true, body: "My unsent draft" }),
      message({ id: "m1", body: "First" }),
    ]);
    expect(messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    const input = buildSummaryInput(messages);
    expect(input).not.toContain("My unsent draft");
    expect(input.indexOf("First")).toBeLessThan(input.indexOf("Second"));
    expect(input).toContain("Subject: Launch plan");
    expect(input).toContain("From: Ana <ana@example.com>");
  });

  it("keeps the newest messages when a thread is too long", () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      message({
        id: `m${i}`,
        date: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
        body: `${"x".repeat(5_000)} body-${i}`,
      }),
    );
    const input = buildSummaryInput(messages);
    expect(input).toContain("body-11");
    expect(input).not.toContain("body-0");
    expect(input).toMatch(/Messages: 12 \(the \d+ oldest are left out/);
    expect(input.length).toBeLessThan(32_000);
  });
});

describe("parseSummaryReply", () => {
  it("reads a fenced JSON reply and tidies the points", () => {
    expect(
      parseSummaryReply(
        '```json\n{"line": "Launch moved to Friday.", "points": ["- Ana asked to ship Friday", "  ", "QA  still needs a build", "a", "b", "c"]}\n```',
      ),
    ).toEqual({
      ok: true,
      line: "Launch moved to Friday.",
      points: ["Ana asked to ship Friday", "QA still needs a build", "a", "b"],
    });
  });

  it("reports a reply it cannot read instead of an empty summary", () => {
    expect(parseSummaryReply("Here is a summary of the thread.")).toMatchObject(
      { ok: false },
    );
    expect(parseSummaryReply('{"line": ""}')).toMatchObject({ ok: false });
    expect(parseSummaryReply('{"points": ["x"]}')).toMatchObject({
      ok: false,
    });
    expect(parseSummaryReply("{not json}")).toMatchObject({ ok: false });
  });
});
