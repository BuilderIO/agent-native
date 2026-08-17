import { describe, expect, it } from "vitest";

import { formatParticipantNames } from "./meeting-history-row";

const viewer = "dev@local.test";

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

  // A solo note renders a document icon instead, so the subtitle must go empty
  // rather than telling the reader they were in a meeting with themselves.
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
