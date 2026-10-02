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

type Stored = { scope: string; key: string; value: string };
const store = new Map<string, Stored>();

function scopeOf(ctx: {
  userEmail?: string;
  orgId?: string | null;
  scope?: "user" | "org";
}): string {
  if (!ctx?.userEmail) throw new Error("ctx.userEmail required");
  if (ctx.scope === "org") return `o:${ctx.orgId}`;
  return `u:${ctx.userEmail.toLowerCase()}`;
}

const resolveCredentialMock = vi.hoisted(() => vi.fn());
const resolveCredentialDetailedMock = vi.hoisted(() => vi.fn());
const saveCredentialMock = vi.hoisted(() => vi.fn());
const deleteCredentialMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const getOrgContextMock = vi.hoisted(() => vi.fn());
const readBodyMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: resolveCredentialMock,
  resolveCredentialDetailed: resolveCredentialDetailedMock,
  saveCredential: saveCredentialMock,
  deleteCredential: deleteCredentialMock,
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: getSessionMock,
  readBody: readBodyMock,
}));

vi.mock("@agent-native/core/org", () => ({
  getOrgContext: getOrgContextMock,
}));

import { apolloSaveKey, apolloStatus } from "../handlers/apollo.js";
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

const fakeEvent = {} as H3Event;

function storeKey(ctx: { userEmail: string }, key: string): string {
  return `${scopeOf(ctx)}::${key}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();

  getSessionMock.mockResolvedValue({ email: USER_EMAIL, orgId: null });
  getOrgContextMock.mockResolvedValue({ orgId: null });

  saveCredentialMock.mockImplementation(
    async (key: string, value: string, ctx: { userEmail: string }) => {
      const scope = scopeOf(ctx);
      store.set(`${scope}::${key}`, { scope, key, value });
    },
  );
  // A member's own row answers first, then the organization's.
  resolveCredentialDetailedMock.mockImplementation(
    async (key: string, ctx: { userEmail: string; orgId?: string | null }) => {
      const own = store.get(`${scopeOf(ctx)}::${key}`);
      if (own)
        return { value: own.value, scope: "user", scopeId: ctx.userEmail };
      const org = ctx.orgId ? store.get(`o:${ctx.orgId}::${key}`) : undefined;
      if (org) return { value: org.value, scope: "org", scopeId: ctx.orgId };
      return undefined;
    },
  );
  resolveCredentialMock.mockImplementation(
    async (key: string, ctx: { userEmail: string }) =>
      (await resolveCredentialDetailedMock(key, ctx))?.value,
  );
  deleteCredentialMock.mockImplementation(
    async (key: string, ctx: { userEmail: string }) => {
      store.delete(`${scopeOf(ctx)}::${key}`);
    },
  );
});

function signInAs(role: "owner" | "admin" | "member") {
  getSessionMock.mockResolvedValue({ email: USER_EMAIL, orgId: "org-1" });
  getOrgContextMock.mockResolvedValue({ orgId: "org-1", role });
}

describe("where a saved key lands", () => {
  it.each(["owner", "admin"] as const)(
    "saves an %s's key for the organization by default",
    async (role) => {
      signInAs(role);
      await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY);

      expect([...store.values()]).toEqual([
        { scope: "o:org-1", key: "APOLLO_API_KEY", value: APOLLO_KEY },
      ]);
    },
  );

  it("saves an admin's key personally when they choose Personal", async () => {
    signInAs("admin");
    await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY, "user");

    expect([...store.keys()]).toEqual([`u:${USER_EMAIL}::APOLLO_API_KEY`]);
  });

  it("saves a member's key personally by default", async () => {
    signInAs("member");
    await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY);

    expect([...store.keys()]).toEqual([`u:${USER_EMAIL}::APOLLO_API_KEY`]);
  });

  it("refuses a member's organization save with a 403 and writes nothing", async () => {
    signInAs("member");

    await expect(
      saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY, "org"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(saveCredentialMock).not.toHaveBeenCalled();
  });

  it("fails the save instead of storing it personally when the role cannot be read", async () => {
    getSessionMock.mockResolvedValue({ email: USER_EMAIL, orgId: "org-1" });
    getOrgContextMock.mockRejectedValue(new Error("org store down"));

    await expect(
      saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY),
    ).rejects.toThrow("org store down");
    expect(saveCredentialMock).not.toHaveBeenCalled();
  });

  it("rejects a scope it does not know with a 400", async () => {
    signInAs("admin");

    await expect(
      saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY, "workspace"),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(saveCredentialMock).not.toHaveBeenCalled();
  });

  it("passes the requested scope from the save route", async () => {
    signInAs("member");
    readBodyMock.mockResolvedValue({ apiKey: APOLLO_KEY, scope: "org" });

    await expect(
      (apolloSaveKey as unknown as (e: H3Event) => Promise<unknown>)(fakeEvent),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(saveCredentialMock).not.toHaveBeenCalled();
  });
});

describe("disconnect removes the key the reader uses", () => {
  it("removes the organization's key for an admin", async () => {
    signInAs("admin");
    await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY);

    expect(await deleteIntegrationKey(fakeEvent, "apollo")).toBe(true);
    expect(store.size).toBe(0);
  });

  it("refuses a member's disconnect of the organization's key", async () => {
    signInAs("admin");
    await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY);
    signInAs("member");

    await expect(
      deleteIntegrationKey(fakeEvent, "apollo"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(store.has("o:org-1::APOLLO_API_KEY")).toBe(true);
  });

  it("removes a member's own key", async () => {
    signInAs("member");
    await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY);

    expect(await deleteIntegrationKey(fakeEvent, "apollo")).toBe(true);
    expect(store.size).toBe(0);
  });
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

    expect(saveCredentialMock).toHaveBeenCalledWith(
      "APOLLO_API_KEY",
      APOLLO_KEY,
      expect.objectContaining({ userEmail: USER_EMAIL }),
    );

    const entries = [...store.values()];
    expect(entries).toHaveLength(1);
    expect(entries[0].scope).toBe(`u:${USER_EMAIL}`);
    expect(entries[0].scope).not.toBe("local");
    expect(entries[0].scope).not.toMatch(/local/i);
    expect(
      store.has(storeKey({ userEmail: USER_EMAIL }, "APOLLO_API_KEY")),
    ).toBe(true);

    for (const k of store.keys()) {
      expect(k).not.toMatch(/local/i);
      expect(k).not.toMatch(/session_id/i);
    }
  });

  it("does NOT leak one user's key to a different user (scope isolation)", async () => {
    await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY);

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
  async function invoke(handler: typeof apolloStatus) {
    return (handler as unknown as (e: H3Event) => Promise<unknown>)(fakeEvent);
  }

  it("apolloStatus returns ONLY { connected: true } once a key is stored", async () => {
    await saveIntegrationKey(fakeEvent, "apollo", APOLLO_KEY);

    const res = await invoke(apolloStatus);

    expect(res).toEqual({ connected: true });
    expect(Object.keys(res as object)).toEqual(["connected"]);

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
