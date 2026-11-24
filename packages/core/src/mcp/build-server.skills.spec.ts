import { createHash } from "node:crypto";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AN_SKILL_MD } from "../cli/skills-content/an-skill.js";
import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
} from "./build-server.js";

vi.mock("../audit/record.js", () => ({
  recordActionAudit: vi.fn(async () => {}),
}));
vi.mock("../org/service-principal-guard.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../org/service-principal-guard.js")
  >()),
  assertServicePrincipalMayRun: vi.fn(async () => ({ allowedActions: null })),
}));
vi.mock("./analytics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./analytics.js")>()),
  trackMcpToolCall: () => {},
}));
vi.mock("../server/better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/better-auth-instance.js")
  >()),
  findBetterAuthUserIdForEmail: vi.fn(async () => undefined),
}));

const alice: MCPCallerIdentity = {
  userEmail: "alice@example.com",
  identityAssurance: "user",
  orgId: null,
  orgDomain: undefined,
};
const SKILLS = "io.modelcontextprotocol/skills";

async function connect(
  extra: Partial<MCPConfig>,
  identity: MCPCallerIdentity | null = alice,
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
    } as never,
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
  skills: {
    uri: string;
    frontmatter: { name?: unknown; description?: unknown };
    resources: unknown[];
  }[];
};

describe("MCP skills extension", () => {
  it("advertises the extension and resources only when opted in", async () => {
    const on = await connect({ servesAnSkill: true });
    expect(on.getServerCapabilities()?.extensions?.[SKILLS]).toEqual({});
    expect(on.getServerCapabilities()?.resources).toBeDefined();
    const off = await connect({});
    expect(off.getServerCapabilities()?.extensions?.[SKILLS]).toBeUndefined();
    await expect(call(off, "skills/list")).rejects.toThrow();
    const anonymous = await connect({ servesAnSkill: true }, null);
    expect(
      anonymous.getServerCapabilities()?.extensions?.[SKILLS],
    ).toBeUndefined();
  });

  it("lists the an skill with digests of the bytes it serves", async () => {
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
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        size: bytes.length,
      },
    ]);
  });

  it("returns an entry from skills/get and -32602 for unknown uris", async () => {
    const client = await connect({ servesAnSkill: true });
    const list = (await call(client, "skills/list")) as SkillsList;
    const got = (await call(client, "skills/get", {
      uri: "skill://an/SKILL.md",
    })) as { skill: unknown };
    expect(got.skill).toEqual(list.skills[0]);
    for (const attempt of [
      call(client, "skills/get", { uri: "skill://nope/SKILL.md" }),
      client.readResource({ uri: "skill://an/other.md" }),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: -32602 });
    }
  });
});
