import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  email: "owner@example.test",
  orgId: "credential-org",
  membershipError: null as Error | null,
  membershipIds: ["credential-org"],
  role: "owner",
  roleError: null as Error | null,
  restricted: false,
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
        if (fixture.roleError) throw fixture.roleError;
        return { rows: fixture.role ? [{ role: fixture.role }] : [] };
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
    if (key === `o:${fixture.orgId}:restrict-personal-provider-keys`) {
      return { restricted: fixture.restricted };
    }
    if (
      key === `u:${fixture.email}:credential:GENERIC_SERVICE_TOKEN` ||
      key === `u:${fixture.email}:credential:ANTHROPIC_API_KEY`
    ) {
      return fixture.personalValue ? { value: fixture.personalValue } : null;
    }
    throw new Error(`Unexpected setting: ${key}`);
  },
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: async (ref: { key: string; scope: string; scopeId: string }) =>
    ["GENERIC_SERVICE_TOKEN", "ANTHROPIC_API_KEY"].includes(ref.key) &&
    ref.scope === "org" &&
    ref.scopeId === fixture.orgId
      ? { value: "fake-org-credential" }
      : null,
}));

import {
  CredentialStoreUnavailableError,
  CredentialStoreLookupError,
} from "../server/credential-provider.js";
import {
  resolveSecretDetailed,
  resolveBuilderGatewayAuth,
} from "../server/credential-provider.js";
import { runWithRequestContext } from "../server/request-context.js";
import { ForbiddenError } from "../sharing/access.js";
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
    fixture.roleError = null;
    fixture.restricted = false;
    fixture.personalSelected = false;
    fixture.personalValue = "fake-personal-credential";
  });

  it.each([
    ["GENERIC_SERVICE_TOKEN", undefined],
    ["ANTHROPIC_API_KEY", undefined],
    ["GENERIC_SERVICE_TOKEN", "credential-org"],
    ["ANTHROPIC_API_KEY", "credential-org"],
  ])(
    "preserves revoked delegation as forbidden for %s with explicit org %s",
    async (key, orgId) => {
      fixture.role = "";
      await expect(
        runWithRequestContext(
          {
            userEmail: fixture.email,
            orgId: fixture.orgId,
            a2aIdentityAssurance: "org-member",
          },
          () =>
            resolveCredentialDetailed(key!, {
              userEmail: fixture.email,
              orgId,
            }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it("preserves delegated refusal through the detailed provider resolver", async () => {
    await expect(
      runWithRequestContext(
        { userEmail: fixture.email, a2aIdentityAssurance: "org-member" },
        () => resolveSecretDetailed("GENERIC_SERVICE_TOKEN"),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("preserves delegated refusal through Builder gateway authentication", async () => {
    await expect(
      runWithRequestContext(
        { userEmail: fixture.email, a2aIdentityAssurance: "org-member" },
        () => resolveBuilderGatewayAuth(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses an explicit organization outside the valid delegation", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: fixture.email,
          orgId: fixture.orgId,
          a2aIdentityAssurance: "org-member",
        },
        () =>
          resolveCredentialDetailed("GENERIC_SERVICE_TOKEN", {
            userEmail: fixture.email,
            orgId: "other-org",
            credentialScope: "org",
          }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("resolves the explicit organization for a valid delegation", async () => {
    await expect(
      runWithRequestContext(
        {
          userEmail: fixture.email,
          orgId: fixture.orgId,
          a2aIdentityAssurance: "org-member",
        },
        () =>
          resolveCredentialDetailed("GENERIC_SERVICE_TOKEN", {
            userEmail: fixture.email,
            orgId: fixture.orgId,
            credentialScope: "org",
          }),
      ),
    ).resolves.toMatchObject({ value: "fake-org-credential", scope: "org" });
  });

  it.each(["42501", "08006"])(
    "types provider-policy membership failures with %s as lookup failures",
    async (code) => {
      fixture.membershipError = Object.assign(
        new Error("fake membership lookup failure"),
        { code },
      );
      const lookup = runWithRequestContext({ userEmail: fixture.email }, () =>
        resolveCredentialDetailed("ANTHROPIC_API_KEY", {
          userEmail: fixture.email,
        }),
      );
      await expect(lookup).rejects.toBeInstanceOf(
        code === "08006"
          ? CredentialStoreUnavailableError
          : CredentialStoreLookupError,
      );
      await expect(lookup).rejects.toMatchObject({
        cause: fixture.membershipError,
        retryable: code === "08006",
      });
    },
  );

  it.each(["42501", "08006"])(
    "types provider-policy role lookup failures with %s as lookup failures",
    async (code) => {
      fixture.restricted = true;
      fixture.roleError = Object.assign(new Error("fake role lookup failure"), {
        code,
      });
      const lookup = runWithRequestContext({ userEmail: fixture.email }, () =>
        resolveCredentialDetailed("ANTHROPIC_API_KEY", {
          userEmail: fixture.email,
        }),
      );
      await expect(lookup).rejects.toBeInstanceOf(
        code === "08006"
          ? CredentialStoreUnavailableError
          : CredentialStoreLookupError,
      );
      await expect(lookup).rejects.toMatchObject({
        cause: fixture.roleError,
        retryable: code === "08006",
      });
    },
  );

  it.each([
    ["personal", "member", true, "fake-personal-credential", "user"],
    ["organization", "member", true, "fake-org-credential", "org"],
    ["organization", "member", false, "fake-personal-credential", "user"],
    ["organization", "owner", true, "fake-org-credential", "org"],
    ["organization", "admin", true, "fake-org-credential", "org"],
  ])(
    "preserves provider policy for %s %s restricted=%s",
    async (scope, role, restricted, value, resultScope) => {
      fixture.membershipIds = scope === "personal" ? [] : [fixture.orgId];
      fixture.role = role;
      fixture.restricted = restricted;
      await expect(
        runWithRequestContext({ userEmail: fixture.email }, () =>
          resolveCredentialDetailed("ANTHROPIC_API_KEY", {
            userEmail: fixture.email,
          }),
        ),
      ).resolves.toMatchObject({ value, scope: resultScope });
    },
  );

  it("keeps org-only provider lookup bound to the explicit organization", async () => {
    fixture.membershipError = new Error("must not infer scope");
    await expect(
      resolveCredentialDetailed("ANTHROPIC_API_KEY", {
        userEmail: fixture.email,
        orgId: fixture.orgId,
        credentialScope: "org",
      }),
    ).resolves.toMatchObject({ value: "fake-org-credential", scope: "org" });
    await expect(
      resolveCredentialDetailed("ANTHROPIC_API_KEY", {
        userEmail: fixture.email,
        credentialScope: "org",
      }),
    ).resolves.toBeUndefined();
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
        code === "08006"
          ? CredentialStoreUnavailableError
          : CredentialStoreLookupError,
      );
      await expect(lookup).rejects.toMatchObject({
        cause: fixture.membershipError,
        retryable: code === "08006",
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
