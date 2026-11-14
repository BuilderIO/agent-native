import { createApp, H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  embeddedCredential: vi.fn(),
}));
vi.mock("../db/client.js", async (original) => ({
  ...(await original<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("./better-auth-instance.js", async (original) => ({
  ...(await original<typeof import("./better-auth-instance.js")>()),
  resumeIdentityRekeysForEmail: vi.fn(),
}));
vi.mock("./embed-session.js", async (original) => ({
  ...(await original<typeof import("./embed-session.js")>()),
  resolveEmbedSessionFromRequest: mocks.embeddedCredential,
}));
vi.mock("../settings/user-settings.js", async (original) => ({
  ...(await original<typeof import("../settings/user-settings.js")>()),
  getUserSetting: vi.fn(async () => null),
}));

import { getOrgContext } from "../org/context.js";
import { __resetProcessMemberOrgCacheForTests } from "../org/request-org-cache.js";
import { ForbiddenError } from "../sharing/errors.js";
import { autoMountAuth, getSession } from "./auth.js";
import {
  createAgentNativeEmbeddedAuthOptions,
  type AgentNativeEmbeddedHostSession,
} from "./embedded.js";
import {
  markExplicitPersonalOrgScope,
  runWithRequestContext,
} from "./request-context.js";

function event() {
  return new H3Event(
    new Request("https://host.example.test/_agent-native/extensions"),
  );
}

async function configure(
  resolve: () => Promise<AgentNativeEmbeddedHostSession | null>,
) {
  const options = createAgentNativeEmbeddedAuthOptions(resolve);
  expect(options).toBeDefined();
  await autoMountAuth(createApp(), options);
  return options;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_DISABLED", "false");
  vi.stubEnv("ACCESS_TOKEN", "");
  vi.stubEnv("ACCESS_TOKENS", "");
  __resetProcessMemberOrgCacheForTests();
  vi.clearAllMocks();
  mocks.embeddedCredential.mockReset().mockResolvedValue(null);
  mocks.execute.mockReset().mockResolvedValue({ rows: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe("selected embedded host organization authority", () => {
  it.each(["owner", "admin", "member"] as const)(
    "uses the host's verified %s scope without a local roster",
    async (role) => {
      await configure(async () => ({
        email: "member@example.test",
        orgId: "host-org",
        orgRole: role,
      }));
      await expect(getOrgContext(event())).resolves.toEqual({
        email: "member@example.test",
        orgId: "host-org",
        orgName: null,
        role,
      });
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );

  it("does not invent an org-admin role when the host omits it", async () => {
    await configure(async () => ({
      email: "member@example.test",
      orgId: "host-org",
    }));
    await expect(getOrgContext(event())).resolves.toMatchObject({
      orgId: "host-org",
      role: null,
    });
  });

  it("keeps explicit host Personal scope despite local membership", async () => {
    mocks.execute.mockResolvedValue({
      rows: [{ orgId: "local-org", orgName: "Local", role: "admin" }],
    });
    await configure(async () => ({
      email: "member@example.test",
      orgId: null,
    }));
    await expect(getOrgContext(event())).resolves.toMatchObject({
      orgId: null,
      role: null,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("keeps explicit primary Personal scope above a stale organization alias", async () => {
    await configure(async () => ({
      email: "member@example.test",
      orgId: null,
      organizationId: "previous-org",
      role: "admin",
    }));
    const request = event();
    await expect(getSession(request)).resolves.toHaveProperty(
      "orgId",
      undefined,
    );
    await expect(getSession(request)).resolves.toHaveProperty(
      "orgRole",
      undefined,
    );
    await expect(getOrgContext(request)).resolves.toMatchObject({
      orgId: null,
      role: null,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("retains alias-only organization selection", async () => {
    await configure(async () => ({
      email: "member@example.test",
      organizationId: "alias-org",
      role: "admin",
    }));
    await expect(getOrgContext(event())).resolves.toMatchObject({
      orgId: "alias-org",
      role: "admin",
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("honors an explicit Personal alias when the primary organization is blank", async () => {
    mocks.execute.mockResolvedValue({
      rows: [{ orgId: "local-org", orgName: "Local", role: "admin" }],
    });
    await configure(async () => ({
      email: "member@example.test",
      orgId: " ",
      organizationId: null,
      role: "admin",
    }));
    await expect(getOrgContext(event())).resolves.toMatchObject({
      orgId: null,
      role: null,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("does not restore an explicitly cleared primary role from its alias", async () => {
    await configure(async () => ({
      email: "member@example.test",
      orgId: "host-org",
      orgRole: null,
      role: "admin",
    }));
    await expect(getOrgContext(event())).resolves.toMatchObject({
      orgId: "host-org",
      role: null,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(["57014", "42501"])(
    "classifies a host lookup failure %s rather than selecting another identity",
    async (code) => {
      const cause = Object.assign(new Error("Fake host lookup diagnostics"), {
        code,
      });
      await configure(async () => {
        throw cause;
      });
      await expect(getOrgContext(event())).rejects.toMatchObject({
        statusCode: code === "57014" ? 503 : 500,
        cause,
      });
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );

  it("preserves a host's definitive refusal", async () => {
    const refusal = new ForbiddenError();
    await configure(async () => {
      throw refusal;
    });
    await expect(getOrgContext(event())).rejects.toBe(refusal);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("rejects unsupported host org roles", async () => {
    await configure(async () => ({
      email: "member@example.test",
      orgId: "host-org",
      orgRole: "superadmin",
    }));
    await expect(getOrgContext(event())).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(["email", "orgId", "orgRole"] as const)(
    "does not reuse host authority after changing %s",
    async (field) => {
      const options = await configure(async () => ({
        email: "member@example.test",
        orgId: "host-org",
        orgRole: "admin",
      }));
      const request = event();
      const candidate = await options?.getSession?.(request);
      expect(candidate).toBeDefined();
      if (!candidate) throw new Error("Missing fixture candidate");
      candidate[field] = field === "orgRole" ? "owner" : "different";
      await autoMountAuth(createApp(), { getSession: async () => candidate });
      await expect(getOrgContext(request)).resolves.toMatchObject({
        orgId: null,
        role: null,
      });
      expect(mocks.execute).toHaveBeenCalled();
    },
  );

  it("does not transfer host authority to a later request", async () => {
    const options = await configure(async () => ({
      email: "member@example.test",
      orgId: "host-org",
      orgRole: "admin",
    }));
    const candidate = await options?.getSession?.(event());
    await autoMountAuth(createApp(), {
      getSession: async () => candidate ?? null,
    });
    await expect(getOrgContext(event())).resolves.toMatchObject({
      orgId: null,
      role: null,
    });
  });

  it("does not grant host authority merely because a host callback was also evaluated", async () => {
    const options = await configure(async () => ({
      email: "member@example.test",
      orgId: "host-org",
      orgRole: "admin",
    }));
    const request = event();
    await options?.getSession?.(request);
    mocks.embeddedCredential.mockResolvedValue({
      email: "member@example.test",
      orgId: "host-org",
      token: "fake-winning-embed-credential",
    });
    await expect(getOrgContext(request)).resolves.toMatchObject({
      orgId: null,
      role: null,
    });
    expect(mocks.execute).toHaveBeenCalled();
  });

  it("keeps explicit Personal selection above host organization authority", async () => {
    await configure(async () => ({
      email: "member@example.test",
      orgId: "host-org",
      orgRole: "admin",
    }));
    const request = event();
    markExplicitPersonalOrgScope(request);
    await expect(getOrgContext(request)).resolves.toMatchObject({
      orgId: null,
      role: null,
    });
  });

  it("does not let host authority bypass delegated membership verification", async () => {
    await configure(async () => ({
      email: "member@example.test",
      orgId: "host-org",
      orgRole: "admin",
    }));
    await expect(
      runWithRequestContext(
        {
          userEmail: "member@example.test",
          orgId: "host-org",
          a2aIdentityAssurance: "org-member",
        },
        () => getOrgContext(event()),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not give an ordinary custom session the embedded host's authority", async () => {
    await autoMountAuth(createApp(), {
      getSession: async () => ({
        email: "member@example.test",
        orgId: "stale-org",
        orgRole: "admin",
      }),
    });
    const request = event();
    await expect(getSession(request)).resolves.toMatchObject({
      orgId: "stale-org",
    });
    await expect(getOrgContext(request)).resolves.toMatchObject({
      orgId: null,
      role: null,
    });
  });

  it("keeps omitted host scope on the existing local-membership path", async () => {
    mocks.execute.mockResolvedValue({
      rows: [{ orgId: "local-org", orgName: "Local", role: "member" }],
    });
    await configure(async () => ({ email: "member@example.test" }));
    await expect(getOrgContext(event())).resolves.toMatchObject({
      orgId: "local-org",
      role: "member",
    });
  });
});
