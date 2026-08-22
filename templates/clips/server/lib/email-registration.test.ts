import {
  defineTransactionalEmail,
  listTransactionalEmails,
  resetTransactionalEmailRegistry,
} from "@agent-native/core/email-catalog";
import { beforeEach, describe, expect, it } from "vitest";

import { registerClipsEmails } from "./emails.js";
import { CLIPS_FIRST_VIEW_EMAIL_ID } from "./transactional-email-templates.js";

describe("Clips transactional email registration", () => {
  beforeEach(() => {
    resetTransactionalEmailRegistry();
  });

  it("retries the catalog after a failed registration", () => {
    defineTransactionalEmail({
      id: CLIPS_FIRST_VIEW_EMAIL_ID,
      name: "stale definition",
      app: "clips",
      trigger: "trigger",
      recipient: "recipient",
      recipientLabel: "Recipient",
      sender: "sender",
      senderLabel: "Sender",
      preview: () => ({ subject: "stale", html: "", text: "" }),
    });

    expect(() => registerClipsEmails()).toThrow(
      /Duplicate transactional email/,
    );
    expect(
      listTransactionalEmails()
        .filter((email) => email.id.startsWith("clips."))
        .map((email) => email.id),
    ).toEqual([CLIPS_FIRST_VIEW_EMAIL_ID]);

    resetTransactionalEmailRegistry();
    expect(() => registerClipsEmails()).not.toThrow();
    expect(() => registerClipsEmails()).not.toThrow();

    expect(
      listTransactionalEmails().filter((email) =>
        email.id.startsWith("clips."),
      ),
    ).toHaveLength(10);
  });
});
