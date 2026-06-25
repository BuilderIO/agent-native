import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetOrgDirectoryCache,
  fetchOrgApps,
  resolveOrgDirectoryOrigin,
} from "./org-directory.js";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.AGENT_NATIVE_ORG_DIRECTORY_URL;
  delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
}

beforeEach(() => {
  resetEnv();
  _resetOrgDirectoryCache();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// `fetchOrgApps` reuses resolveA2ACallerAuth() for the bearer. Mock it so the
// directory-fetch behavior is testable without a request context / DB.
vi.mock("../a2a/caller-auth.js", () => ({
  resolveA2ACallerAuth: vi.fn(async () => ({
    apiKey: "signed-org-jwt",
    userEmail: "caller@acme.com",
    orgDomain: "acme.com",
    orgSecret: "org-secret",
    metadata: {},
  })),
}));

describe("resolveOrgDirectoryOrigin", () => {
  it("returns null when neither directory env is set (feature inactive)", () => {
    expect(resolveOrgDirectoryOrigin({})).toBeNull();
  });

  it("reads the dedicated AGENT_NATIVE_ORG_DIRECTORY_URL env", () => {
    expect(
      resolveOrgDirectoryOrigin({
        AGENT_NATIVE_ORG_DIRECTORY_URL: "https://dispatch.acme.com/",
      }),
    ).toBe("https://dispatch.acme.com");
  });

  it("falls back to AGENT_NATIVE_IDENTITY_HUB_URL (Dispatch is the hub)", () => {
    expect(
      resolveOrgDirectoryOrigin({
        AGENT_NATIVE_IDENTITY_HUB_URL: "https://hub.acme.com",
      }),
    ).toBe("https://hub.acme.com");
  });

  it("rejects non-http(s) values", () => {
    expect(
      resolveOrgDirectoryOrigin({
        AGENT_NATIVE_ORG_DIRECTORY_URL: "ftp://bad",
      }),
    ).toBeNull();
    expect(
      resolveOrgDirectoryOrigin({ AGENT_NATIVE_ORG_DIRECTORY_URL: "   " }),
    ).toBeNull();
  });
});

describe("fetchOrgApps", () => {
  it("returns [] without fetching when no directory env is configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const apps = await fetchOrgApps({ selfId: "mail" });
    expect(apps).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches the directory and normalizes the app list", async () => {
    process.env.AGENT_NATIVE_ORG_DIRECTORY_URL = "https://dispatch.acme.com";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://dispatch.acme.com/_agent-native/org/apps");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer signed-org-jwt",
      );
      return new Response(
        JSON.stringify({
          org: "acme",
          apps: [
            {
              id: "Calendar",
              name: "Calendar",
              url: "https://calendar.acme.com/",
              a2aUrl: "https://calendar.acme.com/_agent-native/a2a",
              capabilities: ["events"],
            },
            { id: "mail", name: "Mail", url: "https://mail.acme.com" },
            { bogus: true },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const apps = await fetchOrgApps({ selfId: "mail" });
    // mail is the current app → stripped; bogus entry → dropped.
    expect(apps).toEqual([
      {
        id: "calendar",
        name: "Calendar",
        url: "https://calendar.acme.com",
        a2aUrl: "https://calendar.acme.com/_agent-native/a2a",
        capabilities: ["events"],
      },
    ]);
  });

  it("strips the current app by origin too", async () => {
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL = "https://hub.acme.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              apps: [
                { id: "self", name: "Self", url: "https://me.acme.com" },
                { id: "other", name: "Other", url: "https://other.acme.com" },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const apps = await fetchOrgApps({
      selfId: "ignored",
      selfOrigin: "https://me.acme.com",
    });
    expect(apps.map((a) => a.id)).toEqual(["other"]);
  });

  it("returns [] silently on a non-2xx response (no throw)", async () => {
    process.env.AGENT_NATIVE_ORG_DIRECTORY_URL = "https://dispatch.acme.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    await expect(fetchOrgApps({ selfId: "mail" })).resolves.toEqual([]);
  });

  it("returns [] silently when the directory is unreachable (no throw)", async () => {
    process.env.AGENT_NATIVE_ORG_DIRECTORY_URL = "https://dispatch.acme.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(fetchOrgApps({ selfId: "mail" })).resolves.toEqual([]);
  });

  it("returns [] silently on bad JSON (no throw)", async () => {
    process.env.AGENT_NATIVE_ORG_DIRECTORY_URL = "https://dispatch.acme.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<<not json>>", { status: 200 })),
    );
    await expect(fetchOrgApps({ selfId: "mail" })).resolves.toEqual([]);
  });

  it("caches a successful fetch (not re-fetched on every call)", async () => {
    process.env.AGENT_NATIVE_ORG_DIRECTORY_URL = "https://dispatch.acme.com";
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            apps: [{ id: "calendar", name: "Cal", url: "https://c.acme.com" }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const a = await fetchOrgApps({ selfId: "mail" });
    const b = await fetchOrgApps({ selfId: "mail" });
    expect(a).toEqual(b);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("scopes the cache by caller org identity", async () => {
    process.env.AGENT_NATIVE_ORG_DIRECTORY_URL = "https://dispatch.acme.com";
    const mod = await import("../a2a/caller-auth.js");
    vi.mocked(mod.resolveA2ACallerAuth)
      .mockResolvedValueOnce({
        apiKey: "jwt-org-a",
        userEmail: "caller@acme.com",
        orgId: "org-a",
        orgDomain: "a.example",
        orgSecret: "secret-a",
        metadata: {},
      })
      .mockResolvedValueOnce({
        apiKey: "jwt-org-b",
        userEmail: "caller@acme.com",
        orgId: "org-b",
        orgDomain: "b.example",
        orgSecret: "secret-b",
        metadata: {},
      })
      .mockResolvedValueOnce({
        apiKey: "jwt-org-a",
        userEmail: "caller@acme.com",
        orgId: "org-a",
        orgDomain: "a.example",
        orgSecret: "secret-a",
        metadata: {},
      });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            apps: [
              { id: "calendar", name: "Cal", url: "https://a.example/cal" },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            apps: [{ id: "mail", name: "Mail", url: "https://b.example/mail" }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchOrgApps({ selfId: "dispatch" })).resolves.toEqual([
      expect.objectContaining({ id: "calendar" }),
    ]);
    await expect(fetchOrgApps({ selfId: "dispatch" })).resolves.toEqual([
      expect.objectContaining({ id: "mail" }),
    ]);
    await expect(fetchOrgApps({ selfId: "dispatch" })).resolves.toEqual([
      expect.objectContaining({ id: "calendar" }),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("degrades silently when no signed bearer is available", async () => {
    process.env.AGENT_NATIVE_ORG_DIRECTORY_URL = "https://dispatch.acme.com";
    const mod = await import("../a2a/caller-auth.js");
    vi.mocked(mod.resolveA2ACallerAuth).mockResolvedValueOnce({
      apiKey: undefined,
      userEmail: undefined,
      orgDomain: undefined,
      orgSecret: undefined,
      metadata: {},
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchOrgApps({ selfId: "mail" })).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not cache unauthenticated empty results across a later valid caller", async () => {
    process.env.AGENT_NATIVE_ORG_DIRECTORY_URL = "https://dispatch.acme.com";
    const mod = await import("../a2a/caller-auth.js");
    vi.mocked(mod.resolveA2ACallerAuth)
      .mockResolvedValueOnce({
        apiKey: undefined,
        userEmail: undefined,
        orgDomain: undefined,
        orgSecret: undefined,
        metadata: {},
      })
      .mockResolvedValueOnce({
        apiKey: "signed-org-jwt",
        userEmail: "caller@acme.com",
        orgId: "org-a",
        orgDomain: "acme.com",
        orgSecret: "org-secret",
        metadata: {},
      });
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            apps: [{ id: "calendar", name: "Cal", url: "https://c.acme.com" }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchOrgApps({ selfId: "mail" })).resolves.toEqual([]);
    await expect(fetchOrgApps({ selfId: "mail" })).resolves.toEqual([
      expect.objectContaining({ id: "calendar" }),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
