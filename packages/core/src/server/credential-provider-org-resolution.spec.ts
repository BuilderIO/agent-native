import { H3, type H3Event } from "h3";
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

import { isTransientAutomationFailureCode } from "../jobs/automation-outcome.js";
import { ForbiddenError } from "../sharing/access.js";
import {
  CredentialStoreLookupError,
  resolveSecret,
  resolveSecretDetailed,
  resolveSecretPairs,
} from "./credential-provider.js";
import { getH3App } from "./framework-request-handler.js";
import { runWithRequestContext } from "./request-context.js";

function resolvePersonalProviderKey() {
  return runWithRequestContext({ userEmail: fixture.email }, () =>
    resolveSecretDetailed("ANTHROPIC_API_KEY"),
  );
}

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: async () => [],
}));

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
    await expect(lookup).rejects.toBeInstanceOf(CredentialStoreLookupError);
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

describe.each([
  {
    name: "transient",
    cause: Object.assign(new Error("private timeout"), { code: "57014" }),
    status: 503,
    code: "credential_store_unavailable",
    retryable: true,
  },
  {
    name: "schema",
    cause: Object.assign(new Error("private relation missing"), {
      code: "42P01",
    }),
    status: 500,
    code: "credential_store_lookup_failed",
    retryable: false,
  },
  {
    name: "database permission",
    cause: Object.assign(new Error("private database permission"), {
      code: "42501",
    }),
    status: 500,
    code: "credential_store_lookup_failed",
    retryable: false,
  },
  {
    name: "unexpected bug",
    cause: new TypeError("private unexpected bug"),
    status: 500,
    code: "credential_store_lookup_failed",
    retryable: false,
  },
  {
    name: "revoked",
    cause: new ForbiddenError(),
    status: 403,
    code: undefined,
    retryable: false,
  },
  {
    name: "missing",
    cause: undefined,
    status: 200,
    code: undefined,
    retryable: false,
  },
  {
    name: "healthy Personal",
    cause: undefined,
    status: 200,
    code: undefined,
    retryable: false,
  },
])(
  "public credential resolver and HTTP: $name",
  ({ name, cause, status, code, retryable }) => {
    it.each(["secret", "pair"])(
      "classifies %s without exposing the cause",
      async (kind) => {
        fixture.storageFailure = cause;
        fixture.personalAbsent = name === "missing";
        vi.spyOn(console, "error").mockImplementation(() => {});
        const resolve = () =>
          runWithRequestContext(
            { userEmail: fixture.email, orgScope: "personal" },
            () =>
              kind === "secret"
                ? resolveSecret("ANTHROPIC_API_KEY")
                : resolveSecretPairs([
                    ["EXAMPLE_CLIENT_ID", "EXAMPLE_CLIENT_SECRET"],
                  ]),
          );
        const middleware: Array<
          (event: H3Event, next: () => Promise<unknown>) => unknown
        > = [];
        getH3App({ h3: { "~middleware": middleware } }).use(
          "/_agent-native/credential-probe",
          async () => ({ value: await resolve() }),
        );
        const app = new H3();
        app.use((event: H3Event) => {
          let index = 0;
          const next = async (): Promise<unknown> =>
            middleware[index++]?.(event, next);
          return next();
        });
        const response = await app.fetch(
          new Request(
            "https://app.example.test/_agent-native/credential-probe",
          ),
        );
        expect(response.status).toBe(status);
        expect(response.headers.get("retry-after")).toBe(
          retryable ? "5" : null,
        );
        const body = await response.json();
        if (cause) {
          const error = await resolve().catch((error: unknown) => error);
          if (cause instanceof ForbiddenError) expect(error).toBe(cause);
          else {
            expect(error).toMatchObject({
              cause,
              statusCode: status,
              errorCode: code,
              retryable,
            });
          }
        } else {
          expect(await resolve()).toEqual(
            name === "missing"
              ? null
              : kind === "secret"
                ? fixture.personalKey
                : ["fake-EXAMPLE_CLIENT_ID", "fake-EXAMPLE_CLIENT_SECRET"],
          );
        }
        if (code) {
          expect(body).toMatchObject({ code });
          expect(isTransientAutomationFailureCode(code)).toBe(retryable);
        }
        if (cause && !(cause instanceof ForbiddenError)) {
          expect(JSON.stringify(body)).not.toContain(cause.message);
          if (!retryable)
            expect(JSON.stringify(body)).not.toMatch(/temporary|try again/i);
        }
      },
    );
  },
);
