import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  membershipUnavailable: false,
  restricted: true,
  email: "member@example.test",
  orgId: "restricted-org",
  personalKey: "fake-personal-provider-key",
}));

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({
    execute: async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT org_id FROM org_members")) {
        if (fixture.membershipUnavailable) {
          throw Object.assign(
            new Error("permission denied for table org_members"),
            { code: "42501" },
          );
        }
        return { rows: [{ org_id: fixture.orgId }] };
      }
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: "member" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  }),
}));

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: async (key: string) => {
    if (key === `u:${fixture.email}:active-org-id`) return null;
    if (key === `o:${fixture.orgId}:restrict-personal-provider-keys`) {
      return { restricted: fixture.restricted };
    }
    throw new Error(`Unexpected setting: ${key}`);
  },
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: async (ref: { key: string; scope: string; scopeId: string }) =>
    ref.key === "ANTHROPIC_API_KEY" &&
    ref.scope === "user" &&
    ref.scopeId === fixture.email
      ? { value: fixture.personalKey }
      : null,
}));

import { resolveSecretDetailed } from "./credential-provider.js";
import { runWithRequestContext } from "./request-context.js";

function resolvePersonalProviderKey() {
  return runWithRequestContext({ userEmail: fixture.email }, () =>
    resolveSecretDetailed("ANTHROPIC_API_KEY"),
  );
}

describe("credential resolution with real org scope and personal-key policy", () => {
  beforeEach(() => {
    fixture.membershipUnavailable = false;
    fixture.restricted = true;
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AGENT_VAULT_ORG_ID", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("reports a failed lookup without returning a personal key when membership access is denied", async () => {
    fixture.membershipUnavailable = true;

    await expect(resolvePersonalProviderKey()).resolves.toMatchObject({
      value: null,
      lookupFailed: true,
    });
  });

  it("skips the restricted member's readable personal key when membership is readable", async () => {
    await expect(resolvePersonalProviderKey()).resolves.toMatchObject({
      value: null,
      lookupFailed: false,
    });
  });

  it("returns the same readable personal key when the organization allows it", async () => {
    fixture.restricted = false;

    await expect(resolvePersonalProviderKey()).resolves.toMatchObject({
      value: fixture.personalKey,
      lookupFailed: false,
      source: "user",
    });
  });
});
