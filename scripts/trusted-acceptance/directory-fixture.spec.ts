import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import {
  type DirectoryFixtureConfig,
  handleDirectoryFixtureRequest,
  validateDirectoryFixtureConfig,
} from "./directory-fixture.ts";

const config: DirectoryFixtureConfig = {
  orgDomain: "acceptance.example.test",
  a2aSecret: "fake-disposable-a2a-secret",
  fixtureOrigin: "https://directory-acceptance.example.test",
  withdrawnMemberId: "content",
  members: [
    {
      id: "calendar",
      name: "Calendar",
      url: "https://calendar-acceptance.example.test",
      a2aUrl: "https://calendar-acceptance.example.test",
    },
    {
      id: "content",
      name: "Content",
      url: "https://content-acceptance.example.test",
      a2aUrl: "https://content-acceptance.example.test",
    },
  ],
};

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function token(
  claims: Record<string, unknown> = {},
  callerId = "acceptance-caller",
  signingSecret = config.a2aSecret,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "HS256" });
  const payload = base64url({
    org_domain: config.orgDomain,
    sub: callerId,
    iat: now,
    exp: now + 300,
    ...claims,
  });
  const signature = createHmac("sha256", signingSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

describe("trusted acceptance directory fixture", () => {
  it("returns the public org/apps shape for a trusted stable caller", async () => {
    const response = await handleDirectoryFixtureRequest(
      { method: "GET", headers: { Authorization: `Bearer ${token()}` } },
      config,
      "stable",
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      org: "acceptance.example.test",
      apps: config.members,
    });
  });

  it("accepts a signed hosted-QA email domain when no org row exists yet", async () => {
    const response = await handleDirectoryFixtureRequest(
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token(
            { org_domain: undefined },
            "trusted-acceptance+fixture@acceptance.example.test",
          )}`,
        },
      },
      config,
      "stable",
    );
    assert.equal(response.status, 200);
  });

  it("withdraws only the configured declared member", async () => {
    const response = await handleDirectoryFixtureRequest(
      { method: "GET", headers: { authorization: `Bearer ${token()}` } },
      config,
      "withdraw-member",
    );
    assert.deepEqual(
      response.body?.apps.map(({ id }) => id),
      ["calendar"],
    );
  });

  it("fails closed for missing caller, wrong org, expired, and forged JWTs", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = token({ exp: now - 1 });
    const forged = token({}, "acceptance-caller", "another-fake-secret");
    const notYetValid = token({ nbf: now + 300, exp: now + 600 });
    const tokens = [
      undefined,
      token({}, ""),
      token({ org_domain: "other-org" }),
      token({ scope: "identity" }),
      token({ scope: "mcp-connect" }),
      expired,
      notYetValid,
      forged,
    ];
    for (const bearer of tokens) {
      const response = await handleDirectoryFixtureRequest(
        {
          method: "GET",
          headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
        },
        config,
        "stable",
      );
      assert.equal(response.status, 401);
      assert.equal(response.body, undefined);
    }
  });

  it("rejects unsafe hosts and a withdrawal target outside the declared allowlist", () => {
    const unsafe: DirectoryFixtureConfig = {
      ...config,
      withdrawnMemberId: "missing",
      members: [
        {
          ...config.members[0]!,
          url: "https://calendar-production.example.test",
        },
      ],
    };
    assert.deepEqual(validateDirectoryFixtureConfig(unsafe), [
      "member calendar has an unsafe url",
      "withdrawnMemberId must name a declared member",
    ]);
  });
});
