import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  ticket: vi.fn(),
  member: vi.fn(),
  sign: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("../server/embed-session.js", async (original) => ({
  ...(await original<object>()),
  createEmbedSessionTicket: mocks.ticket,
  signEmbedSessionToken: mocks.sign,
  resolveEmbedSessionTokenForOrigin: mocks.resolve,
}));
vi.mock("../org/membership.js", () => ({ isOrgMember: mocks.member }));
vi.mock("./credential-membership.js", () => ({
  checkCredentialOrgMembership: async () => "member",
  checkCredentialEmailRetirement: async () => "current",
}));
import { signA2AToken } from "../a2a/client.js";
import * as orgContext from "../org/context.js";
import { runWithRequestContext } from "../server/request-context.js";
import type { MCPCallerIdentity } from "./build-server.js";
import { verifyAuth } from "./build-server.js";
import { getBuiltinCrossAppTools } from "./builtin-tools.js";
import { signMcpOAuthAccessToken } from "./oauth-token.js";
const config = { name: "Test", actions: {} };
const owner = "owner@example.com";
const identity: MCPCallerIdentity = {
  userEmail: owner,
  identityAssurance: "user",
  orgId: "workspace",
  orgDomain: undefined,
  firstPartyMcp: true,
  workspaceAppChatIssuedAtMs: Date.now() - 1000,
};
beforeEach(() => {
  mocks.ticket.mockReset().mockResolvedValue({
    ticket: "test-ticket",
    expiresAt: Date.now() + 900000,
  });
  mocks.sign.mockReset().mockReturnValue("server-held-chat-token");
  mocks.resolve
    .mockReset()
    .mockResolvedValue({ exp: Math.floor(Date.now() / 1000) + 900 });
  mocks.member.mockReset().mockResolvedValue(true);
});
function mint(
  caller: MCPCallerIdentity | undefined = identity,
  args = { path: "/", runtime: "workspace-app-chat" },
  context = {},
) {
  const tools = getBuiltinCrossAppTools(
    config,
    { inlineMcpApps: true },
    caller,
  );
  return runWithRequestContext(
    {
      userEmail: owner,
      orgId: "workspace",
      requestOrigin: "https://apps.example.test",
      mcpCredentialIssuedAtMs: Date.now() - 1000,
      ...context,
    },
    () => tools.create_embed_session!.run(args),
  );
}
it("mints an explicitly scoped, bounded, owner-revocable server chat credential", async () => {
  const result = await mint();
  expect(result).toMatchObject({
    runtime: "workspace-app-chat",
    token: "server-held-chat-token",
  });
  expect(result).not.toHaveProperty("startUrl");
  expect(mocks.ticket).not.toHaveBeenCalled();
  expect(mocks.sign).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerEmail: owner,
      orgId: "workspace",
      scope: "capability:workspace-app-chat",
      ttlSeconds: 900,
      ticketCreatedAtMs: expect.any(Number),
    }),
  );
  expect(mocks.member).toHaveBeenCalledWith("workspace", owner, {
    requireOrganizationMetadata: true,
  });
});
it.each(["service", "organization", "org-member"] as const)(
  "rejects %s authority for chat minting",
  async (assurance) => {
    await expect(
      mint({ ...identity, identityAssurance: assurance }),
    ).rejects.toThrow(/verified scoped/);
    expect(mocks.ticket).not.toHaveBeenCalled();
  },
);
it("rejects owner and organization mismatches and missing credential provenance", async () => {
  await expect(
    mint({ ...identity, userEmail: "other@example.com" }),
  ).rejects.toThrow(/verified scoped/);
  await expect(mint({ ...identity, orgId: "other-workspace" })).rejects.toThrow(
    /verified scoped/,
  );
  await expect(
    mint({ ...identity, workspaceAppChatIssuedAtMs: undefined }, undefined, {
      mcpCredentialIssuedAtMs: Date.now(),
    }),
  ).rejects.toThrow(/verified scoped/);
  expect(mocks.ticket).not.toHaveBeenCalled();
});
it("refuses removed membership and membership lookup errors", async () => {
  mocks.member.mockResolvedValue(false);
  await expect(mint()).rejects.toThrow(/membership/);
  mocks.member.mockRejectedValue(new Error("membership unavailable"));
  await expect(mint()).rejects.toThrow(/membership unavailable/);
  expect(mocks.ticket).not.toHaveBeenCalled();
});
it("keeps ordinary embed requests document-only", async () => {
  await mint(identity, { path: "/", chrome: "minimal" } as any);
  expect(mocks.ticket).toHaveBeenCalledWith({
    ownerEmail: owner,
    orgId: "workspace",
    targetPath: "/",
    scope: "minimal",
  });
});
it("preserves explicit personal authority", async () => {
  await mint({ ...identity, orgId: null }, undefined, {
    orgId: undefined,
    orgScope: "personal",
  });
  expect(mocks.sign).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: "capability:workspace-app-chat",
    }),
  );
  expect(mocks.sign.mock.calls.at(-1)?.at(0)?.orgId).toBeUndefined();
  expect(mocks.member).not.toHaveBeenCalled();
});

it("accepts a real signed host credential through MCP admission and chat mint", async () => {
  vi.stubEnv("A2A_SECRET", "host-chat-test-secret");
  const audience = "https://apps.example.test/test-app/mcp";
  const anchor = Date.now() - 1000;
  try {
    const signed = await signA2AToken(owner, undefined, undefined, {
      audience,
      preferGlobalSecret: true,
      expiresIn: "5m",
      extraClaims: {
        org_id: null,
        scope: "mcp-connect",
        agent_native_first_party_mcp: true,
        agent_native_workspace_app_chat: true,
        agent_native_chat_grant_issued_at_ms: anchor,
      },
    });
    const admitted = await verifyAuth(`Bearer ${signed}`, undefined, {
      resourceUrl: audience,
    });
    expect(admitted.authed).toBe(true);
    expect(admitted.identity?.workspaceAppChatIssuedAtMs).toBe(anchor);
    expect(admitted.identity?.orgId).toBeNull();
    await mint(admitted.identity, undefined, {
      orgId: undefined,
      orgScope: "personal",
      mcpCredentialIssuedAtMs: null,
    });
    expect(mocks.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "capability:workspace-app-chat",
        ticketCreatedAtMs: anchor,
      }),
    );
    expect(mocks.sign.mock.calls.at(-1)?.at(0)?.orgId).toBeUndefined();
  } finally {
    vi.unstubAllEnvs();
  }
});

it("maps the signed workspace domain at the recipient before minting chat authority", async () => {
  vi.stubEnv("A2A_SECRET", "host-chat-test-secret");
  vi.spyOn(
    orgContext,
    "resolveA2AOrganizationCredentialsByDomain",
  ).mockResolvedValue(null);
  vi.spyOn(
    orgContext,
    "resolveA2AOrganizationMetadataByDomain",
  ).mockResolvedValue({ orgId: "workspace", orgDomain: "example.com" } as any);
  const audience = "https://apps.example.test/test-app/mcp";
  const anchor = Date.now() - 1000;
  try {
    const signed = await signA2AToken(owner, "example.com", undefined, {
      audience,
      preferGlobalSecret: true,
      expiresIn: "5m",
      extraClaims: {
        scope: "mcp-connect",
        agent_native_first_party_mcp: true,
        agent_native_workspace_app_chat: true,
        agent_native_chat_grant_issued_at_ms: anchor,
      },
    });
    const admitted = await verifyAuth(`Bearer ${signed}`, undefined, {
      resourceUrl: audience,
    });
    expect(admitted.authed).toBe(true);
    expect(admitted.identity?.orgId).toBe("workspace");
    await mint(admitted.identity, undefined, { mcpCredentialIssuedAtMs: null });
    expect(mocks.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "workspace",
        ticketCreatedAtMs: anchor,
        scope: "capability:workspace-app-chat",
      }),
    );
    expect(
      (
        await verifyAuth(`Bearer ${signed}`, undefined, {
          resourceUrl: "https://other.example.test/mcp",
        })
      ).authed,
    ).toBe(false);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
});

// Audit 18:01 requires a dedicated first-party grant; generic OAuth is document-only.
it("refuses generic OAuth authority even with a known credential issuance time", async () => {
  await expect(
    mint({
      ...identity,
      firstPartyMcp: undefined,
      workspaceAppChatIssuedAtMs: undefined,
      mcpCredentialIssuedAtMs: Date.now() - 1000,
    }),
  ).rejects.toThrow(/verified scoped/);
  expect(mocks.ticket).not.toHaveBeenCalled();
});
it("does not advertise runtime to ordinary MCP clients", () => {
  const tools = getBuiltinCrossAppTools(
    config,
    { inlineMcpApps: true },
    {
      ...identity,
      firstPartyMcp: undefined,
      workspaceAppChatIssuedAtMs: undefined,
    },
  );
  expect(
    tools.create_embed_session!.tool.parameters?.properties,
  ).not.toHaveProperty("runtime");
});

it("does not return a token after logout revokes the sign-in anchor", async () => {
  mocks.resolve.mockResolvedValue(null);
  await expect(mint()).rejects.toThrow(/revoked or expired/);
  expect(mocks.ticket).not.toHaveBeenCalled();
});
it("advertises runtime only for a dedicated first-party caller", () => {
  const tools = getBuiltinCrossAppTools(
    config,
    { inlineMcpApps: true },
    identity,
  );
  expect(
    tools.create_embed_session!.tool.parameters?.properties,
  ).toHaveProperty("runtime");
});

it("admits a generic signed OAuth MCP write token but refuses its chat mint", async () => {
  vi.stubEnv("A2A_SECRET", "oauth-chat-refusal-test-secret");
  const resource = "https://apps.example.test/test-app/mcp";
  try {
    const signed = await signMcpOAuthAccessToken({
      ownerEmail: owner,
      orgId: null,
      orgDomain: null,
      clientId: "third-party-client",
      scope: "mcp:read mcp:write mcp:apps",
      resource,
      issuer: "https://apps.example.test",
    });
    const admitted = await verifyAuth(`Bearer ${signed}`, undefined, {
      resourceUrl: resource,
    });
    expect(admitted.authed).toBe(true);
    expect(admitted.identity?.mcpCredentialIssuedAtMs).toEqual(
      expect.any(Number),
    );
    expect(admitted.identity?.workspaceAppChatIssuedAtMs).toBeUndefined();
    await expect(
      mint(admitted.identity, undefined, {
        orgId: undefined,
        orgScope: "personal",
      }),
    ).rejects.toThrow(/verified scoped/);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.ticket).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});
