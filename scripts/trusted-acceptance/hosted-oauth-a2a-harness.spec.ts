import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HostedMcpClient,
  buildAuthorizationUrl,
  createS256Pkce,
  discoverOAuth,
  exchangeAuthorizationCode,
  expectUnauthorized,
  registerDynamicClient,
  runWithdrawalScenario,
} from "./hosted-oauth-a2a-harness.ts";

const origin = "https://caller-acceptance.example.test";
const metadata = {
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  resource: `${origin}/mcp`,
};

describe("hosted OAuth and A2A acceptance harness", () => {
  it("constructs RFC 7636 S256 authorization URLs with an exact loopback callback", () => {
    const pkce = createS256Pkce("a".repeat(43));
    assert.equal(pkce.challenge, "ZtNPunH49FD35FWYhT5Tv8I7vRKQJ8uxMaL0_9eHjNA");
    const url = new URL(
      buildAuthorizationUrl({
        metadata,
        appOrigin: origin,
        clientId: "fake-client",
        redirectUri: "http://127.0.0.1:4319/oauth/callback",
        state: "opaque-state",
        pkce,
      }),
    );
    assert.equal(url.origin, origin);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), pkce.challenge);
    assert.equal(url.searchParams.get("resource"), metadata.resource);
    assert.equal(url.searchParams.get("scope"), "mcp:read mcp:write mcp:apps");
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "http://127.0.0.1:4319/oauth/callback",
    );
    assert.throws(() =>
      buildAuthorizationUrl({
        metadata,
        appOrigin: origin,
        clientId: "fake-client",
        redirectUri: "http://evil.example.test/callback",
        state: "opaque-state",
        pkce,
      }),
    );
  });

  it("discovers OAuth through injected fetch and rejects a non-local endpoint", async () => {
    const discovered = await discoverOAuth(async (url) => {
      if (url.endsWith("oauth-protected-resource")) {
        return Response.json({
          authorization_servers: [origin],
          resource: metadata.resource,
        });
      }
      const { resource: _, ...authorizationMetadata } = metadata;
      return Response.json(authorizationMetadata);
    }, origin);
    assert.deepEqual(discovered, metadata);
    await assert.rejects(
      discoverOAuth(
        async (url) =>
          url.endsWith("oauth-protected-resource")
            ? Response.json({
                authorization_servers: [origin],
                resource: metadata.resource,
              })
            : Response.json({
                ...metadata,
                token_endpoint: "https://production.example.test/token",
              }),
        origin,
      ),
    );
  });

  it("uses advertised registration and code exchange without serializing credentials", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fetchFn = async (
      url: string,
      init?: RequestInit,
    ): Promise<Response> => {
      requests.push({ url, body: String(init?.body ?? "") });
      if (url.endsWith("/oauth/register"))
        return Response.json({ client_id: "fake-client" });
      return Response.json({ access_token: "private-access-token" });
    };
    const registration = await registerDynamicClient({
      fetchFn,
      metadata,
      appOrigin: origin,
      redirectUri: "http://127.0.0.1:4319/oauth/callback",
    });
    const token = await exchangeAuthorizationCode({
      fetchFn,
      metadata,
      appOrigin: origin,
      clientId: registration.clientId,
      redirectUri: "http://127.0.0.1:4319/oauth/callback",
      code: "fake-code",
      verifier: "a".repeat(43),
    });
    assert.equal(registration.clientId, "fake-client");
    assert.equal(token.accessToken, "private-access-token");
    assert.match(requests[0]!.body, /redirect_uris/);
    assert.match(requests[1]!.body, /code_verifier/);
  });

  it("polls the same ask_app task after trusted directory withdrawal and returns redacted evidence", async () => {
    const calls: Array<{ name: string; taskId?: string }> = [];
    let withdrawn = false;
    const client = new HostedMcpClient(
      async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          params: { name: string; arguments: { taskId?: string } };
        };
        calls.push({
          name: body.params.name,
          taskId: body.params.arguments.taskId,
        });
        if (body.params.name === "ask_app")
          return Response.json({ result: { taskId: "private-task-id" } });
        if (body.params.name === "ask_app_status") {
          return Response.json({
            result: {
              status:
                withdrawn &&
                calls.filter(({ name }) => name === "ask_app_status").length > 1
                  ? "completed"
                  : "working",
            },
          });
        }
        return Response.json({ result: { apps: [{ id: "content" }] } });
      },
      `${origin}/mcp`,
      "private-access-token",
    );
    const evidence = await runWithdrawalScenario({
      client,
      targetApp: "content",
      message: "safe fixture message",
      controller: { withdrawDirectoryMember: () => void (withdrawn = true) },
      now: () => "2026-07-26T00:00:00.000Z",
    });
    assert.deepEqual(
      calls.map(({ name }) => name),
      ["list_apps", "ask_app", "ask_app_status", "ask_app_status"],
    );
    assert.deepEqual(
      calls
        .filter(({ name }) => name === "ask_app_status")
        .map(({ taskId }) => taskId),
      ["private-task-id", "private-task-id"],
    );
    assert.deepEqual(evidence, [
      {
        assertionId: "directory-withdrawal-same-task-status",
        status: "passed",
        timestamp: "2026-07-26T00:00:00.000Z",
        origins: [origin],
        taskIdHash: "sha256:3fed51006e68a9d8",
      },
    ]);
    assert.equal(JSON.stringify(evidence).includes("private"), false);
  });

  it("requires stable discovery to name the target before ask_app", async () => {
    const calls: string[] = [];
    const client = new HostedMcpClient(
      async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          params: { name: string };
        };
        calls.push(body.params.name);
        return Response.json({ result: { apps: [{ id: "other-app" }] } });
      },
      `${origin}/mcp`,
      "private-access-token",
    );
    await assert.rejects(
      runWithdrawalScenario({
        client,
        targetApp: "content",
        message: "safe fixture message",
        controller: { withdrawDirectoryMember: () => undefined },
      }),
      /did not include the target app/,
    );
    assert.deepEqual(calls, ["list_apps"]);
  });

  it("records negative trust probes as 401 without reading response bodies", async () => {
    let bodyRead = false;
    const response = new Response("sensitive error", { status: 401 });
    const originalText = response.text.bind(response);
    response.text = async () => {
      bodyRead = true;
      return originalText();
    };
    assert.deepEqual(
      await expectUnauthorized(async () => response, `${origin}/mcp`),
      { status: 401 },
    );
    assert.equal(bodyRead, false);
  });
});
