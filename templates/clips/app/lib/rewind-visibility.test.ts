import { describe, expect, it } from "vitest";

import {
  canAddRewindHistory,
  canOfferRewindHistory,
  isPrivateClip,
  rewindHistoryUnavailableReason,
} from "./rewind-visibility";

describe("Rewind history visibility", () => {
  it("only permits an owner to extend a private Clip", () => {
    expect(canAddRewindHistory("owner", "private")).toBe(true);
    expect(canAddRewindHistory("owner", "org")).toBe(false);
    expect(canAddRewindHistory("owner", "public")).toBe(false);
    expect(canAddRewindHistory("viewer", "private")).toBe(false);
    expect(canOfferRewindHistory("owner")).toBe(true);
    expect(canOfferRewindHistory("viewer")).toBe(false);
    expect(isPrivateClip("private")).toBe(true);
    expect(isPrivateClip("org")).toBe(false);
  });

  it("explains how to make an owned shared Clip eligible", () => {
    expect(rewindHistoryUnavailableReason("owner", "public")).toBe(
      "Make this Clip private before adding Rewind history",
    );
    expect(rewindHistoryUnavailableReason("viewer", "private")).toBe(
      "Only the owner can add Rewind history",
    );
  });
});
