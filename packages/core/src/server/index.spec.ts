import { describe, expect, it } from "vitest";

import { defineTransactionalEmails as defineTransactionalEmailsFromRegistry } from "../email-catalog/registry.js";
import { defineTransactionalEmails } from "./index.js";

describe("server entrypoint", () => {
  it("re-exports atomic transactional email registration", () => {
    expect(defineTransactionalEmails).toBe(
      defineTransactionalEmailsFromRegistry,
    );
  });
});
