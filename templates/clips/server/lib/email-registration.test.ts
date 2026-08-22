import {
  listTransactionalEmails,
  resetTransactionalEmailRegistry,
} from "@agent-native/core/email-catalog";
import { beforeEach, describe, expect, it } from "vitest";

import { registerClipsEmails } from "./emails.js";

describe("Clips transactional email registration", () => {
  beforeEach(() => {
    resetTransactionalEmailRegistry();
  });

  it("registers the complete catalog through the Clips path", () => {
    registerClipsEmails();

    expect(
      listTransactionalEmails().filter((email) =>
        email.id.startsWith("clips."),
      ),
    ).toHaveLength(10);
  });
});
