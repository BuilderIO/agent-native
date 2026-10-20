import { describe, expect, it } from "vitest";

import { shouldMarkReplyDoneAfterSend } from "./mail-send-policy";

describe("Send + Mark Done policy", () => {
  it("keeps ordinary replies in the inbox unless the preference is enabled", () => {
    expect(
      shouldMarkReplyDoneAfterSend(
        { mode: "reply", replyToId: "message-1" },
        false,
        false,
      ),
    ).toBe(false);
    expect(
      shouldMarkReplyDoneAfterSend(
        { mode: "reply", replyToId: "message-1" },
        true,
        false,
      ),
    ).toBe(true);
  });

  it("allows the explicit shortcut to mark a reply Done with the preference off", () => {
    expect(
      shouldMarkReplyDoneAfterSend(
        { mode: "reply", replyToId: "message-1" },
        false,
        true,
      ),
    ).toBe(true);
  });

  it.each(["compose", "forward"] as const)(
    "never marks a %s draft Done because it has no reply thread",
    (mode) => {
      expect(
        shouldMarkReplyDoneAfterSend(
          { mode, replyToId: "message-1" },
          true,
          true,
        ),
      ).toBe(false);
    },
  );

  it("does not mark a reply Done without an original message to archive", () => {
    expect(shouldMarkReplyDoneAfterSend({ mode: "reply" }, true, true)).toBe(
      false,
    );
  });
});
