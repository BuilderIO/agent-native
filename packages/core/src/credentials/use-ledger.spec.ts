import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppSecret: vi.fn(),
  isMissingAppSecretsTableError: vi.fn(() => false),
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: mocks.readAppSecret,
  isMissingAppSecretsTableError: mocks.isMissingAppSecretsTableError,
}));
vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: async () => null,
  putSetting: vi.fn(),
  deleteSetting: vi.fn(),
}));
vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: async () => "org-1",
}));
vi.mock("../server/credential-read-order.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/credential-read-order.js")
  >()),
  readsOrgCredentialFirst: async () => false,
}));
vi.mock(
  "../server/personal-provider-key-policy.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/personal-provider-key-policy.js")
    >()),
    isPersonalProviderKeyUseRestricted: async () => false,
  }),
);

import { resolveCredentialDetailed } from "./index.js";
import {
  CredentialUseLedger,
  recordCredentialUse,
  runWithCredentialUseLedger,
  runWithoutCredentialUseLedger,
} from "./use-ledger.js";

const EMAIL = "member@example.com";

function rows(values: Record<string, string>) {
  mocks.readAppSecret.mockImplementation(
    async ({
      key,
      scope,
      scopeId,
    }: {
      key: string;
      scope: string;
      scopeId: string;
    }) => {
      const value = values[`${scope}:${scopeId}:${key}`];
      return value ? { value } : null;
    },
  );
}

beforeEach(() => {
  mocks.readAppSecret.mockReset();
});

describe("CredentialUseLedger", () => {
  it("records uses only inside its run, once each", async () => {
    const ledger = new CredentialUseLedger();
    recordCredentialUse({ kind: "unreadable", key: "OUTSIDE" });

    await runWithCredentialUseLedger(ledger, async () => {
      await Promise.resolve();
      recordCredentialUse({ kind: "unreadable", key: "INSIDE" });
      recordCredentialUse({ kind: "unreadable", key: "INSIDE" });
      runWithoutCredentialUseLedger(() =>
        recordCredentialUse({ kind: "unreadable", key: "EXITED" }),
      );
    });

    expect(ledger.uses).toEqual([{ kind: "unreadable", key: "INSIDE" }]);
  });
});

describe("resolveCredentialDetailed records where each credential came from", () => {
  it("records a member's own key as a user-scope use", async () => {
    rows({
      [`user:${EMAIL}:GITHUB_TOKEN`]: "personal",
      "org:org-1:GITHUB_TOKEN": "org",
    });
    const ledger = new CredentialUseLedger();

    const resolved = await runWithCredentialUseLedger(ledger, () =>
      resolveCredentialDetailed("GITHUB_TOKEN", {
        userEmail: EMAIL,
        orgId: "org-1",
      }),
    );

    expect(resolved?.scope).toBe("user");
    expect(ledger.uses).toEqual([
      { kind: "stored", key: "GITHUB_TOKEN", scope: "user", scopeId: EMAIL },
    ]);
  });

  it("records the org's key when the run is org-only, and a miss as no scope", async () => {
    rows({
      [`user:${EMAIL}:GITHUB_TOKEN`]: "personal",
      "org:org-1:GITHUB_TOKEN": "org",
    });
    const ledger = new CredentialUseLedger();
    const ctx = {
      userEmail: EMAIL,
      orgId: "org-1",
      credentialScope: "org" as const,
    };

    await runWithCredentialUseLedger(ledger, async () => {
      await resolveCredentialDetailed("GITHUB_TOKEN", ctx);
      await resolveCredentialDetailed("HUBSPOT_PRIVATE_APP_TOKEN", ctx);
    });

    expect(ledger.uses).toEqual([
      { kind: "stored", key: "GITHUB_TOKEN", scope: "org", scopeId: "org-1" },
      {
        kind: "stored",
        key: "HUBSPOT_PRIVATE_APP_TOKEN",
        scope: null,
        scopeId: null,
      },
    ]);
  });

  it("records a read that throws as unreadable", async () => {
    mocks.readAppSecret.mockRejectedValue(new Error("store down"));
    const ledger = new CredentialUseLedger();

    await expect(
      runWithCredentialUseLedger(ledger, () =>
        resolveCredentialDetailed("GITHUB_TOKEN", {
          userEmail: EMAIL,
          orgId: "org-1",
        }),
      ),
    ).rejects.toThrow();

    expect(ledger.uses).toEqual([{ kind: "unreadable", key: "GITHUB_TOKEN" }]);
  });
});
