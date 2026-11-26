import { createHash } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCP_APP_EXTENSION_ID, MCP_APP_MIME_TYPE } from "../action.js";
import { AN_SKILL_MD } from "../cli/skills-content/an-skill.js";
import { ASSETS_SKILL_MD } from "../cli/skills-content/assets-skill.js";
import { CONTENT_SKILL_MD } from "../cli/skills-content/content-skill.js";
import { ServicePrincipalRefusedError } from "../org/service-principal-guard.js";
import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
  type MCPRequestMeta,
} from "./build-server.js";
import { signMcpOAuthAccessToken } from "./oauth-token.js";
import { handleMcpRequest } from "./server.js";

const mocks = vi.hoisted(() => ({
  assertServicePrincipalMayRun: vi.fn<
    (
      email?: string,
      orgId?: string,
    ) => Promise<{ allowedActions: string[] | null }>
  >(async () => ({ allowedActions: null })),
  getMcpSkillLabEnabled: vi.fn(async () => false),
  lookupConnectTokenOrg: vi.fn(),
  checkCredentialOrgMembership: vi.fn(async () => "member"),
  checkCredentialEmailRetirement: vi.fn(async () => "current"),
  overrideContextOrg: undefined as string | undefined,
}));

vi.mock("../server/request-context.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/request-context.js")>();
  return {
    ...actual,
    getRequestContext: () => {
      const context = actual.getRequestContext();
      return context && mocks.overrideContextOrg
        ? { ...context, orgId: mocks.overrideContextOrg }
        : context;
    },
  };
});
vi.mock("../audit/record.js", () => ({
  recordActionAudit: vi.fn(async () => {}),
}));
vi.mock("../org/service-principal-guard.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../org/service-principal-guard.js")
  >()),
  assertServicePrincipalMayRun: (email?: string, orgId?: string) =>
    mocks.assertServicePrincipalMayRun(email, orgId),
  recordServicePrincipalDenial: vi.fn(async () => {}),
}));
vi.mock("../labs/mcp-skill-lab.js", () => ({
  getMcpSkillLabEnabled: (...args: unknown[]) =>
    mocks.getMcpSkillLabEnabled(...args),
}));
vi.mock("./connect-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connect-store.js")>()),
  lookupConnectTokenOrg: (...args: unknown[]) =>
    mocks.lookupConnectTokenOrg(...args),
  touchTokenUsed: vi.fn(async () => {}),
}));
vi.mock("./credential-membership.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./credential-membership.js")>()),
  checkCredentialOrgMembership: (...args: unknown[]) =>
    mocks.checkCredentialOrgMembership(...args),
  checkCredentialEmailRetirement: (...args: unknown[]) =>
    mocks.checkCredentialEmailRetirement(...args),
}));
vi.mock("./analytics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./analytics.js")>()),
  trackMcpToolCall: () => {},
  trackMcpResourceRead: () => {},
  trackMcpResourcesList: () => {},
}));
vi.mock("../server/better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/better-auth-instance.js")
  >()),
  findBetterAuthUserIdForEmail: vi.fn(async () => undefined),
}));
vi.mock("../org/context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/context.js")>()),
  resolveOrgIdForEmail: vi.fn(async () => null),
}));

const alice: MCPCallerIdentity = {
  userEmail: "alice@example.com",
  identityAssurance: "user",
  orgId: null,
  orgDomain: undefined,
};
const aliceOrgA: MCPCallerIdentity = {
  userEmail: "alice@example.com",
  identityAssurance: "user",
  orgId: "org-a",
  orgDomain: undefined,
};
const bobOrgB: MCPCallerIdentity = {
  userEmail: "bob@example.com",
  identityAssurance: "user",
  orgId: "org-b",
  orgDomain: undefined,
};
const servicePrincipalOrgA: MCPCallerIdentity = {
  userEmail: "svc-ci@service.org-a",
  identityAssurance: "service",
  orgId: "org-a",
  orgDomain: undefined,
};

const SKILLS = "io.modelcontextprotocol/skills";

const sha256 = (text: string) =>
  `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;

const guideSkillMd = `---
name: app-guide
description: Reusable app workflow with supporting references.
metadata:
  visibility: exported
---

# App Guide

Follow the workflow and read references when needed.
`;

const guideRefOverview = "# Overview — résumé\n\nDetails for the app guide.\n";
const guideRefSchema = '{"kind":"app-guide","version":1}\n';

const orgASkillMd = `---
name: org-a-playbook
description: Org-A specific workflow skill.
metadata:
  visibility: exported
---

# Org-A Playbook

Confidential Org-A workflow instructions.
`;

const orgARefMd = "# Org-A Reference\n\nPrivate to org-a.\n";

async function connect(
  extra: Partial<MCPConfig>,
  identity: MCPCallerIdentity | null = alice,
  requestMeta: Partial<MCPRequestMeta> = {},
) {
  const config: MCPConfig = {
    name: "test",
    appId: "test",
    description: "test",
    actions: {},
    ...extra,
  };
  const server = await createMCPServerForRequest(
    config,
    identity ?? undefined,
    {
      origin: "http://localhost:8100",
      transport: "http",
      ...requestMeta,
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

const call = (client: Client, method: string, params: object = {}) =>
  client.request({ method, params }, z.looseObject({}));

type SkillsList = {
  resultType: string;
  ttlMs: number;
  cacheScope: string;
  skills: {
    uri: string;
    frontmatter: { name?: unknown; description?: unknown };
    resources: { uri: string; digest: string; size: number }[];
  }[];
};

function createHttpEvent(authorization: string, body: Record<string, unknown>) {
  const headers: Record<string, string> = {
    host: "app.example.test",
    "x-forwarded-proto": "https",
    authorization,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const req = new Request("https://app.example.test/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return {
    req,
    url: new URL("https://app.example.test/"),
    res: { status: 200, headers: new Headers() },
    node: { req: { method: "POST", headers } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.overrideContextOrg = undefined;
  mocks.assertServicePrincipalMayRun.mockResolvedValue({
    allowedActions: null,
  });
  mocks.getMcpSkillLabEnabled.mockResolvedValue(false);
  mocks.checkCredentialOrgMembership.mockResolvedValue("member");
  mocks.checkCredentialEmailRetirement.mockResolvedValue("current");
});

describe("MCP skills extension", () => {
  it("advertises the extension and resources only when opted in by an eligible caller", async () => {
    const on = await connect({ servesAnSkill: true });
    expect(on.getServerCapabilities()?.extensions?.[SKILLS]).toEqual({});
    expect(on.getServerCapabilities()?.resources).toBeDefined();

    const appOptIn = await connect({ skills: ["assets"] });
    expect(appOptIn.getServerCapabilities()?.extensions?.[SKILLS]).toEqual({});
    expect(appOptIn.getServerCapabilities()?.resources).toBeDefined();

    const off = await connect({});
    expect(off.getServerCapabilities()?.extensions?.[SKILLS]).toBeUndefined();
    await expect(call(off, "skills/list")).rejects.toThrow();

    for (const ineligible of [
      null,
      { ...aliceOrgA, identityAssurance: "organization" as const },
      { ...aliceOrgA, oauthScopes: ["mcp:write"] },
    ]) {
      const client = await connect(
        { servesAnSkill: true, skills: ["assets"] },
        ineligible,
      );
      expect(
        client.getServerCapabilities()?.extensions?.[SKILLS],
      ).toBeUndefined();
      await expect(call(client, "skills/list")).rejects.toThrow();
    }
  });

  it("preserves skill://an/SKILL.md on Dispatch unchanged with digest parity", async () => {
    const client = await connect({ servesAnSkill: true });
    const list = (await call(client, "skills/list")) as SkillsList;
    expect(list.skills).toHaveLength(1);
    const [skill] = list.skills;
    expect(skill.uri).toBe("skill://an/SKILL.md");
    expect(skill.frontmatter.name).toBe("an");
    expect(typeof skill.frontmatter.description).toBe("string");

    const read = await client.readResource({ uri: "skill://an/SKILL.md" });
    const [first] = read.contents;
    const text = "text" in first ? first.text : undefined;
    expect(text).toBe(AN_SKILL_MD);
    const bytes = Buffer.from(text ?? "", "utf8");
    expect(skill.resources).toEqual([
      {
        uri: "skill://an/SKILL.md",
        digest: sha256(AN_SKILL_MD),
        size: bytes.length,
      },
    ]);
  });

  it("serves reviewed built-in app skills and supporting reference files with manifest digest and byte-length parity", async () => {
    const client = await connect({
      skills: [
        "assets",
        "content",
        {
          name: "app-guide",
          skillMd: guideSkillMd,
          references: {
            "references/overview.md": guideRefOverview,
            "references/schema.json": guideRefSchema,
          },
        },
      ],
    });

    const list = (await call(client, "skills/list")) as SkillsList;
    expect(list.skills.map((skill) => skill.uri)).toEqual([
      "skill://assets/SKILL.md",
      "skill://content/SKILL.md",
      "skill://app-guide/SKILL.md",
    ]);

    for (const listedSkill of list.skills) {
      const got = (await call(client, "skills/get", {
        uri: listedSkill.uri,
      })) as { skill: SkillsList["skills"][number] };
      expect(got.skill).toEqual(listedSkill);

      for (const resource of listedSkill.resources) {
        const read = await client.readResource({ uri: resource.uri });
        const [content] = read.contents;
        const text = "text" in content ? content.text : undefined;
        expect(typeof text).toBe("string");
        const bytes = Buffer.from(text ?? "", "utf8");
        expect(resource.size).toBe(bytes.length);
        expect(resource.digest).toBe(sha256(text ?? ""));
      }
    }

    const assetsRead = await client.readResource({
      uri: "skill://assets/SKILL.md",
    });
    expect(
      assetsRead.contents[0] && "text" in assetsRead.contents[0]
        ? assetsRead.contents[0].text
        : undefined,
    ).toBe(ASSETS_SKILL_MD);

    const contentRead = await client.readResource({
      uri: "skill://content/SKILL.md",
    });
    expect(
      contentRead.contents[0] && "text" in contentRead.contents[0]
        ? contentRead.contents[0].text
        : undefined,
    ).toBe(CONTENT_SKILL_MD);

    const overviewRead = await client.readResource({
      uri: "skill://app-guide/references/overview.md",
    });
    expect(overviewRead.contents).toEqual([
      {
        uri: "skill://app-guide/references/overview.md",
        mimeType: "text/markdown",
        text: guideRefOverview,
      },
    ]);
  });

  it("returns -32602 for unknown, traversal, internal, and memory skill URIs", async () => {
    const client = await connect({ servesAnSkill: true });
    const list = (await call(client, "skills/list")) as SkillsList;
    const got = (await call(client, "skills/get", {
      uri: "skill://an/SKILL.md",
    })) as { skill: unknown };
    expect(got.skill).toEqual(list.skills[0]);

    for (const attempt of [
      call(client, "skills/get", { uri: "skill://nope/SKILL.md" }),
      call(client, "skills/get", { uri: "skill://an/references/../SKILL.md" }),
      client.readResource({ uri: "skill://an/other.md" }),
      client.readResource({ uri: "skill://an/references/../SKILL.md" }),
      client.readResource({
        uri: "skill://an/.agents/skills/actions/SKILL.md",
      }),
      client.readResource({ uri: "skill://an/memory/MEMORY.md" }),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: -32602 });
    }
  });

  it("rejects internal, dev-scoped, and unexported skill configurations at server setup", async () => {
    await expect(
      connect({
        skills: [
          {
            name: "internal-skill",
            skillMd:
              "---\nname: internal-skill\ndescription: Internal\nmetadata:\n  internal: true\n---\n# Secret\n",
          },
        ],
      }),
    ).rejects.toThrow(/marked internal/);

    await expect(
      connect({
        skills: [
          {
            name: "unexported-skill",
            skillMd:
              "---\nname: unexported-skill\ndescription: Missing export flag\n---\n# Body\n",
          },
        ],
      }),
    ).rejects.toThrow(/metadata\.visibility: exported/);
  });

  it("enforces cross-org isolation identically across skills/list, skills/get, and resources/read", async () => {
    const cfg: Partial<MCPConfig> = {
      skills: [
        "assets",
        {
          name: "org-a-playbook",
          skillMd: orgASkillMd,
          references: { "references/rules.md": orgARefMd },
          orgIds: ["org-a"],
        },
      ],
    };

    const orgAClient = await connect(cfg, aliceOrgA);
    const orgAList = (await call(orgAClient, "skills/list")) as SkillsList;
    expect(orgAList.skills.map((s) => s.uri)).toEqual([
      "skill://assets/SKILL.md",
      "skill://org-a-playbook/SKILL.md",
    ]);
    await expect(
      call(orgAClient, "skills/get", {
        uri: "skill://org-a-playbook/SKILL.md",
      }),
    ).resolves.toMatchObject({
      skill: { uri: "skill://org-a-playbook/SKILL.md" },
    });
    await expect(
      orgAClient.readResource({
        uri: "skill://org-a-playbook/references/rules.md",
      }),
    ).resolves.toEqual({
      contents: [
        {
          uri: "skill://org-a-playbook/references/rules.md",
          mimeType: "text/markdown",
          text: orgARefMd,
        },
      ],
    });

    for (const outsider of [bobOrgB, alice, { ...alice, orgId: undefined }]) {
      const outsiderClient = await connect(cfg, outsider);
      const outsiderList = (await call(
        outsiderClient,
        "skills/list",
      )) as SkillsList;
      expect(outsiderList.skills.map((s) => s.uri)).toEqual([
        "skill://assets/SKILL.md",
      ]);
      await expect(
        call(outsiderClient, "skills/get", {
          uri: "skill://org-a-playbook/SKILL.md",
        }),
      ).rejects.toMatchObject({ code: -32602 });
      await expect(
        outsiderClient.readResource({ uri: "skill://org-a-playbook/SKILL.md" }),
      ).rejects.toMatchObject({ code: -32602 });
      await expect(
        outsiderClient.readResource({
          uri: "skill://org-a-playbook/references/rules.md",
        }),
      ).rejects.toMatchObject({ code: -32602 });
    }
  });

  it("refuses skills/list, skills/get, and resources/read when request context org drifts from verified identity", async () => {
    const client = await connect(
      {
        skills: [
          {
            name: "org-a-playbook",
            skillMd: orgASkillMd,
            orgIds: ["org-a"],
          },
        ],
      },
      aliceOrgA,
    );

    mocks.overrideContextOrg = "org-b";
    await expect(call(client, "skills/list")).rejects.toThrow(
      /Verified MCP caller context required/,
    );
    await expect(
      call(client, "skills/get", { uri: "skill://org-a-playbook/SKILL.md" }),
    ).rejects.toThrow(/Verified MCP caller context required/);
    await expect(
      client.readResource({ uri: "skill://org-a-playbook/SKILL.md" }),
    ).rejects.toThrow(/Verified MCP caller context required/);
  });

  it("enforces requires-lab identically across skills/list, skills/get, and resources/read", async () => {
    const labSkillMd = `---
name: beta-workflow
description: Preview workflow gated by lab flag.
requires-lab: skills.preview
metadata:
  visibility: exported
---

# Beta Workflow
`;
    const client = await connect(
      { skills: [{ name: "beta-workflow", skillMd: labSkillMd }] },
      aliceOrgA,
    );

    mocks.getMcpSkillLabEnabled.mockResolvedValue(false);
    const deniedList = (await call(client, "skills/list")) as SkillsList;
    expect(deniedList.skills).toEqual([]);
    await expect(
      call(client, "skills/get", { uri: "skill://beta-workflow/SKILL.md" }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(
      client.readResource({ uri: "skill://beta-workflow/SKILL.md" }),
    ).rejects.toMatchObject({ code: -32602 });

    mocks.getMcpSkillLabEnabled.mockResolvedValue(true);
    const allowedList = (await call(client, "skills/list")) as SkillsList;
    expect(allowedList.skills.map((s) => s.uri)).toEqual([
      "skill://beta-workflow/SKILL.md",
    ]);
    await expect(
      call(client, "skills/get", { uri: "skill://beta-workflow/SKILL.md" }),
    ).resolves.toMatchObject({
      skill: { uri: "skill://beta-workflow/SKILL.md" },
    });
    await expect(
      client.readResource({ uri: "skill://beta-workflow/SKILL.md" }),
    ).resolves.toMatchObject({
      contents: [{ uri: "skill://beta-workflow/SKILL.md", text: labSkillMd }],
    });
  });

  it("denies a revoked or suspended service principal across skills/list, skills/get, and resources/read", async () => {
    const client = await connect(
      {
        skills: [
          "assets",
          {
            name: "app-guide",
            skillMd: guideSkillMd,
            references: { "references/overview.md": guideRefOverview },
          },
        ],
      },
      servicePrincipalOrgA,
    );

    const initialList = (await call(client, "skills/list")) as SkillsList;
    expect(initialList.skills).toHaveLength(2);

    mocks.assertServicePrincipalMayRun.mockRejectedValue(
      new ServicePrincipalRefusedError(
        "service_principal_inactive",
        "Service principal has been suspended.",
      ),
    );

    await expect(call(client, "skills/list")).rejects.toThrow(/suspended/i);
    await expect(
      call(client, "skills/get", { uri: "skill://assets/SKILL.md" }),
    ).rejects.toThrow(/suspended/i);
    await expect(
      client.readResource({ uri: "skill://assets/SKILL.md" }),
    ).rejects.toThrow(/suspended/i);
    await expect(
      client.readResource({ uri: "skill://app-guide/references/overview.md" }),
    ).rejects.toThrow(/suspended/i);
  });

  it("denies HTTP MCP requests with a revoked connect token or removed org membership across skills/list, skills/get, and resources/read", async () => {
    vi.stubEnv("A2A_SECRET", "test-mcp-skills-signing-secret-0123456789");
    try {
      const connectToken = await signMcpOAuthAccessToken({
        ownerEmail: "alice@example.com",
        orgId: "org-a",
        clientId: "agent-native-connect",
        scope: "mcp:read mcp:write",
        resource: "https://app.example.test/mcp",
        issuer: "https://app.example.test",
        jti: "jti-revoked-skill-token",
      });
      const cfg: MCPConfig = {
        name: "assets",
        appId: "assets",
        description: "Assets",
        actions: {},
        skills: ["assets"],
      };

      const rpcRequests = [
        { jsonrpc: "2.0", id: 1, method: "skills/list", params: {} },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "skills/get",
          params: { uri: "skill://assets/SKILL.md" },
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "resources/read",
          params: { uri: "skill://assets/SKILL.md" },
        },
      ];

      mocks.lookupConnectTokenOrg.mockResolvedValue({ status: "revoked" });
      for (const rpc of rpcRequests) {
        const event = createHttpEvent(`Bearer ${connectToken}`, rpc);
        const result = await handleMcpRequest(event as never, cfg, "/mcp");
        expect(event.res.status).toBe(401);
        expect(result).toMatchObject({
          error: "Unauthorized",
          reason: "revoked",
        });
      }

      mocks.lookupConnectTokenOrg.mockResolvedValue({
        status: "active",
        ownerEmail: "alice@example.com",
        orgId: "org-a",
        kind: "personal",
      });
      mocks.checkCredentialOrgMembership.mockResolvedValue("not-member");
      for (const rpc of rpcRequests) {
        const event = createHttpEvent(`Bearer ${connectToken}`, rpc);
        const result = await handleMcpRequest(event as never, cfg, "/mcp");
        expect(event.res.status).toBe(401);
        expect(result).toMatchObject({
          error: "Unauthorized",
          reason: "not-member",
        });
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("coexists cleanly with ui:// MCP App resources on the same server", async () => {
    const widgetHtml =
      "<!doctype html><html><body><div>Asset Picker Widget</div></body></html>";
    const client = await connect(
      {
        builtinCrossAppTools: false,
        skills: [
          "assets",
          {
            name: "app-guide",
            skillMd: guideSkillMd,
            references: { "references/overview.md": guideRefOverview },
          },
          {
            name: "org-a-playbook",
            skillMd: orgASkillMd,
            orgIds: ["org-a"],
          },
        ],
        actions: {
          "open-picker": {
            tool: { description: "Open asset picker" },
            readOnly: true,
            mcpTool: true,
            mcpApp: {
              compactCatalog: true,
              resource: {
                uri: "ui://assets/open-picker",
                title: "Asset Picker",
                description: "Pick an asset inline.",
                html: widgetHtml,
              },
            },
            run: async () => ({ ok: true }),
          },
        },
      },
      bobOrgB,
      { inlineMcpApps: true },
    );

    const caps = client.getServerCapabilities();
    expect(caps?.resources).toBeDefined();
    expect(caps?.extensions?.[MCP_APP_EXTENSION_ID]).toEqual({
      mimeTypes: [MCP_APP_MIME_TYPE],
    });
    expect(caps?.extensions?.[SKILLS]).toEqual({});

    const listedResources = await client.listResources();
    expect(listedResources.resources).toHaveLength(1);
    const uiResourceUri = listedResources.resources[0]?.uri ?? "";
    expect(uiResourceUri).toMatch(/^ui:\/\/assets\/open-picker(?:\/|$)/);

    const listedSkills = (await call(client, "skills/list")) as SkillsList;
    expect(listedSkills.skills.map((s) => s.uri)).toEqual([
      "skill://assets/SKILL.md",
      "skill://app-guide/SKILL.md",
    ]);

    const uiRead = await client.readResource({
      uri: uiResourceUri,
    });
    expect(uiRead.contents[0]).toMatchObject({
      uri: uiResourceUri,
      mimeType: MCP_APP_MIME_TYPE,
    });
    expect(
      uiRead.contents[0] && "text" in uiRead.contents[0]
        ? uiRead.contents[0].text
        : "",
    ).toContain("Asset Picker Widget");

    const skillRead = await client.readResource({
      uri: "skill://app-guide/references/overview.md",
    });
    expect(skillRead.contents).toEqual([
      {
        uri: "skill://app-guide/references/overview.md",
        mimeType: "text/markdown",
        text: guideRefOverview,
      },
    ]);

    await expect(
      client.readResource({ uri: "skill://org-a-playbook/SKILL.md" }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(
      call(client, "skills/get", { uri: "skill://org-a-playbook/SKILL.md" }),
    ).rejects.toMatchObject({ code: -32602 });
  });
});
