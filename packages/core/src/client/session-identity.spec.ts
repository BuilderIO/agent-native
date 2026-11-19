// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { SESSION_INVALIDATION_STORAGE_KEY } from "../shared/ssr-session-bootstrap.js";
import {
  announceSessionInvalidated,
  currentPrivateActionScope,
  currentSessionIdentity,
  currentSessionScope,
  recordSessionIdentity,
  subscribeSessionIdentity,
  subscribeSessionInvalidation,
  subscribeSessionScope,
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

describe("session scope", () => {
  it("rotates for user, organization and authenticated actor transitions, including ABA", () => {
    recordSessionIdentity("scope-user", "scope-org", "scope-actor");
    const first = currentSessionScope();
    recordSessionIdentity("scope-user", "scope-org", "scope-actor");
    expect(currentSessionScope()).toBe(first);
    recordSessionIdentity("scope-user", "scope-other-org", "scope-actor");
    expect(currentSessionScope()).not.toBe(first);
    const organization = currentSessionScope();
    recordSessionIdentity("scope-user", "scope-other-org", "scope-other-actor");
    expect(currentSessionScope()).not.toBe(organization);
    recordSessionIdentity("scope-user", "scope-org", "scope-actor");
    expect(currentSessionScope()).not.toBe(first);
    expect(currentSessionIdentity()).toBe("scope-user");
  });

  it("isolates cancellation subscribers and supports unsubscribe", () => {
    const stopThrower = subscribeSessionScope(() => {
      throw new Error("subscriber failure");
    });
    const listener = vi.fn();
    const stop = subscribeSessionScope(listener);
    try {
      expect(() => recordSessionIdentity("scope-next-user")).not.toThrow();
      expect(listener).toHaveBeenCalledTimes(1);
      stop();
      recordSessionIdentity(null);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      stop();
      stopThrower();
    }
  });
  it("requires explicit known org, email and authenticated actor for private inputs", () => {
    recordSessionIdentity(
      "scope-user",
      undefined,
      "auth-user",
      "user@example.test",
    );
    expect(currentPrivateActionScope()).toBeUndefined();
    recordSessionIdentity("scope-user", null, undefined, "user@example.test");
    expect(currentPrivateActionScope()).toBeUndefined();
    recordSessionIdentity("scope-user", null, "auth-user");
    expect(currentPrivateActionScope()).toBeUndefined();
    recordSessionIdentity(
      "scope-user",
      null,
      " auth-user ",
      " User@Example.Test ",
    );
    expect(currentPrivateActionScope()).toEqual({
      email: "user@example.test",
      orgId: null,
      authUserId: "auth-user",
    });
    expect(Object.isFrozen(currentPrivateActionScope())).toBe(true);
    recordSessionIdentity(null, null, "auth-user", "user@example.test");
    expect(currentPrivateActionScope()).toBeUndefined();
  });

  it("rotates epoch on email changes and never restores an older knownscope object", () => {
    recordSessionIdentity(
      "scope-user",
      "scope-org",
      "auth-user",
      "first@example.test",
    );
    const first = currentSessionScope();
    const known = currentPrivateActionScope();
    recordSessionIdentity(
      "scope-user",
      "scope-org",
      "auth-user",
      "second@example.test",
    );
    expect(currentSessionScope()).not.toBe(first);
    expect(currentPrivateActionScope()?.email).toBe("second@example.test");
    recordSessionIdentity(
      "scope-user",
      "scope-org",
      "auth-user",
      "first@example.test",
    );
    expect(currentSessionScope()).not.toBe(first);
    expect(currentPrivateActionScope()).not.toBe(known);
  });
});
