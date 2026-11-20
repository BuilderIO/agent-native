import { describe, expect, it } from "vitest";

import {
  privateSafeErrorMessage,
  requirePrivateSafeErrorMessage,
} from "./private-safe-errors.js";

describe("private-safe error messages", () => {
  it("returns the fixed message for each private-safe code", () => {
    expect(privateSafeErrorMessage("private_history_unrecoverable")).toBe(
      "I stopped because an earlier step in this turn was private and did not finish, so I could not tell whether it had already run. Please send the request again.",
    );
    expect(privateSafeErrorMessage("tool_call_journal_unreadable")).toBe(
      "I stopped because I could not read this turn's run ledger, so I could not tell which steps had already finished. " +
        "Retrying would risk repeating a step that already completed. Please send the request again.",
    );
    expect(privateSafeErrorMessage("private_action_already_completed")).toBe(
      "I stopped because a private action already ran earlier in this turn and its details are not kept, so running it again could repeat its change. " +
        "Anything completed before this is saved. Send a new message if you need another change.",
    );
  });

  it("has no message for other codes, inherited keys, or non-strings", () => {
    expect(privateSafeErrorMessage("provider_specific_code")).toBeUndefined();
    expect(privateSafeErrorMessage("toString")).toBeUndefined();
    expect(privateSafeErrorMessage("constructor")).toBeUndefined();
    expect(privateSafeErrorMessage(undefined)).toBeUndefined();
    expect(privateSafeErrorMessage(42)).toBeUndefined();
  });

  it("requires a known code", () => {
    expect(
      requirePrivateSafeErrorMessage("private_action_already_completed"),
    ).toBe(privateSafeErrorMessage("private_action_already_completed"));
    expect(() => requirePrivateSafeErrorMessage("unknown_code")).toThrow(
      "No private-safe message for error code unknown_code",
    );
  });
});
