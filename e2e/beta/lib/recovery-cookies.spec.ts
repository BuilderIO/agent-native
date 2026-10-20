import assert from "node:assert/strict";
import test from "node:test";

import { recoveryCookieHeader, type RecoveryCookie } from "./recovery-cookies";

const origin = new URL("https://beta.example.test/");
const requestUrl = new URL(
  "https://beta.example.test/_agent-native/auth/session",
);
const nowMs = 1_700_000_000_000;

function cookie(overrides: Partial<RecoveryCookie> = {}): RecoveryCookie {
  return {
    name: "session",
    value: "fixture-token",
    domain: "beta.example.test",
    path: "/",
    secure: true,
    expires: -1,
    ...overrides,
  };
}

test("formats multiple scoped cookies with the standard separator", () => {
  assert.deepEqual(
    recoveryCookieHeader(
      [cookie(), cookie({ name: "csrf", value: "fixture-csrf" })],
      origin,
      requestUrl,
      nowMs,
    ),
    { kind: "header", value: "session=fixture-token; csrf=fixture-csrf" },
  );
});

test("rejects cookie names or values containing CRLF or semicolons", () => {
  for (const invalid of [
    cookie({ name: "session;other" }),
    cookie({ name: "session\r\nX-Injected" }),
    cookie({ value: "token;other=value" }),
    cookie({ value: "token\r\nX-Injected: yes" }),
    cookie({ value: 'token"quoted' }),
  ]) {
    assert.deepEqual(
      recoveryCookieHeader([invalid], origin, requestUrl, nowMs),
      {
        kind: "unreadable",
        reason: "cookie",
      },
    );
  }
});

test("scopes cookies to the exact origin, request path, domain, security, and expiry", () => {
  const threadUrl = new URL(
    "https://beta.example.test/_agent-native/agent-chat/threads/thread_fixture",
  );
  assert.deepEqual(
    recoveryCookieHeader(
      [
        cookie({ path: "/_agent-native/auth" }),
        cookie({ name: "domain", domain: ".example.test" }),
        cookie({ name: "future", expires: nowMs / 1000 + 60 }),
        cookie({ name: "expired", expires: nowMs / 1000 }),
        cookie({ name: "wrong-host", domain: "example.test" }),
      ],
      origin,
      threadUrl,
      nowMs,
    ),
    { kind: "header", value: "domain=fixture-token; future=fixture-token" },
  );
  assert.deepEqual(
    recoveryCookieHeader(
      [cookie()],
      origin,
      new URL("https://other.example.test/_agent-native/auth/session"),
      nowMs,
    ),
    { kind: "unreadable", reason: "origin" },
  );
  assert.deepEqual(
    recoveryCookieHeader(
      [cookie()],
      origin,
      new URL("http://beta.example.test/_agent-native/auth/session"),
      nowMs,
    ),
    { kind: "unreadable", reason: "origin" },
  );
});

test("distinguishes missing cookies from a header that exceeds its byte cap", () => {
  assert.deepEqual(
    recoveryCookieHeader(
      [cookie({ path: "/_agent-native/auth" })],
      origin,
      new URL("https://beta.example.test/_agent-native/agent-chat/threads/id"),
      nowMs,
    ),
    { kind: "missing" },
  );
  assert.deepEqual(
    recoveryCookieHeader([cookie()], origin, requestUrl, nowMs, 8),
    { kind: "unreadable", reason: "limit" },
  );
  assert.deepEqual(
    recoveryCookieHeader(
      [cookie({ path: "relative/path" })],
      origin,
      requestUrl,
      nowMs,
    ),
    { kind: "unreadable", reason: "cookie" },
  );
});

test("orders overlapping cookie paths longest first with stable ties", () => {
  assert.deepEqual(
    recoveryCookieHeader(
      [
        cookie({ name: "session", value: "wide", path: "/" }),
        cookie({ name: "session", value: "narrow", path: "/_agent-native" }),
        cookie({ name: "other", value: "tie-a", path: "/_agent-native" }),
        cookie({ name: "third", value: "tie-b", path: "/_agent-native" }),
      ],
      origin,
      requestUrl,
      nowMs,
    ),
    {
      kind: "header",
      value: "session=narrow; other=tie-a; third=tie-b; session=wide",
    },
  );
});
