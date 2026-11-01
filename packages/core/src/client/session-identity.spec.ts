// @vitest-environment happy-dom

import { afterEach, expect, it } from "vitest";

import {
  announceSessionInvalidated,
  currentSessionIdentity,
  recordSessionIdentity,
  SESSION_INVALIDATION_STORAGE_KEY,
  subscribeSessionIdentity,
  subscribeSessionInvalidation,
} from "./session-identity.js";

afterEach(() => recordSessionIdentity(undefined));

it("tells subscribers each time the tab's session changes, and only then", () => {
  const seen: Array<string | null | undefined> = [];
  const stop = subscribeSessionIdentity((value) => seen.push(value));
  recordSessionIdentity("ada@example.com");
  recordSessionIdentity("ada@example.com");
  recordSessionIdentity(null);
  expect(currentSessionIdentity()).toBeNull();

  stop();
  recordSessionIdentity("bob@example.com");
  expect(seen).toEqual(["ada@example.com", null]);
  expect(currentSessionIdentity()).toBe("bob@example.com");
});

it("keeps the key other tabs, old and new, listen on", () => {
  expect(SESSION_INVALIDATION_STORAGE_KEY).toBe(
    "agent-native:session-invalidated",
  );
});

it("tells invalidation subscribers when this tab or another starts changing the session", () => {
  let heard = 0;
  const stop = subscribeSessionInvalidation(() => heard++);
  announceSessionInvalidated();
  window.dispatchEvent(
    new StorageEvent("storage", { key: SESSION_INVALIDATION_STORAGE_KEY }),
  );
  window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
  expect(heard).toBe(2);

  stop();
  announceSessionInvalidated();
  expect(heard).toBe(2);
});
