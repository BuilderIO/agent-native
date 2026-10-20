import { describe, expect, it } from "vitest";

import { describeBearerCredentialRefusalWithRecovery } from "./bearer-credential-refusal.js";

const ERROR_DESCRIPTION = /^[\x20\x21\x23-\x5B\x5D-\x7E]*$/;

describe("describeBearerCredentialRefusalWithRecovery", () => {
  it("names the connect URL", () => {
    expect(
      describeBearerCredentialRefusalWithRecovery(
        "revoked",
        "https://app.example.test/mcp/connect",
      ),
    ).toBe(
      "This token was revoked. Reconnect at https://app.example.test/mcp/connect.",
    );
  });

  it.each([
    ["a quote in the base path", 'https://app.example.test/a"b/mcp/connect'],
    ["non-ASCII in the base path", "https://app.example.test/café/mcp/connect"],
    ["a non-ASCII host", "https://bücher.example.test/mcp/connect"],
  ])("keeps the description header-safe with %s", (_, connectUrl) => {
    const message = describeBearerCredentialRefusalWithRecovery(
      "invalid",
      connectUrl,
    );
    expect(message).toMatch(ERROR_DESCRIPTION);
    expect(message).toContain("Reconnect at https://");
  });

  it.each([
    ["a quote in the host", 'https://app"x.example.test/mcp/connect'],
    ["an unparseable URL", "not a url"],
    ["no URL", undefined],
  ])("leaves the URL out with %s", (_, connectUrl) => {
    const message = describeBearerCredentialRefusalWithRecovery(
      "invalid",
      connectUrl,
    );
    expect(message).toMatch(ERROR_DESCRIPTION);
    expect(message).toMatch(/Reconnect this connector\.$/);
  });
});
