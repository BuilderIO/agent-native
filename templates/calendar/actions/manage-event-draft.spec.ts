import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function manageEventDraftSource(): string {
  return readFileSync(
    new URL("./manage-event-draft.ts", import.meta.url),
    "utf8",
  );
}

describe("manage-event-draft deep link", () => {
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
