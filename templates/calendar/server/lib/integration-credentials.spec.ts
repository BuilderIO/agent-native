import type { H3Event } from "h3";
/**
 * Security regression test for the CRM-integration key exposure fix.
 *
 * Proves the two properties of the fix:
 *   1. Apollo/HubSpot/Gong/Pylon API keys are persisted through the framework
 *      per-user credential vault (`saveCredential`/`resolveCredential`) under a
 *      per-user scope — NOT under a hardcoded shared scope and NOT in
 *      `application_state`.
 *   2. The status/read path returns ONLY `{ connected: boolean }`; the raw key
 *      value is never part of any status response surfaced to the browser.
 *
 * The framework credential layer is mocked with an in-memory store keyed by the
 * same `CredentialContext` shape the real vault uses, so no real DB/session is
 * needed. The store records every key the helpers write so we can assert the
 * scope a value lands under.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- In-memory stand-in for the framework credential vault -------------------
// Keyed by `<scope>::<KEY>` where scope is `u:<email>` (per-user) or
// `o:<orgId>` (per-org). This mirrors the real settings-store key shape so a
// regression to a shared/"local" scope would be observable in `storedKeys`.
type Stored = { scope: string; key: string; value: string };
const store = new Map<string, Stored>();

function scopeOf(ctx: { userEmail?: string; orgId?: string | null }): string {
  if (!ctx?.userEmail) throw new Error("ctx.userEmail required");
  return `u:${ctx.userEmail.toLowerCase()}`;
}

const resolveCredentialMock = vi.hoisted(() => vi.fn());
const saveCredentialMock = vi.hoisted(() => vi.fn());
const deleteCredentialMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const getOrgContextMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: resolveCredentialMock,
  saveCredential: saveCredentialMock,
  deleteCredential: deleteCredentialMock,
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: getSessionMock,
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: getOrgContextMock,
}));

import { apolloStatus } from "../handlers/apollo.js";
import { hubspotStatus } from "../handlers/hubspot.js";
import {
  getIntegrationKey,
  saveIntegrationKey,
  deleteIntegrationKey,
  getIntegrationContext,
} from "./integration-credentials.js";

const APOLLO_KEY = "apollo-secret-key-abc123";
const HUBSPOT_KEY = "pat-na1-hubspot-secret-xyz789";
const USER_EMAIL = "steve@example.com";

// A fake h3 event — the integration helpers only pass it to getSession /
// getOrgContext, both mocked, so the object itself is opaque here.
const fakeEvent = {} as H3Event;

function storeKey(ctx: { userEmail: string }, key: string): string {
  return `${scopeOf(ctx)}::${key}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();

  // Authenticated session for steve@example.com, no active org.
  getSessionMock.mockResolvedValue({ email: USER_EMAIL, orgId: null });
  getOrgContextMock.mockResolvedValue({ orgId: null });

  // Wire the mocked vault to the in-memory store, enforcing per-user scoping.
  saveCredentialMock.mockImplementation(
    async (key: string, value: string, ctx: { userEmail: string }) => {
      const scope = scopeOf(ctx);
      store.set(`${scope}::${key}`, { scope, key, value });
    },
  );
  resolveCredentialMock.mockImplementation(
    async (key: string, ctx: { userEmail: string }) =>
      store.get(`${scopeOf(ctx)}::${key}`)?.value,
  );
  deleteCredentialMock.mockImplementation(
    async (key: string, ctx: { userEmail: string }) => {
      store.delete(`${scopeOf(ctx)}::${key}`);
    },
  );
});

describe("integration-credentials per-user vault", () => {
  it("round-trips a key through the per-user credential vault", async () => {
    const saved = await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY);
    expect(saved).toBe(true);

    const got = await getIntegrationKey(fakeEvent, "apollo");
    expect(got).toBe(APOLLO_KEY);
  });

  it("stores the key under a per-user scope, never a shared/'local' scope", async () => {
    await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY);

    // saveCredential was called with the per-user CredentialContext and the
    // canonical <PROVIDER>_API_KEY vault key — not appStateGet/"local".
    expect(saveCredentialMock).toHaveBeenCalledWith(
      "APOLLO_API_KEY",
      APOLLO_KEY,
      expect.objectContaining({ userEmail: USER_EMAIL }),
    );

    // The only entry in the store is under the per-user scope.
    const entries = [...store.values()];
    expect(entries).toHaveLength(1);
    expect(entries[0].scope).toBe(`u:${USER_EMAIL}`);
    expect(entries[0].scope).not.toBe("local");
    expect(entries[0].scope).not.toMatch(/local/i);
    expect(
      store.has(storeKey({ userEmail: USER_EMAIL }, "APOLLO_API_KEY")),
    ).toBe(true);

    // No write was made under any shared "local"/"session_id" scope.
    for (const k of store.keys()) {
      expect(k).not.toMatch(/local/i);
      expect(k).not.toMatch(/session_id/i);
    }
  });

  it("does NOT leak one user's key to a different user (scope isolation)", async () => {
    // steve saves a key
    await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY);

    // A different authenticated user must not resolve steve's key.
    getSessionMock.mockResolvedValue({
      email: "other@example.com",
      orgId: null,
    });
    getOrgContextMock.mockResolvedValue({ orgId: null });
    const leaked = await getIntegrationKey(fakeEvent, "apollo");
    expect(leaked).toBeUndefined();
  });

  it("returns undefined / fails closed for an unauthenticated request", async () => {
    getSessionMock.mockResolvedValue(null);
    getOrgContextMock.mockResolvedValue(null);

    expect(await getIntegrationContext(fakeEvent)).toBeNull();
    expect(await getIntegrationKey(fakeEvent, "apollo")).toBeUndefined();
    expect(await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY)).toBe(
      false,
    );
    expect(saveCredentialMock).not.toHaveBeenCalled();
  });

  it("deletes a key from the per-user vault", async () => {
    await saveIntegrationKey(fakeEvent, "hubspot", HUBSPOT_KEY);
    expect(await getIntegrationKey(fakeEvent, "hubspot")).toBe(HUBSPOT_KEY);

    const removed = await deleteIntegrationKey(fakeEvent, "hubspot");
    expect(removed).toBe(true);
    expect(await getIntegrationKey(fakeEvent, "hubspot")).toBeUndefined();
  });

  it("does not treat a lone Gong access key as connected", async () => {
    saveCredentialMock.mockImplementation(
      async (key: string, value: string, ctx: { userEmail: string }) => {
        const scope = scopeOf(ctx);
        store.set(`${scope}::${key}`, { scope, key, value });
      },
    );

    await saveCredentialMock("GONG_ACCESS_KEY", "gong-access", {
      userEmail: USER_EMAIL,
    });

    expect(await getIntegrationKey(fakeEvent, "gong")).toBeUndefined();
  });

  it("resolves Gong access key and secret as a complete basic-auth key", async () => {
    await saveCredentialMock("GONG_ACCESS_KEY", "gong-access", {
      userEmail: USER_EMAIL,
    });
    await saveCredentialMock("GONG_ACCESS_SECRET", "gong-secret", {
      userEmail: USER_EMAIL,
    });

    expect(await getIntegrationKey(fakeEvent, "gong")).toBe(
      "gong-access:gong-secret",
    );
  });
});

describe("status read path never exposes the raw key", () => {
  // The status handlers are plain h3 handlers; invoking them directly runs the
  // real handler body (the same code the mounted route runs).
  async function invoke(handler: typeof apolloStatus) {
    return (handler as unknown as (e: H3Event) => Promise<unknown>)(fakeEvent);
  }

  it("apolloStatus returns ONLY { connected: true } once a key is stored", async () => {
    await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY);

    const res = await invoke(apolloStatus);

    // Shape is exactly { connected: boolean } — no key field.
    expect(res).toEqual({ connected: true });
    expect(Object.keys(res as object)).toEqual(["connected"]);

    // The raw key must not appear anywhere in the serialized response.
    expect(JSON.stringify(res)).not.toContain(APOLLO_KEY);
  });

  it("apolloStatus returns { connected: false } when no key is stored", async () => {
    const res = await invoke(apolloStatus);
    expect(res).toEqual({ connected: false });
    expect(JSON.stringify(res)).not.toContain(APOLLO_KEY);
  });

  it("hubspotStatus returns ONLY { connected: boolean } and never the key", async () => {
    await saveIntegrationKey(fakeEvent, "hubspot", HUBSPOT_KEY);

    const res = await invoke(hubspotStatus);
    expect(res).toEqual({ connected: true });
    expect(Object.keys(res as object)).toEqual(["connected"]);
    expect(JSON.stringify(res)).not.toContain(HUBSPOT_KEY);
  });
});
