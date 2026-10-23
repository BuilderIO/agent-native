import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  email: "owner@example.test",
  orgId: "credential-org",
  membershipError: null as Error | null,
  membershipIds: ["credential-org"],
  role: "owner",
  personalSelected: false,
  personalValue: "fake-personal-credential" as string | null,
}));

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({
    execute: async ({ sql }: { sql: string }) => {
      if (sql.includes("SELECT org_id FROM org_members")) {
        if (fixture.membershipError) throw fixture.membershipError;
        return { rows: fixture.membershipIds.map((org_id) => ({ org_id })) };
      }
      if (sql.includes("SELECT role FROM org_members")) {
        return { rows: [{ role: fixture.role }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  }),
}));

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: async (key: string) => {
    if (key === `u:${fixture.email}:active-org-id`) {
      return fixture.personalSelected ? { orgId: null } : null;
    }
    if (key === `u:${fixture.email}:credential:GENERIC_SERVICE_TOKEN`) {
      return fixture.personalValue ? { value: fixture.personalValue } : null;
    }
    throw new Error(`Unexpected setting: ${key}`);
  },
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: async (ref: { key: string; scope: string; scopeId: string }) =>
    ref.key === "GENERIC_SERVICE_TOKEN" &&
    ref.scope === "org" &&
    ref.scopeId === fixture.orgId
      ? { value: "fake-org-credential" }
      : null,
}));

import { CredentialStoreUnavailableError } from "../server/credential-provider.js";
import { runWithRequestContext } from "../server/request-context.js";
import { resolveCredentialDetailed } from "./index.js";

function resolveGenericCredential() {
  return runWithRequestContext({ userEmail: fixture.email }, () =>
    resolveCredentialDetailed("GENERIC_SERVICE_TOKEN", {
      userEmail: fixture.email,
    }),
  );
}

describe("generic credentials with real organization resolution", () => {
  beforeEach(() => {
    fixture.membershipError = null;
    fixture.membershipIds = [fixture.orgId];
    fixture.role = "owner";
    fixture.personalSelected = false;
    fixture.personalValue = "fake-personal-credential";
  });

  it.each(["42501", "08006"])(
    "rejects a readable personal credential when membership lookup fails with %s",
    async (code) => {
      fixture.membershipError = Object.assign(
        new Error(
          code === "42501"
            ? "permission denied for table org_members"
            : "connection reset",
        ),
        { code },
      );

      const lookup = resolveGenericCredential();
      await expect(lookup).rejects.toBeInstanceOf(
        CredentialStoreUnavailableError,
      );
      await expect(lookup).rejects.toMatchObject({
        cause: fixture.membershipError,
        retryable: true,
      });
    },
  );

  it("returns a readable personal credential when membership confirms no organization", async () => {
    fixture.membershipIds = [];

    await expect(resolveGenericCredential()).resolves.toEqual({
      value: fixture.personalValue,
      scope: "user",
      scopeId: fixture.email,
    });
  });

  it("keeps an explicit Personal selection even when the user has an organization", async () => {
    fixture.personalSelected = true;

    await expect(resolveGenericCredential()).resolves.toMatchObject({
      value: fixture.personalValue,
      scope: "user",
    });
  });

  it("preserves genuine credential absence in Personal scope", async () => {
    fixture.membershipIds = [];
    fixture.personalValue = null;

    await expect(resolveGenericCredential()).resolves.toBeUndefined();
  });

  it.each([
    ["owner", "fake-org-credential", "org"],
    ["admin", "fake-org-credential", "org"],
    ["member", "fake-personal-credential", "user"],
  ])("preserves %s credential priority", async (role, value, scope) => {
    fixture.role = role;

    await expect(resolveGenericCredential()).resolves.toMatchObject({
      value,
      scope,
    });
  });
});
