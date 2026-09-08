import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HostedMcpClient,
  authorizationCodeFromCallback,
  bootstrapHostedQaSession,
  buildAuthorizationUrl,
  createForeignDomainSentinel,
  createSyntheticQaIdentity,
  createS256Pkce,
  discoverOAuth,
  discoverPublicOAuthIdentity,
  exchangeAuthorizationCode,
  expectUnauthorized,
  expectRejected4xx,
  registerDynamicClient,
  runCryptographicIsolationProbes,
  runHostedOAuthCodeFlow,
  runWithdrawalScenario,
  startLoopbackCallbackListener,
} from "./hosted-oauth-a2a-harness.ts";

const origin = "https://caller-acceptance.example.test";
const metadata = {
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  resource: `${origin}/mcp`,
};

describe("hosted OAuth and A2A acceptance harness", () => {
  it("keeps a lease-bound 256-bit synthetic password out of evidence while using only same-origin QA routes", async () => {
    const identity = createSyntheticQaIdentity("trusted-acceptance-lease-123");
    const calls: Array<{
      path: string;
      email: string;
      passwordLength: number;
    }> = [];
    const evidence = await bootstrapHostedQaSession({
      appOrigin: origin,
      identity,
      browser: {
        origin,
        async postJson(path, body) {
          calls.push({
            path,
            email: body.email,
            passwordLength: body.password.length,
          });
          return { status: 200 };
        },
        async getJson() {
          return { email: identity.email };
        },
      },
    });
    assert.match(identity.email, /\+qa-/);
    assert.equal(identity.passwordEntropyBits, 256);
    let password = "";
    await identity.withPassword((value) => {
      password = value;
    });
    assert.equal(JSON.stringify(identity).includes(password), false);
    assert.deepEqual(
      calls.map(({ path }) => path),
      ["/_agent-native/auth/register", "/_agent-native/auth/login"],
    );
    assert.ok(calls.every(({ passwordLength }) => passwordLength >= 43));
    assert.equal(JSON.stringify(evidence).includes(identity.email), false);
    await assert.rejects(
      bootstrapHostedQaSession({
        appOrigin: origin,
        identity,
        browser: {
          origin: "https://other-acceptance.example.test",
          async postJson() {
            return { status: 200 };
          },
          async getJson() {
            return { email: identity.email };
          },
        },
      }),
      /origin does not match/,
    );
  });

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

  it("records only public HTTPS resource and issuer identity for production comparison", async () => {
    const identity = await discoverPublicOAuthIdentity(
      async () =>
        Response.json({
          authorization_servers: ["https://identity.example.test"],
          resource: "https://calendar.example.test/mcp",
        }),
      "https://calendar.example.test",
    );
    assert.deepEqual(identity, {
      resource: "https://calendar.example.test/mcp",
      issuer: "https://identity.example.test",
    });
    await assert.rejects(
      discoverPublicOAuthIdentity(
        async () =>
          Response.json({
            authorization_servers: ["http://identity.example.test"],
            resource: "https://calendar.example.test/mcp",
          }),
        "https://calendar.example.test",
      ),
      /must use HTTPS/,
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

  it("orchestrates consent through an injected browser with exact callback state and redacted OAuth evidence", async () => {
    let authorizationUrl = "";
    let resolveCallback: ((value: string) => void) | undefined;
    const callback = {
      redirectUri: "http://127.0.0.1:4319/oauth/callback",
      async waitForCallback() {
        return new Promise<string>((resolve) => {
          resolveCallback = resolve;
        });
      },
      async close() {},
    };
    const flow = await runHostedOAuthCodeFlow({
      appOrigin: origin,
      callback,
      state: "state-that-is-long-enough-for-a-test",
      now: () => "2026-07-27T00:00:00.000Z",
      browser: {
        origin,
        async postJson() {
          return { status: 200 };
        },
        async getJson() {
          return {};
        },
        async authorize(url) {
          authorizationUrl = url;
          const state = new URL(url).searchParams.get("state");
          resolveCallback?.(
            `http://127.0.0.1:4319/oauth/callback?code=private-code&state=${state}`,
          );
        },
      },
      fetchFn: async (url) => {
        if (url.endsWith("oauth-protected-resource"))
          return Response.json({
            authorization_servers: [origin],
            resource: metadata.resource,
          });
        if (url.endsWith("oauth-authorization-server")) {
          const { resource: _, ...authorizationMetadata } = metadata;
          return Response.json(authorizationMetadata);
        }
        if (url.endsWith("/oauth/register"))
          return Response.json({ client_id: "fake-client" });
        return Response.json({ access_token: "private-access-token" });
      },
    });
    assert.equal(flow.accessToken, "private-access-token");
    assert.equal(
      new URL(authorizationUrl).searchParams.get("state"),
      "state-that-is-long-enough-for-a-test",
    );
    assert.equal(JSON.stringify(flow.evidence).includes("private"), false);
    assert.throws(() =>
      authorizationCodeFromCallback({
        callbackUrl: "http://127.0.0.1:4319/oauth/callback?code=x&state=wrong",
        redirectUri: callback.redirectUri,
        state: "expected",
      }),
    );
  });

  it("receives the runner callback on an injectable loopback listener", async () => {
    const listener = await startLoopbackCallbackListener();
    try {
      const received = listener.waitForCallback();
      const response = await fetch(
        `${listener.redirectUri}?code=private-code&state=state`,
      );
      assert.equal(response.status, 204);
      assert.equal(
        await received,
        `${listener.redirectUri}?code=private-code&state=state`,
      );
    } finally {
      await listener.close();
    }
  });

  it("awaits loopback listener shutdown after a callback timeout", async () => {
    const listener = await startLoopbackCallbackListener({ timeoutMs: 5 });
    await assert.rejects(
      listener.waitForCallback(),
      /loopback callback listener timed out/,
    );
    await listener.close();
    await assert.rejects(fetch(listener.redirectUri));
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
              output: withdrawn ? "TRUSTED_ACCEPTANCE_FIXTURE" : undefined,
            },
          });
        }
        return Response.json({
          result: { apps: withdrawn ? [] : [{ id: "content" }] },
        });
      },
      `${origin}/mcp`,
      "private-access-token",
    );
    const evidence = await runWithdrawalScenario({
      client,
      targetApp: "content",
      message: "safe fixture message",
      expectedResult: "TRUSTED_ACCEPTANCE_FIXTURE",
      controller: { withdrawDirectoryMember: () => void (withdrawn = true) },
      now: () => "2026-07-26T00:00:00.000Z",
    });
    assert.deepEqual(
      calls.map(({ name }) => name),
      ["list_apps", "ask_app", "list_apps", "ask_app_status", "ask_app_status"],
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
        resultHash:
          "sha256:6f9c5744a4a80b08971deaaf2b43411c82272bc633a63327c68767e87e2706db",
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
        expectedResult: "TRUSTED_ACCEPTANCE_FIXTURE",
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

  it("accepts a post-cleanup 404 as fail-closed without reading its body", async () => {
    let bodyRead = false;
    const response = new Response("tombstone", { status: 404 });
    response.text = async () => {
      bodyRead = true;
      return "tombstone";
    };
    assert.deepEqual(
      await expectRejected4xx(async () => response, `${origin}/mcp`),
      { status: 404 },
    );
    assert.equal(bodyRead, false);
  });

  it("records controller-owned isolation negatives without calling a foreign sentinel a production token", async () => {
    const productionMcp = "https://caller-production.example.test/mcp";
    const otherAcceptanceMcp = "https://other-acceptance.example.test/mcp";
    const sentinel = createForeignDomainSentinel({
      productionResource: productionMcp,
      acceptanceResource: `${origin}/mcp`,
      signingKey: new Uint8Array(32).fill(7),
      now: () => 1_000,
    });
    const calls: Array<{ url: string; authorization: string }> = [];
    const evidence = await runCryptographicIsolationProbes({
      fetchFn: async (url, init) => {
        calls.push({
          url,
          authorization: String(
            (init?.headers as Record<string, string>).Authorization,
          ),
        });
        return new Response("private rejection", { status: 401 });
      },
      acceptanceToken: "private-acceptance-token",
      productionMcpUrl: productionMcp,
      otherAcceptanceMcpUrl: otherAcceptanceMcp,
      acceptanceMcpUrl: `${origin}/mcp`,
      foreignDomainSentinel: sentinel,
      now: () => "2026-07-27T00:00:00.000Z",
    });
    assert.equal(calls.length, 3);
    assert.ok(calls[2]!.authorization.endsWith(sentinel.token));
    const receipt = JSON.stringify(evidence);
    assert.equal(receipt.includes("private-acceptance-token"), false);
    assert.equal(receipt.includes(sentinel.token), false);
    assert.match(receipt, /not-a-valid-production-token/);
  });
});
