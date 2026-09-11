/**
 * Tests for the custom-provider registry's authorization guard.
 *
 * Plan 014 (advisor-plans/014-custom-registry-scope-authorization.md): any
 * authenticated org member could previously upsert/delete an ORG-scoped
 * custom API provider (base URL, allowed host suffixes, credential key
 * names) with no owner/admin check. These tests cover the defense-in-depth
 * guard added to close that gap — `assertCanMutateCustomProviderScope` and
 * its wiring into `upsertCustomProvider` / `deleteCustomProvider`.
 *
 * The negative cases below never reach `ensureTable()` / `getDbExec()` (the
 * guard is the first statement in both mutating functions), so no DB mock
 * is needed here.
 */

import { describe, expect, it } from "vitest";

import {
  assertCanMutateCustomProviderScope,
  CustomProviderAuthError,
  deleteCustomProvider,
  upsertCustomProvider,
} from "./custom-registry.js";

describe("assertCanMutateCustomProviderScope", () => {
  it("allows user-scope writes regardless of org role", () => {
    expect(() =>
      assertCanMutateCustomProviderScope("user", "someone@example.com", null),
    ).not.toThrow();
    expect(() =>
      assertCanMutateCustomProviderScope(
        "user",
        "someone@example.com",
        "member",
      ),
    ).not.toThrow();
  });

  it("allows org-scope writes for an owner or admin", () => {
    expect(() =>
      assertCanMutateCustomProviderScope("org", "org-1", "owner"),
    ).not.toThrow();
    expect(() =>
      assertCanMutateCustomProviderScope("org", "org-1", "admin"),
    ).not.toThrow();
  });

  it("rejects org-scope writes for a plain member", () => {
    expect(() =>
      assertCanMutateCustomProviderScope("org", "org-1", "member"),
    ).toThrow(CustomProviderAuthError);
  });

  it("rejects org-scope writes when no role could be resolved", () => {
    expect(() =>
      assertCanMutateCustomProviderScope("org", "org-1", null),
    ).toThrow(CustomProviderAuthError);
  });

  it("throws a 403 with an actionable message", () => {
    expect.assertions(3);
    try {
      assertCanMutateCustomProviderScope("org", "org-1", "member");
    } catch (err) {
      expect(err).toBeInstanceOf(CustomProviderAuthError);
      expect((err as CustomProviderAuthError).statusCode).toBe(403);
      expect((err as Error).message).toMatch(/owners and admins/i);
    }
  });
});

describe("upsertCustomProvider / deleteCustomProvider — defense in depth", () => {
  it("rejects an org-scope upsert from a non-admin before any table access", async () => {
    await expect(
      upsertCustomProvider({
        scope: "org",
        scopeId: "org-1",
        id: "my-api",
        label: "My API",
        baseUrl: "https://api.example.com",
        auth: { type: "none" },
        orgRole: "member",
      }),
    ).rejects.toThrow(CustomProviderAuthError);
  });

  it("rejects an org-scope delete from a non-admin before any table access", async () => {
    await expect(
      deleteCustomProvider("org", "org-1", "my-api", "member"),
    ).rejects.toThrow(CustomProviderAuthError);
  });

  it("rejects an org-scope delete when orgRole is null", async () => {
    await expect(
      deleteCustomProvider("org", "org-1", "my-api", null),
    ).rejects.toThrow(CustomProviderAuthError);
  });
});
