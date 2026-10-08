import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function manageEventDraftSource(): string {
  return readFileSync(
    new URL("./manage-event-draft.ts", import.meta.url),
    "utf8",
  );
}

describe("manage-event-draft deep link", () => {
  it("no longer encodes draft contents into the URL", () => {
    const source = manageEventDraftSource();

    expect(source).not.toContain("encodeDraftPayload");
    expect(source).not.toContain("MAX_DRAFT_PAYLOAD_BYTES");
    expect(source).not.toMatch(/^function encodeDraft\(/m);
    expect(source).not.toMatch(/\bcalendarDraft:/);
    expect(source).toContain("eventDraftId");
  });

  it("eventDraftDeepLink calls buildDeepLink with only id + date (no payload)", () => {
    const source = manageEventDraftSource();

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

describe("manage-event-draft out-of-office semantics", () => {
  it("persists full-day and decline settings for UI review", () => {
    const source = manageEventDraftSource();

    expect(source).toContain('setIfPresent(draft, "fullDay", args.fullDay)');
    expect(source).toContain("draft.outOfOfficeProperties = {");
    expect(source).toContain('draft.title = "Out of office"');
  });
});
