import { describe, expect, it } from "vitest";

import {
  PRIVATE_ACTION_ALREADY_COMPLETED_RESULT,
  privateSafeErrorMessage,
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
  });

  it("has no message for other codes, inherited keys, or non-strings", () => {
    expect(
      privateSafeErrorMessage("private_action_already_completed"),
    ).toBeUndefined();
    expect(privateSafeErrorMessage("provider_specific_code")).toBeUndefined();
    expect(privateSafeErrorMessage("toString")).toBeUndefined();
    expect(privateSafeErrorMessage("constructor")).toBeUndefined();
    expect(privateSafeErrorMessage(undefined)).toBeUndefined();
    expect(privateSafeErrorMessage(42)).toBeUndefined();
  });

  it("tells the model not to retry a private action that already ran", () => {
    expect(PRIVATE_ACTION_ALREADY_COMPLETED_RESULT).toBe(
      "Not run: this action already ran earlier in this turn, and its private details are not kept, so running it again could repeat its change. " +
        "Do not retry it in this turn. Tell the user what was completed and ask them to send a new message if they need another change.",
    );
  });
});
