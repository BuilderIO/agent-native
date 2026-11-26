import { describe, expect, it } from "vitest";

import {
  OAUTH_ACCOUNT_ALREADY_LINKED_ERROR,
  readConnectionOAuthCallbackError,
} from "./oauth-callback-error.js";

describe("readConnectionOAuthCallbackError", () => {
  it("reads the already-linked error and account from a query string", () => {
    expect(
      readConnectionOAuthCallbackError(
        "?oauth_error=account_already_linked&oauth_account=a%40b.com",
      ),
    ).toEqual({
      error: OAUTH_ACCOUNT_ALREADY_LINKED_ERROR,
      account: "a@b.com",
    });
  });

  it("reports a missing account as null", () => {
    expect(
      readConnectionOAuthCallbackError(
        new URLSearchParams({ oauth_error: "account_already_linked" }),
      ),
    ).toEqual({ error: OAUTH_ACCOUNT_ALREADY_LINKED_ERROR, account: null });
  });

  it("ignores other or absent errors", () => {
    expect(readConnectionOAuthCallbackError("?oauth_error=other")).toBeNull();
    expect(readConnectionOAuthCallbackError("")).toBeNull();
  });
});
