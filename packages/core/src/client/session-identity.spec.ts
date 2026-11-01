import { afterEach, expect, it } from "vitest";

import {
  currentSessionIdentity,
  recordSessionIdentity,
  SESSION_INVALIDATION_STORAGE_KEY,
  subscribeSessionIdentity,
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
