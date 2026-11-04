import { describe, expect, it } from "vitest";

import {
  defineTransactionalEmails as defineTransactionalEmailsFromRegistry,
  replaceTransactionalEmails as replaceTransactionalEmailsFromRegistry,
} from "../email-catalog/registry.js";
import { resolveBuilderOAuthRequestAccessState as resolveFromBuilderOAuth } from "./builder-oauth.js";
import {
  defineTransactionalEmails,
  replaceTransactionalEmails,
  resolveBuilderOAuthRequestAccessState,
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

  it("re-exports the Builder sign-in state, so an app can tell an unreadable sign-in from none", () => {
    expect(resolveBuilderOAuthRequestAccessState).toBe(resolveFromBuilderOAuth);
  });
});
