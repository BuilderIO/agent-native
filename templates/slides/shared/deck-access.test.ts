import { describe, expect, it } from "vitest";

import {
  deckAccessApprovalContinuationPath,
  deckAccessApprovalPath,
  deckAccessApprovalSessionKey,
} from "./deck-access";

describe("deck access approval links", () => {
  it("keeps the approval token in the owner-only link", () => {
    expect(deckAccessApprovalPath("deck/1", "signed-token")).toBe(
      "/access-request/approve?deckId=deck%2F1&token=signed-token",
    );
  });

  it("builds a token-free sign-in continuation", () => {
    expect(deckAccessApprovalContinuationPath("deck/1")).toBe(
      "/access-request/approve?deckId=deck%2F1",
    );
  });

  it("scopes the token continuation to one deck", () => {
    expect(deckAccessApprovalSessionKey("deck/1")).toBe(
      "slides-access-approval-token:deck%2F1",
    );
  });
});
