import { describe, expect, it } from "vitest";

import { mailLabelsInclude, mailLabelsIncludeAny } from "./gmail-labels.js";

describe("mail label matching", () => {
  it("matches nested Superhuman labels by their short tab name", () => {
    const labels = [
      "inbox",
      "important",
      "[superhuman]/ai/automated notifications",
    ];

    expect(mailLabelsInclude(labels, "automated notifications")).toBe(true);
    expect(
      mailLabelsIncludeAny(labels, ["note-to-self", "automated notifications"]),
    ).toBe(true);
  });

  it("does not match unrelated nested labels", () => {
    const labels = ["inbox", "important", "[superhuman]/ai/pitch"];

    expect(mailLabelsInclude(labels, "automated notifications")).toBe(false);
    expect(mailLabelsIncludeAny(labels, ["note-to-self", "updates"])).toBe(
      false,
    );
  });
});
