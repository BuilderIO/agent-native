import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyGoogleAuthorizeResponse,
  classifyGoogleHealthResponse,
  fetchWithRetry,
  googleRedirectProbeExitCode,
  healthContractDisagreement,
  isInconclusiveGoogleHealthStatus,
} from "./check-google-redirect-uris.ts";

const redirectUri =
  "https://calendar.agent-native.com/_agent-native/google/callback";
const jsonHeaders = { "content-type": "application/json" };
const googleDocsCallback = "/_agent-native/google-docs/callback";
const probePath = fileURLToPath(
  new URL("./check-google-redirect-uris.ts", import.meta.url),
);

test("reads callback ownership from the deployed health contract", () => {
  const result = classifyGoogleHealthResponse(
    new Response(
      JSON.stringify({
        status: "valid",
        clientId: "client-id",
        credentialSource: "managed",
        credentialMode: "managed",
        managedConnection: "required",
        callbackPaths: ["/_agent-native/google/callback", googleDocsCallback],
      }),
      { status: 200, headers: jsonHeaders },
    ),
    JSON.stringify({
      status: "valid",
      clientId: "client-id",
      credentialSource: "managed",
      credentialMode: "managed",
      managedConnection: "required",
      callbackPaths: ["/_agent-native/google/callback", googleDocsCallback],
    }),
  );
  assert.deepEqual(result.callbackPaths, [
    "/_agent-native/google/callback",
    googleDocsCallback,
  ]);
  assert.equal(result.credentialMode, "managed");
  assert.equal(result.managedConnection, "required");
});

test("does not treat separate client ids as a health-contract disagreement", () => {
  const managed = classifyGoogleHealthResponse(
    new Response(
      JSON.stringify({
        status: "valid",
        clientId: "managed-client",
        managedConnection: "required",
        callbackPaths: ["/_agent-native/google/callback"],
      }),
      { status: 200, headers: jsonHeaders },
    ),
    JSON.stringify({
      status: "valid",
      clientId: "managed-client",
      managedConnection: "required",
      callbackPaths: ["/_agent-native/google/callback"],
    }),
  );
  const signIn = classifyGoogleHealthResponse(
    new Response(
      JSON.stringify({
        status: "valid",
        clientId: "sign-in-client",
        managedConnection: "required",
        callbackPaths: ["/_agent-native/google/callback"],
      }),
      { status: 200, headers: jsonHeaders },
    ),
    JSON.stringify({
      status: "valid",
      clientId: "sign-in-client",
      managedConnection: "required",
      callbackPaths: ["/_agent-native/google/callback"],
    }),
  );
  assert.equal(healthContractDisagreement(managed, signIn), null);
  assert.equal(
    healthContractDisagreement(managed, {
      ...signIn,
      callbackPaths: [...(signIn.callbackPaths ?? [])].reverse(),
    }),
    null,
  );
  assert.equal(
    healthContractDisagreement(managed, {
      ...signIn,
      managedConnection: "not_applicable",
    }),
    "managed capability differs between health contracts",
  );
});

test("keeps an unknown health result inconclusive even with a client id", () => {
  const result = classifyGoogleHealthResponse(
    new Response(JSON.stringify({ status: "unknown", clientId: "client-id" }), {
      status: 200,
      headers: jsonHeaders,
    }),
    JSON.stringify({ status: "unknown", clientId: "client-id" }),
  );
  assert.equal(result.clientId, "client-id");
  assert.equal(isInconclusiveGoogleHealthStatus(result.status), true);
  assert.equal(isInconclusiveGoogleHealthStatus("valid"), false);
});

test("separates definitive mismatches from inconclusive probe failures", () => {
  assert.equal(
    googleRedirectProbeExitCode({
      expected: 1,
      unregistered: 1,
      unknown: 0,
      unprobeable: 0,
      invalidCredentials: 0,
      skippedRequired: 0,
    }),
    1,
  );
  assert.equal(
    googleRedirectProbeExitCode({
      expected: 1,
      unregistered: 0,
      unknown: 1,
      unprobeable: 0,
      invalidCredentials: 0,
      skippedRequired: 0,
    }),
    2,
  );
  assert.equal(
    googleRedirectProbeExitCode({
      expected: 0,
      unregistered: 0,
      unknown: 0,
      unprobeable: 0,
      invalidCredentials: 0,
      skippedRequired: 0,
      allowNoCoverage: true,
    }),
    0,
  );
});

test("allows explicitly enabled legacy health with no redirect coverage", () => {
  assert.equal(
    googleRedirectProbeExitCode({
      expected: 0,
      unregistered: 0,
      unknown: 0,
      unprobeable: 0,
      invalidCredentials: 0,
      skippedRequired: 0,
      allowNoCoverage: true,
    }),
    0,
  );
});

test("maps unexpected CLI failures to the inconclusive exit code", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        ["--experimental-strip-types", probePath, "--budget-seconds", "bad"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 2);
      assert.match(
        String((error as { stderr?: string }).stderr),
        /Google redirect probe could not run: --budget-seconds must be a positive integer/,
      );
      return true;
    },
  );
});

test("recognizes an explicit non-managed app without treating missing credentials as a failure", () => {
  const result = classifyGoogleHealthResponse(
    new Response(
      JSON.stringify({
        status: "unconfigured",
        credentialSource: "none",
        credentialMode: "managed",
        managedConnection: "not_applicable",
      }),
      { status: 200, headers: jsonHeaders },
    ),
    JSON.stringify({
      status: "unconfigured",
      credentialSource: "none",
      credentialMode: "managed",
      managedConnection: "not_applicable",
    }),
  );
  assert.equal(result.status, "unconfigured");
  assert.equal(result.credentialSource, "none");
  assert.equal(result.managedConnection, "not_applicable");
});

test("keeps an undeclared managed capability explicit and inconclusive", () => {
  const result = classifyGoogleHealthResponse(
    new Response(
      JSON.stringify({
        status: "valid",
        clientId: "client-id",
        credentialSource: "managed",
        credentialMode: "managed",
        managedConnection: "unknown",
      }),
      { status: 200, headers: jsonHeaders },
    ),
    JSON.stringify({
      status: "valid",
      clientId: "client-id",
      credentialSource: "managed",
      credentialMode: "managed",
      managedConnection: "unknown",
    }),
  );
  assert.equal(result.managedConnection, "unknown");
});

test("classifies Google's sign-in redirect as registered", () => {
  const response = new Response(null, {
    status: 302,
    headers: {
      location: "https://accounts.google.com/v3/signin/identifier?continue=1",
    },
  });
  assert.deepEqual(classifyGoogleAuthorizeResponse(response, redirectUri), {
    state: "registered",
  });
});

test("classifies Google's exact redirect mismatch page as unregistered", () => {
  const authError = Buffer.from("Error 400: redirect_uri_mismatch").toString(
    "base64url",
  );
  const response = new Response(null, {
    status: 302,
    headers: {
      location: `https://accounts.google.com/signin/oauth/error?authError=${authError}`,
    },
  });
  assert.deepEqual(classifyGoogleAuthorizeResponse(response, redirectUri), {
    state: "unregistered",
  });
});

test("keeps incomplete and changed provider responses unknown", () => {
  assert.equal(
    classifyGoogleAuthorizeResponse(
      new Response(null, { status: 503 }),
      redirectUri,
    ).state,
    "unknown",
  );
  assert.equal(
    classifyGoogleAuthorizeResponse(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/signin/identifier" },
      }),
      redirectUri,
    ).state,
    "unknown",
  );
  const otherError = Buffer.from("Error 400: invalid_request").toString(
    "base64url",
  );
  assert.equal(
    classifyGoogleAuthorizeResponse(
      new Response(null, {
        status: 302,
        headers: {
          location: `https://accounts.google.com/signin/oauth/error?authError=${otherError}`,
        },
      }),
      redirectUri,
    ).state,
    "unknown",
  );
});

test("retries transient provider responses before classifying the result", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(null, {
        status: 429,
        headers: { "retry-after": "0" },
      });
    }
    return new Response(null, {
      status: 302,
      headers: {
        location: "https://accounts.google.com/v3/signin/identifier",
      },
    });
  };
  try {
    const response = await fetchWithRetry(
      "https://accounts.google.com/o/oauth2/v2/auth",
      { redirect: "manual" },
      Date.now() + 1_000,
    );
    assert.equal(response.status, 302);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not fetch after the probe deadline", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(null, { status: 302 });
  };
  try {
    await assert.rejects(
      fetchWithRetry(
        "https://accounts.google.com/o/oauth2/v2/auth",
        { redirect: "manual" },
        Date.now() - 1,
      ),
      /Google probe request deadline exceeded/,
    );
    assert.equal(attempts, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps a client fingerprint alongside the id needed for the probe", () => {
  const result = classifyGoogleHealthResponse(
    new Response(JSON.stringify({ status: "valid", clientId: "ignored" }), {
      status: 200,
      headers: jsonHeaders,
    }),
    JSON.stringify({
      status: "valid",
      clientId: "client-id.apps.googleusercontent.com",
      reason: "invalid_grant",
      credentialSource: "managed",
    }),
  );
  assert.equal(result.status, "valid");
  assert.equal(result.clientId, "client-id.apps.googleusercontent.com");
  assert.match(result.clientFingerprint ?? "", /^sha256:[a-f0-9]{12}$/);
  assert.equal(result.reason, "invalid_grant");
});

test("does not accept a success payload from an unexpected HTTP status", () => {
  const result = classifyGoogleHealthResponse(
    new Response('{"status":"valid","clientId":"client-id"}', {
      status: 500,
      headers: jsonHeaders,
    }),
    '{"status":"valid","clientId":"client-id"}',
  );

  assert.deepEqual(result, {
    status: "unknown",
    reason: "health endpoint returned HTTP 500",
    clientId: null,
    clientFingerprint: null,
    mismatchedPairs: null,
    credentialSource: null,
    credentialMode: null,
    managedConnection: null,
    callbackPaths: null,
  });
});

test("keeps absent, malformed, and redirected health responses out of the pass count", () => {
  assert.equal(
    classifyGoogleHealthResponse(
      new Response("not found", { status: 404 }),
      "not found",
    ).status,
    "absent",
  );
  assert.equal(
    classifyGoogleHealthResponse(
      new Response("{", { status: 503, headers: jsonHeaders }),
      "{",
    ).status,
    "unknown",
  );
  assert.equal(
    classifyGoogleHealthResponse(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/health" },
      }),
      "",
    ).status,
    "unknown",
  );
});
