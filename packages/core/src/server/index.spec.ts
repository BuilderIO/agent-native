import { describe, expect, it } from "vitest";

import {
  defineTransactionalEmails as defineTransactionalEmailsFromRegistry,
  replaceTransactionalEmails as replaceTransactionalEmailsFromRegistry,
} from "../email-catalog/registry.js";
import {
  defineTransactionalEmails,
  replaceTransactionalEmails,
} from "./index.js";

describe("server entrypoint", () => {
  it("re-exports atomic transactional email registration", () => {
    expect(defineTransactionalEmails).toBe(
      defineTransactionalEmailsFromRegistry,
    );
    expect(replaceTransactionalEmails).toBe(
      replaceTransactionalEmailsFromRegistry,
    );
  });
});
