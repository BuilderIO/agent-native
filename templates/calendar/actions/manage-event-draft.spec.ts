import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function manageEventDraftSource(): string {
  return readFileSync(
    new URL("./manage-event-draft.ts", import.meta.url),
    "utf8",
  );
}

describe("manage-event-draft deep link", () => {
  // Security regression test: a previous implementation base64url-encoded the
  // full event draft (title + attendees + description + location) into a
  // `calendarDraft=` query param on the deep link. That URL is surfaced to
  // external MCP host LLMs (ChatGPT / Claude), which can see and remember it;
  // shared / exported chat transcripts would leak meeting contents. The deep
  // link now carries only the opaque draft id (+ date hint), and the full
  // draft is read from app-state on render.
  it("no longer encodes draft contents into the URL", () => {
    const source = manageEventDraftSource();

    // The draft-payload encoder helpers are removed entirely.
    expect(source).not.toContain("encodeDraftPayload");
    expect(source).not.toContain("MAX_DRAFT_PAYLOAD_BYTES");
    // No `encodeDraft` helper function and no `calendarDraft:` field.
    expect(source).not.toMatch(/^function encodeDraft\(/m);
    expect(source).not.toMatch(/\bcalendarDraft:/);
    // The deep link still carries an id-only pointer (+ date hint).
    expect(source).toContain("eventDraftId");
  });

  it("eventDraftDeepLink calls buildDeepLink with only id + date (no payload)", () => {
    const source = manageEventDraftSource();

    // The eventDraftDeepLink helper body must contain ONLY the expected
    // fields. It must not contain a `calendarDraft:` field or any encoder
    // call. Match the function body precisely to catch a regression that
    // re-adds the payload field.
    const match = source.match(
      /function eventDraftDeepLink\([^)]*\)[^{]*{[\s\S]*?return buildDeepLink\(\{([\s\S]*?)\}\);[\s\S]*?}/,
    );
    expect(match).toBeTruthy();
    const body = match![1];
    expect(body).toContain('app: "calendar"');
    expect(body).toContain('view: "calendar"');
    expect(body).toContain("eventDraftId: draft.id");
    expect(body).toContain("date: draft.start");
    expect(body).not.toContain("calendarDraft:");
    expect(body).not.toContain("encode");
  });
});
