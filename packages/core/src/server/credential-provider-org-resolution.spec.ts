import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  membershipUnavailable: false,
  membershipMissing: false,
  personalAbsent: false,
  storageFailure: undefined as Error | undefined,
  membershipFailure: Object.assign(
    new Error("permission denied for table org_members"),
    { code: "42501" },
  ),
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
          throw fixture.membershipFailure;
        }
        return {
          rows: fixture.membershipMissing ? [] : [{ org_id: fixture.orgId }],
        };
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

vi.mock("../secrets/storage.js", () => {
  const readAppSecret = async (ref: {
    key: string;
    scope: string;
    scopeId: string;
  }) => {
    if (fixture.storageFailure) throw fixture.storageFailure;
    return !fixture.personalAbsent &&
      ref.scope === "user" &&
      ref.scopeId === fixture.email
      ? {
          value:
            ref.key === "ANTHROPIC_API_KEY"
              ? fixture.personalKey
              : `fake-${ref.key}`,
        }
      : null;
  };
  return {
    readAppSecret,
    readAppSecrets: async (ref: {
      keys: readonly string[];
      scope: string;
      scopeId: string;
    }) => {
      const rows = new Map();
      for (const key of ref.keys) {
        const row = await readAppSecret({ ...ref, key });
        if (row) rows.set(key, row);
      }
      return rows;
    },
  };
});

import { ForbiddenError } from "../sharing/access.js";
import {
  CredentialStoreUnavailableError,
  resolveSecret,
  resolveSecretDetailed,
  resolveSecretPairs,
} from "./credential-provider.js";
import { runWithRequestContext } from "./request-context.js";

function resolvePersonalProviderKey() {
  return runWithRequestContext({ userEmail: fixture.email }, () =>
    resolveSecretDetailed("ANTHROPIC_API_KEY"),
  );
}

beforeEach(() => {
  fixture.membershipUnavailable = false;
  fixture.membershipMissing = false;
  fixture.personalAbsent = false;
  fixture.storageFailure = undefined;
  fixture.restricted = true;
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("AGENT_VAULT_ORG_ID", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("credential resolution with real org scope and personal-key policy", () => {
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

describe.each([
  {
    name: "resolveSecret",
    resolve: () => resolveSecret("ANTHROPIC_API_KEY"),
    personal: fixture.personalKey,
  },
  {
    name: "resolveSecretPairs",
    resolve: () =>
      resolveSecretPairs([["EXAMPLE_CLIENT_ID", "EXAMPLE_CLIENT_SECRET"]]),
    personal: ["fake-EXAMPLE_CLIENT_ID", "fake-EXAMPLE_CLIENT_SECRET"],
  },
])("$name with real organization resolution", ({ resolve, personal }) => {
  it("throws with the original nontransient membership lookup failure", async () => {
    fixture.membershipUnavailable = true;
    const lookup = runWithRequestContext({ userEmail: fixture.email }, resolve);
    await expect(lookup).rejects.toBeInstanceOf(
      CredentialStoreUnavailableError,
    );
    await expect(lookup.catch((error: Error) => error.cause)).resolves.toBe(
      fixture.membershipFailure,
    );
  });

  it("preserves a definitive refusal's identity", async () => {
    const refusal = new ForbiddenError();
    fixture.storageFailure = refusal;
    await expect(
      runWithRequestContext({ userEmail: fixture.email }, resolve),
    ).rejects.toBe(refusal);
  });

  it("refuses an incomplete delegated identity", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: fixture.email,
          a2aIdentityAssurance: "org-member",
        },
        resolve,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns null when readable Personal storage has no credential", async () => {
    fixture.personalAbsent = true;
    await expect(
      runWithRequestContext(
        { userEmail: fixture.email, orgScope: "personal" },
        resolve,
      ),
    ).resolves.toBeNull();
  });

  it("returns the readable Personal credential without an organization", async () => {
    fixture.membershipMissing = true;
    await expect(
      runWithRequestContext({ userEmail: fixture.email }, resolve),
    ).resolves.toEqual(personal);
  });

  it("returns the readable credential when the organization permits it", async () => {
    fixture.restricted = false;
    await expect(
      runWithRequestContext({ userEmail: fixture.email }, resolve),
    ).resolves.toEqual(personal);
  });
});
