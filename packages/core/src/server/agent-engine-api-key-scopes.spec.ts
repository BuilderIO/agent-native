import { beforeEach, describe, expect, it, vi } from "vitest";

type Scope = "user" | "org" | "workspace";
interface Ref {
  key: string;
  scope: Scope;
  scopeId: string;
}

const store = new Map<string, string>();
const refId = (ref: Ref) => `${ref.scope}:${ref.scopeId}:${ref.key}`;

const members: Record<string, { orgId: string; role: "admin" | "member" }> = {
  "admin@example.test": { orgId: "org-1", role: "admin" },
  "member@example.test": { orgId: "org-1", role: "member" },
};
let signedIn = "";

vi.mock("../secrets/storage.js", () => ({
  writeAppSecret: async (ref: Ref & { value: string }) => {
    store.set(refId(ref), ref.value);
  },
  deleteAppSecret: async (ref: Ref) => store.delete(refId(ref)),
  readAppSecret: async (ref: Ref) => {
    const value = store.get(refId(ref));
    return value ? { value } : null;
  },
}));

vi.mock("./auth.js", () => ({
  getSession: async () => (signedIn ? { email: signedIn } : null),
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: async () => ({
    email: signedIn,
    orgId: members[signedIn]?.orgId ?? null,
    role: members[signedIn]?.role ?? null,
  }),
  resolveOrgIdForEmail: async (email: string) => members[email]?.orgId ?? null,
}));

vi.mock("../settings/store.js", () => ({
  getSetting: async () => null,
  putSetting: async () => {},
  deleteSetting: async () => {},
}));

import { createAgentEngineApiKeyHandler } from "./agent-engine-api-key-route.js";
import { resolveSecretDetailed } from "./credential-provider.js";
import { runWithRequestContext } from "./request-context.js";

async function saveAs(
  email: string,
  body: { provider: string; apiKey: string; scope: "user" | "org" },
) {
  signedIn = email;
  const event = {
    req: new Request("http://localhost/_agent-native/agent-engine/api-key", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    res: { headers: new Headers(), status: 200 },
    context: {},
  };
  const result = await createAgentEngineApiKeyHandler()(event as any);
  return { status: event.res.status, result };
}

function resolveFor(email: string, key: string) {
  return runWithRequestContext(
    { userEmail: email, orgId: members[email]?.orgId },
    () => resolveSecretDetailed(key),
  );
}

describe("personal and organization provider keys", () => {
  beforeEach(() => {
    store.clear();
    signedIn = "";
  });

  it("stores a member's key at personal scope for that member only", async () => {
    await expect(
      saveAs("member@example.test", {
        provider: "anthropic",
        apiKey: "sk-ant-member-fake",
        scope: "user",
      }),
    ).resolves.toEqual({
      status: 200,
      result: { ok: true, key: "ANTHROPIC_API_KEY", scope: "user" },
    });

    await expect(
      resolveFor("member@example.test", "ANTHROPIC_API_KEY"),
    ).resolves.toMatchObject({ value: "sk-ant-member-fake", source: "user" });
    await expect(
      resolveFor("admin@example.test", "ANTHROPIC_API_KEY"),
    ).resolves.toMatchObject({ value: null });
  });

  it("keeps an admin's personal key beside the organization key", async () => {
    await saveAs("admin@example.test", {
      provider: "openai",
      apiKey: "sk-admin-personal-fake",
      scope: "user",
    });
    await expect(
      saveAs("admin@example.test", {
        provider: "openai",
        apiKey: "sk-org-fake",
        scope: "org",
      }),
    ).resolves.toMatchObject({
      status: 200,
      result: { ok: true, scope: "org" },
    });

    expect(store.get("user:admin@example.test:OPENAI_API_KEY")).toBe(
      "sk-admin-personal-fake",
    );
    expect(store.get("org:org-1:OPENAI_API_KEY")).toBe("sk-org-fake");
    await expect(
      resolveFor("admin@example.test", "OPENAI_API_KEY"),
    ).resolves.toMatchObject({
      value: "sk-admin-personal-fake",
      source: "user",
    });
    await expect(
      resolveFor("member@example.test", "OPENAI_API_KEY"),
    ).resolves.toMatchObject({ value: "sk-org-fake", source: "org" });
  });

  it("refuses a member's organization key", async () => {
    await expect(
      saveAs("member@example.test", {
        provider: "openai",
        apiKey: "sk-member-fake",
        scope: "org",
      }),
    ).resolves.toMatchObject({ status: 403 });
    expect(store.size).toBe(0);
  });
});
