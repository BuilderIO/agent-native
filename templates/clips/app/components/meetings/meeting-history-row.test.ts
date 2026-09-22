import { describe, expect, it } from "vitest";

import { formatOwnerHint, formatParticipantNames } from "./meeting-history-row";

const viewer = "dev@local.test";
const fakeT = (key: string, options?: Record<string, unknown>) => {
  if (key === "meetingDetail.recordedBy") {
    const name = options?.name;
    return `Recorded by ${typeof name === "string" ? name : (JSON.stringify(name) ?? "")}`;
  }
  if (key === "meetingDetail.me") return "Me";
  return key;
};

describe("formatParticipantNames", () => {
  it("names the one other person on a 1:1", () => {
    expect(
      formatParticipantNames(
        [
          { email: "natasha@builder.io", name: "Natasha" },
          { email: viewer, name: "Dev" },
        ],
        viewer,
      ),
    ).toBe("Natasha");
  });

  it("collapses past two names, counting only the others", () => {
    expect(
      formatParticipantNames(
        [
          { email: "jason@builder.io", name: "Jason" },
          { email: "elaine@builder.io", name: "Elaine" },
          { email: "katya@builder.io", name: "Katya" },
          { email: "sam@builder.io", name: "Sam" },
          { email: viewer, name: "Dev" },
        ],
        viewer,
      ),
    ).toBe("Jason, Elaine & 2 others");
  });

  // The attendee subtitle must go empty rather than telling the reader they
  // were in a meeting with themselves; `formatOwnerHint` is what still
  // surfaces the owner's avatar/name on a solo note.
  it("returns nothing when the viewer is the only attendee", () => {
    expect(
      formatParticipantNames([{ email: viewer, name: "Dev" }], viewer),
    ).toBe("");
    expect(formatParticipantNames([], viewer)).toBe("");
  });

  it("matches the viewer regardless of case or padding", () => {
    expect(
      formatParticipantNames(
        [
          { email: "  DEV@Local.TEST  ", name: "Dev" },
          { email: "chris@builder.io", name: "Chris Hall" },
        ],
        viewer,
      ),
    ).toBe("Chris Hall");
  });

  it("keeps everyone when the viewer is unknown", () => {
    expect(
      formatParticipantNames([
        { email: "chris@builder.io", name: "Chris Hall" },
        { email: viewer, name: "Dev" },
      ]),
    ).toBe("Chris Hall, Dev");
  });

  it("falls back to the email local-part when a name is missing", () => {
    expect(formatParticipantNames([{ email: "fred@builder.io" }], viewer)).toBe(
      "fred",
    );
  });
});

describe("formatOwnerHint", () => {
  it("names the owner of a shared meeting", () => {
    expect(formatOwnerHint("sidharth@builder.io", viewer, fakeT)).toBe(
      "Recorded by sidharth",
    );
  });

  it("shows the owner even on the viewer's own meetings, as 'Me'", () => {
    expect(formatOwnerHint(viewer, viewer, fakeT)).toBe("Recorded by Me");
    expect(formatOwnerHint("  DEV@Local.TEST  ", viewer, fakeT)).toBe(
      "Recorded by Me",
    );
  });

  it("returns nothing without an owner", () => {
    expect(formatOwnerHint(null, viewer, fakeT)).toBe("");
    expect(formatOwnerHint(undefined, viewer, fakeT)).toBe("");
  });
});
