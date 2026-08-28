import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyGoogleAuthorizeResponse,
  classifyGoogleHealthResponse,
} from "./check-google-redirect-uris.ts";

const redirectUri =
  "https://calendar.agent-native.com/_agent-native/google/callback";
const jsonHeaders = { "content-type": "application/json" };

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
