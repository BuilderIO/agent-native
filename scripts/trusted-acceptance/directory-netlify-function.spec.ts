import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { handleNetlifyDirectoryRequest } from "./directory-netlify-function.ts";

const secret = "fake-disposable-a2a-secret";
const directory = {
  orgDomain: "acceptance.example.test",
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

function token(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      sub: "acceptance-caller",
      org_domain: directory.orgDomain,
      exp: now + 300,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

describe("acceptance directory Netlify function", () => {
  it("mounts the public contract from trusted runtime configuration", async () => {
    const response = await handleNetlifyDirectoryRequest(
      new Request(`${directory.fixtureOrigin}/_agent-native/org/apps`, {
        headers: { Authorization: `Bearer ${token()}` },
      }),
      {
        A2A_SECRET: secret,
        AGENT_NATIVE_ACCEPTANCE_DIRECTORY_JSON: JSON.stringify(directory),
        AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO: "withdraw-member",
      },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { apps: Array<{ id: string }> };
    assert.deepEqual(
      body.apps.map(({ id }) => id),
      ["calendar"],
    );
  });

  it("fails closed without trusted config or for a non-allowlisted mode", async () => {
    const request = new Request(
      `${directory.fixtureOrigin}/_agent-native/org/apps`,
    );
    assert.equal(
      (await handleNetlifyDirectoryRequest(request, {})).status,
      503,
    );
    assert.equal(
      (
        await handleNetlifyDirectoryRequest(request, {
          A2A_SECRET: secret,
          AGENT_NATIVE_ACCEPTANCE_DIRECTORY_JSON: JSON.stringify(directory),
          AGENT_NATIVE_ACCEPTANCE_DIRECTORY_SCENARIO: "arbitrary-target",
        })
      ).status,
      503,
    );
  });
});
