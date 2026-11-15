/**
 * DECLARED — strengthened independent regression draft for the future product
 * file `packages/core/src/workspace-connections/credential-unreadable.spec.ts`.
 *
 * Relative imports below are final for that product location. This copy lives
 * in a private review folder because parent source is still locked; it is not
 * a product edit and is not copied into the workspace by this draft.
 *
 * What is real here:
 * - the public wrapper `resolveWorkspaceConnectionCredentialForApp`
 * - the real `credentials/index.ts` `resolveCredentialForScope` helper and its
 *   strict opt-in path
 * - the real `credential-key-aliases.ts` `lookupKeysForRef` alias order
 * - real isolated PGlite for workspace connections and `app_secrets`
 * - real request-context propagation and real workspace store authorization
 *
 * Only the underlying legacy-row seam (`settings/store.getSetting`), the
 * cipher seam (`secrets/crypto`), and the DB transport adapter are
 * deterministic fixtures. No secret values, encryption keys, env vars,
 * network, provider SDK, browser, or server are used, and nothing is logged.
 *
 * RED boundary against current product source: `readCandidate()` calls the
 * direct scoped legacy helper without `throwOnUnreadable: true`. Three cases
 * are expected to fail for that reason:
 *   1. authorized corrupt user legacy row -> current `missing_secret`, wants
 *      the existing safe `status: "error"` classification;
 *   2. reachable unmarked org-first waterfall -> current code falls through to
 *      a later healthy workspace app secret, strict code must error and not
 *      read that later workspace value;
 *   3. HubSpot ref-key corruption -> current code falls through to a later
 *      alias app secret, strict code must error and not read any alias key.
 *
 * After only the contracted direct-scoped opt-in is added, the real helper
 * throws `AppSecretDecryptionError`, the wrapper's existing catch records the
 * safe `status: "error"` check, and all three cases should pass.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { resetAppConfigForTests } from "../app-config/index.js";
import { writeAppSecret } from "../secrets/storage.js";
import { runWithRequestContext } from "../server/request-context.js";
import { lookupKeysForRef } from "./credential-key-aliases.js";
import { resolveWorkspaceConnectionCredentialForApp } from "./credentials.js";
import {
  upsertWorkspaceConnection,
  type WorkspaceConnectionCredentialRef,
} from "./store.js";

const CIPHER_PREFIX = "fixture-cipher:";
const CORRUPT_CIPHERTEXT = `${CIPHER_PREFIX}unreadable-legacy-row`;
const DECRYPT_FAILURE = "synthetic unreadable legacy row";
const SAFE_UNREADABLE_MESSAGE = "A saved connection could not be decrypted.";

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  encryptSecretValue: vi.fn(),
  decryptSecretValue: vi.fn(),
  encryptSharedSecretValue: vi.fn(),
  decryptSharedSecretValueDetailed: vi.fn(),
  hasSharedSecretEncryptionKeyMaterial: vi.fn(),
  isEncryptedSecretValue: vi.fn(),
}));

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    getDbExec: () => sharedClient,
    isProductionServerlessFunctionRuntime:
      actual.isProductionServerlessFunctionRuntime,
    retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
  };
});

vi.mock("../settings/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settings/store.js")>();
  return {
    ...actual,
    getSetting: (...args: unknown[]) => mocks.getSetting(...args),
  };
});

vi.mock("../secrets/crypto.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../secrets/crypto.js")>();
  return {
    ...actual,
    encryptSecretValue: (...args: unknown[]) =>
      mocks.encryptSecretValue(...args),
    decryptSecretValue: (...args: unknown[]) =>
      mocks.decryptSecretValue(...args),
    encryptSharedSecretValue: (...args: unknown[]) =>
      mocks.encryptSharedSecretValue(...args),
    decryptSharedSecretValueDetailed: (...args: unknown[]) =>
      mocks.decryptSharedSecretValueDetailed(...args),
    hasSharedSecretEncryptionKeyMaterial: (...args: unknown[]) =>
      mocks.hasSharedSecretEncryptionKeyMaterial(...args),
    isEncryptedSecretValue: (...args: unknown[]) =>
      mocks.isEncryptedSecretValue(...args),
  };
});

interface FrameworkClient {
  execute(arg: string | { sql: string; args?: unknown[] }): Promise<{
    rows: Record<string, unknown>[];
    rowsAffected: number;
  }>;
}

type AppSecretSelect = {
  scope: string;
  scopeId: string;
  key: string;
};

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let sharedClient: FrameworkClient = {
  async execute() {
    return { rows: [], rowsAffected: 0 };
  },
};

/**
 * Real DB transport observation, reset after fixture creation and again per
 * denial attempt. A SELECT against `app_secrets` here means the wrapper
 * actually attempted a secret read; this is stronger than proving only that
 * the legacy settings seam was untouched.
 */
const appSecretSelects: AppSecretSelect[] = [];

function resetAppSecretSelects(): void {
  appSecretSelects.length = 0;
}

function recordAppSecretSelect(sql: string, args: readonly unknown[]): void {
  if (!/^\s*select/i.test(sql) || !/\bfrom\s+app_secrets\b/i.test(sql)) return;
  appSecretSelects.push({
    scope: args[0] == null ? "" : String(args[0]),
    scopeId: args[1] == null ? "" : String(args[1]),
    key: args.length > 2 && args[2] != null ? String(args[2]) : "",
  });
}

const OWNER = { userEmail: "owner@example.test", orgId: "org-fixture-1" };
const OTHER = { userEmail: "other@example.test", orgId: "org-fixture-1" };
const FOREIGN_ORG_ID = "org-foreign";
const PROVIDER = "slack";
const KEY = "SLACK_BOT_TOKEN";
const APP_ID = "brain";
const CORRUPT_CONNECTION = "conn-legacy-unreadable";
const ABSENT_CONNECTION = "conn-legacy-absent";
const HEALTHY_PLAIN_CONNECTION = "conn-legacy-plain";
const HEALTHY_CIPHER_CONNECTION = "conn-legacy-cipher";
const APP_SECRET_CONNECTION = "conn-app-secret";
const ORG_CONNECTION = "conn-org-legacy";
const USER_CONNECTION = "conn-user-legacy";
const RESTRICTED_CONNECTION = "conn-restricted-app";
const WATERFALL_CONNECTION = "conn-waterfall-unmarked";
const ALIAS_CONNECTION = "conn-hubspot-alias";

const HUBSPOT_PROVIDER = "hubspot";
const HUBSPOT_REQUESTED_KEY = "HUBSPOT_ACCESS_TOKEN";
const HUBSPOT_CORRUPT_REF_KEY = "HUBSPOT_PRIVATE_APP_TOKEN";
const HUBSPOT_HEALTHY_ALIAS_KEY = "HUBSPOT_SECRET_KEY";

const legacyRows = new Map<string, unknown>();

function userSettingKey(email: string, key = KEY): string {
  return `u:${email.toLowerCase()}:credential:${key}`;
}

function orgSettingKey(orgId: string, key = KEY): string {
  return `o:${orgId}:credential:${key}`;
}

function seedLegacyRow(settingKey: string, value: unknown): void {
  legacyRows.set(settingKey, value);
}

function decryptFixture(ciphertext: string): string {
  if (ciphertext === CORRUPT_CIPHERTEXT) throw new Error(DECRYPT_FAILURE);
  if (!ciphertext.startsWith(CIPHER_PREFIX)) {
    throw new Error("unexpected ciphertext fixture");
  }
  return ciphertext.slice(CIPHER_PREFIX.length);
}

function safeLookupFailureReason(connectionId: string): string {
  return `Fixture ${connectionId} credential lookup failed: ${SAFE_UNREADABLE_MESSAGE}`;
}

beforeAll(async () => {
  pglite = await createTestPglite();
  sharedClient = {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      recordAppSecretSelect(sql, args);
      const stmt = await pglite.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = (await stmt.all(...args)) as Record<string, unknown>[];
        return { rows, rowsAffected: 0 };
      }
      const result = await stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };
});

beforeEach(async () => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  resetAppSecretSelects();

  legacyRows.clear();
  resetAppConfigForTests();
  for (const table of [
    "workspace_connection_grants",
    "workspace_connections",
    "workspace_user_groups",
    "app_secrets",
    "settings",
    "org_members",
  ]) {
    try {
      await pglite.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // The owning store initializer creates each table on first use.
    }
  }

  mocks.getSetting.mockImplementation(async (settingKey: string) => {
    if (!legacyRows.has(settingKey)) return null;
    return { value: legacyRows.get(settingKey) };
  });
  mocks.encryptSecretValue.mockImplementation(
    (value: string) => `${CIPHER_PREFIX}${value}`,
  );
  mocks.encryptSharedSecretValue.mockImplementation(
    (value: string) => `${CIPHER_PREFIX}${value}`,
  );
  mocks.decryptSecretValue.mockImplementation((ciphertext: string) =>
    decryptFixture(ciphertext),
  );
  mocks.decryptSharedSecretValueDetailed.mockImplementation(
    (ciphertext: string) => ({
      value: decryptFixture(ciphertext),
      needsReencrypt: false,
    }),
  );
  mocks.hasSharedSecretEncryptionKeyMaterial.mockReturnValue(false);
  mocks.isEncryptedSecretValue.mockImplementation(
    (value: unknown) =>
      typeof value === "string" && value.startsWith(CIPHER_PREFIX),
  );
});

afterAll(async () => {
  await pglite.close();
});

async function seedConnection(
  id: string,
  options: {
    /**
     * `undefined` keeps the historical default (`scope: "user"`). `null`
     * deliberately omits the scope property so the ref is unmarked legacy and
     * can reach the real org -> workspace -> user waterfall.
     */
    refScope?: "user" | "org" | "workspace" | null;
    allowedApps?: string[];
    provider?: string;
    key?: string;
  } = {},
): Promise<void> {
  const ref: WorkspaceConnectionCredentialRef = {
    key: options.key ?? KEY,
  };
  const refScope = options.refScope === undefined ? "user" : options.refScope;
  if (refScope !== null) ref.scope = refScope;
  await runWithRequestContext(OWNER, () =>
    upsertWorkspaceConnection({
      id,
      provider: options.provider ?? PROVIDER,
      label: `Fixture ${id}`,
      allowedApps: options.allowedApps ?? [APP_ID],
      config: { workspaceConnectionScope: "user" },
      credentialRefs: [ref],
    }),
  );
}

async function seedWorkspaceSecret(
  scope: "user" | "org" | "workspace" | "solo",
  scopeId: string,
  value: string,
  key = KEY,
): Promise<void> {
  await runWithRequestContext(OWNER, () =>
    writeAppSecret({
      key,
      value,
      scope: scope === "solo" ? "workspace" : scope,
      scopeId,
    }),
  );
}

/**
 * Seed same-key app secrets in every place a wrong authorization check could
 * reach. They are written before the per-attempt read-count reset, so any
 * SELECT or returned decoy during resolution is observable and fails.
 */
async function seedReachableAppSecretDecoys(label: string): Promise<string[]> {
  const decoys = [
    {
      scope: "user" as const,
      scopeId: OWNER.userEmail,
      value: `fixture-decoy-${label}-owner-user`,
    },
    {
      scope: "user" as const,
      scopeId: OTHER.userEmail,
      value: `fixture-decoy-${label}-other-user`,
    },
    {
      scope: "org" as const,
      scopeId: OWNER.orgId,
      value: `fixture-decoy-${label}-owner-org`,
    },
    {
      scope: "workspace" as const,
      scopeId: OWNER.orgId,
      value: `fixture-decoy-${label}-owner-workspace`,
    },
    {
      scope: "org" as const,
      scopeId: FOREIGN_ORG_ID,
      value: `fixture-decoy-${label}-foreign-org`,
    },
    {
      scope: "workspace" as const,
      scopeId: FOREIGN_ORG_ID,
      value: `fixture-decoy-${label}-foreign-workspace`,
    },
    {
      scope: "workspace" as const,
      scopeId: `solo:${OWNER.userEmail}`,
      value: `fixture-decoy-${label}-owner-solo`,
    },
    {
      scope: "workspace" as const,
      scopeId: `solo:${OTHER.userEmail}`,
      value: `fixture-decoy-${label}-other-solo`,
    },
  ];
  for (const decoy of decoys) {
    await seedWorkspaceSecret(decoy.scope, decoy.scopeId, decoy.value);
  }
  return decoys.map((decoy) => decoy.value);
}

function resolvePinned(
  connectionId: string,
  context: { userEmail: string; orgId?: string | null } = OWNER,
  appId = APP_ID,
  options: { provider?: string; key?: string } = {},
) {
  return runWithRequestContext(
    {
      userEmail: context.userEmail,
      ...(context.orgId ? { orgId: context.orgId } : {}),
    },
    () =>
      resolveWorkspaceConnectionCredentialForApp({
        appId,
        provider: options.provider ?? PROVIDER,
        key: options.key ?? KEY,
        connectionId,
        recordUsage: false,
      }),
  );
}

describe("legacy workspace credential unreadability", () => {
  it("reports an authorized recognized legacy encrypted row that cannot decrypt as error, not missing_secret", async () => {
    await seedConnection(CORRUPT_CONNECTION, { refScope: "user" });
    seedLegacyRow(userSettingKey(OWNER.userEmail), CORRUPT_CIPHERTEXT);
    // Same-key values exist in other scopes; none may be used as a fallback.
    await seedWorkspaceSecret("org", OWNER.orgId, "fixture-org-app-secret");
    await seedWorkspaceSecret(
      "workspace",
      `solo:${OWNER.userEmail}`,
      "fixture-workspace-app-secret",
    );
    resetAppSecretSelects();

    const resolution = await resolvePinned(CORRUPT_CONNECTION);

    expect(resolution.available).toBe(false);
    expect(resolution.status).toBe("error");
    expect(resolution.value).toBeUndefined();
    expect(resolution.reason).toBe(safeLookupFailureReason(CORRUPT_CONNECTION));
    expect(resolution.checked).toHaveLength(1);
    expect(resolution.checked[0]).toMatchObject({
      status: "error",
      reason: safeLookupFailureReason(CORRUPT_CONNECTION),
      connectionId: CORRUPT_CONNECTION,
      key: KEY,
      resolvedKey: KEY,
      appAccessMode: "allowed-app",
    });
    expect(mocks.getSetting.mock.calls).toEqual([
      [userSettingKey(OWNER.userEmail)],
    ]);
    expect(appSecretSelects).toEqual([
      { scope: "user", scopeId: OWNER.userEmail, key: KEY },
    ]);
    expect(JSON.stringify(resolution)).not.toContain(CORRUPT_CIPHERTEXT);
    expect(JSON.stringify(resolution)).not.toContain("fixture-org-app-secret");
    expect(JSON.stringify(resolution)).not.toContain(
      "fixture-workspace-app-secret",
    );
  });

  it("keeps a genuinely absent legacy row as missing_secret", async () => {
    await seedConnection(ABSENT_CONNECTION, { refScope: "user" });
    await seedWorkspaceSecret("org", OWNER.orgId, "fixture-org-app-secret");
    resetAppSecretSelects();

    const resolution = await resolvePinned(ABSENT_CONNECTION);

    expect(resolution.available).toBe(false);
    expect(resolution.status).toBe("missing_secret");
    expect(resolution.value).toBeUndefined();
    expect(resolution.checked.at(-1)?.status).toBe("missing_secret");
    expect(mocks.getSetting.mock.calls).toEqual([
      [userSettingKey(OWNER.userEmail)],
    ]);
    expect(appSecretSelects).toEqual([
      { scope: "user", scopeId: OWNER.userEmail, key: KEY },
    ]);
  });

  it("resolves a healthy plaintext legacy user credential", async () => {
    await seedConnection(HEALTHY_PLAIN_CONNECTION, { refScope: "user" });
    seedLegacyRow(userSettingKey(OWNER.userEmail), "fixture-legacy-plaintext");

    const resolution = await resolvePinned(HEALTHY_PLAIN_CONNECTION);

    expect(resolution).toMatchObject({
      available: true,
      status: "resolved",
      value: "fixture-legacy-plaintext",
      provenance: {
        connectionId: HEALTHY_PLAIN_CONNECTION,
        secretScope: "user",
        backend: "credentials",
      },
    });
    expect(mocks.getSetting.mock.calls).toEqual([
      [userSettingKey(OWNER.userEmail)],
    ]);
  });

  it("resolves a healthy encrypted legacy user credential through the recognized decrypt seam", async () => {
    await seedConnection(HEALTHY_CIPHER_CONNECTION, { refScope: "user" });
    seedLegacyRow(
      userSettingKey(OWNER.userEmail),
      `${CIPHER_PREFIX}fixture-legacy-ciphertext`,
    );

    const resolution = await resolvePinned(HEALTHY_CIPHER_CONNECTION);

    expect(resolution).toMatchObject({
      available: true,
      status: "resolved",
      value: "fixture-legacy-ciphertext",
      provenance: {
        connectionId: HEALTHY_CIPHER_CONNECTION,
        secretScope: "user",
        backend: "credentials",
      },
    });
    expect(mocks.decryptSecretValue).toHaveBeenCalledTimes(1);
    expect(mocks.decryptSecretValue).toHaveBeenCalledWith(
      `${CIPHER_PREFIX}fixture-legacy-ciphertext`,
    );
  });

  it("prefers a healthy scoped app secret and never reads the legacy settings row", async () => {
    await seedConnection(APP_SECRET_CONNECTION, { refScope: "user" });
    await seedWorkspaceSecret(
      "user",
      OWNER.userEmail,
      "fixture-vault-app-secret",
    );
    seedLegacyRow(userSettingKey(OWNER.userEmail), "fixture-legacy-decoy");

    const resolution = await resolvePinned(APP_SECRET_CONNECTION);

    expect(resolution).toMatchObject({
      available: true,
      status: "resolved",
      value: "fixture-vault-app-secret",
      provenance: {
        connectionId: APP_SECRET_CONNECTION,
        secretScope: "user",
        backend: "secrets",
      },
    });
    expect(mocks.getSetting).not.toHaveBeenCalled();
    expect(JSON.stringify(resolution)).not.toContain("fixture-legacy-decoy");
  });

  it("reads exactly the authorized org legacy scope", async () => {
    await seedConnection(ORG_CONNECTION, { refScope: "org" });
    seedLegacyRow(orgSettingKey(OWNER.orgId), "fixture-org-legacy-value");
    seedLegacyRow(userSettingKey(OWNER.userEmail), "fixture-user-decoy");

    const resolution = await resolvePinned(ORG_CONNECTION);

    expect(resolution).toMatchObject({
      available: true,
      status: "resolved",
      value: "fixture-org-legacy-value",
      provenance: {
        connectionId: ORG_CONNECTION,
        secretScope: "org",
        backend: "credentials",
      },
    });
    expect(mocks.getSetting.mock.calls).toEqual([[orgSettingKey(OWNER.orgId)]]);
    expect(JSON.stringify(resolution)).not.toContain("fixture-user-decoy");
  });

  it("reads exactly the authorized user legacy scope and ignores another user's row", async () => {
    await seedConnection(USER_CONNECTION, { refScope: "user" });
    seedLegacyRow(userSettingKey(OWNER.userEmail), "fixture-owner-value");
    seedLegacyRow(userSettingKey(OTHER.userEmail), "fixture-other-user-decoy");

    const resolution = await resolvePinned(USER_CONNECTION);

    expect(resolution).toMatchObject({
      available: true,
      status: "resolved",
      value: "fixture-owner-value",
      provenance: {
        connectionId: USER_CONNECTION,
        secretScope: "user",
        backend: "credentials",
      },
    });
    expect(mocks.getSetting.mock.calls).toEqual([
      [userSettingKey(OWNER.userEmail)],
    ]);
    expect(JSON.stringify(resolution)).not.toContain(
      "fixture-other-user-decoy",
    );
  });

  it("denies a restricted app, foreign actor, and foreign org with exact not_available and zero app_secret reads", async () => {
    await seedConnection(RESTRICTED_CONNECTION, {
      refScope: "user",
      allowedApps: ["another-app"],
    });
    await seedConnection(USER_CONNECTION, { refScope: "user" });
    seedLegacyRow(userSettingKey(OWNER.userEmail), "fixture-owner-value");

    const attempts: Array<{
      label: string;
      connectionId: string;
      context: { userEmail: string; orgId?: string | null };
      appId: string;
      expectedReason: string;
      expectedConnectionId: string | undefined;
      expectedAppAccessMode: "unavailable" | undefined;
    }> = [
      {
        label: "restricted app",
        connectionId: RESTRICTED_CONNECTION,
        context: OWNER,
        appId: APP_ID,
        expectedReason: `Grant ${APP_ID} access before this connection can be reused by the app.`,
        expectedConnectionId: RESTRICTED_CONNECTION,
        expectedAppAccessMode: "unavailable",
      },
      {
        label: "foreign actor",
        connectionId: USER_CONNECTION,
        context: OTHER,
        appId: APP_ID,
        expectedReason: `Workspace connection "${USER_CONNECTION}" was not found in the current request scope.`,
        expectedConnectionId: undefined,
        expectedAppAccessMode: undefined,
      },
      {
        label: "foreign org",
        connectionId: USER_CONNECTION,
        context: { userEmail: OWNER.userEmail, orgId: FOREIGN_ORG_ID },
        appId: APP_ID,
        expectedReason: `Workspace connection "${USER_CONNECTION}" was not found in the current request scope.`,
        expectedConnectionId: undefined,
        expectedAppAccessMode: undefined,
      },
    ];

    for (const attempt of attempts) {
      const decoyValues = await seedReachableAppSecretDecoys(attempt.label);
      mocks.getSetting.mockClear();
      resetAppSecretSelects();

      const resolution = await resolvePinned(
        attempt.connectionId,
        attempt.context,
        attempt.appId,
      );

      expect(resolution.available, attempt.label).toBe(false);
      expect(resolution.status, attempt.label).toBe("not_available");
      expect(resolution.value, attempt.label).toBeUndefined();
      expect(resolution.reason, attempt.label).toBe(attempt.expectedReason);
      expect(resolution.checked, attempt.label).toHaveLength(1);
      expect(resolution.checked[0]?.status, attempt.label).toBe(
        "not_available",
      );
      expect(resolution.checked[0]?.reason, attempt.label).toBe(
        attempt.expectedReason,
      );
      expect(resolution.checked[0]?.key, attempt.label).toBe(KEY);
      expect(resolution.checked[0]?.connectionId, attempt.label).toBe(
        attempt.expectedConnectionId,
      );
      expect(resolution.checked[0]?.appAccessMode, attempt.label).toBe(
        attempt.expectedAppAccessMode,
      );
      expect(resolution.checked[0]?.grantId, attempt.label).toBeNull();
      expect(mocks.getSetting, attempt.label).not.toHaveBeenCalled();
      // The real DB transport saw no app_secrets SELECT at all, so no
      // authorization step was preceded by a secret read.
      expect(appSecretSelects, attempt.label).toEqual([]);
      expect(JSON.stringify(resolution), attempt.label).not.toContain(
        "fixture-owner-value",
      );
      for (const decoyValue of decoyValues) {
        expect(JSON.stringify(resolution), attempt.label).not.toContain(
          decoyValue,
        );
      }
    }
  });

  it("does not fall through to a later healthy workspace app secret when an unmarked org-first legacy row cannot decrypt", async () => {
    // Scope is really omitted: the ref is an unmarked legacy ref, so the real
    // candidate order under OWNER.orgId is org -> workspace -> user.
    await seedConnection(WATERFALL_CONNECTION, { refScope: null });
    seedLegacyRow(orgSettingKey(OWNER.orgId), CORRUPT_CIPHERTEXT);
    await seedWorkspaceSecret(
      "workspace",
      OWNER.orgId,
      "fixture-waterfall-workspace-app-secret",
    );
    resetAppSecretSelects();

    const resolution = await resolvePinned(WATERFALL_CONNECTION);

    expect(resolution.available).toBe(false);
    expect(resolution.status).toBe("error");
    expect(resolution.value).toBeUndefined();
    expect(resolution.reason).toBe(
      safeLookupFailureReason(WATERFALL_CONNECTION),
    );
    expect(resolution.checked).toHaveLength(1);
    expect(resolution.checked[0]).toMatchObject({
      status: "error",
      reason: safeLookupFailureReason(WATERFALL_CONNECTION),
      connectionId: WATERFALL_CONNECTION,
      key: KEY,
      resolvedKey: KEY,
      appAccessMode: "allowed-app",
    });
    expect(mocks.getSetting.mock.calls).toEqual([[orgSettingKey(OWNER.orgId)]]);
    // Exactly the high-priority org app-secret probe ran before the corrupt
    // legacy row threw. The later workspace value was never read.
    expect(appSecretSelects).toEqual([
      { scope: "org", scopeId: OWNER.orgId, key: KEY },
    ]);
    expect(JSON.stringify(resolution)).not.toContain(
      "fixture-waterfall-workspace-app-secret",
    );
    expect(JSON.stringify(resolution)).not.toContain(CORRUPT_CIPHERTEXT);
  });

  it("does not fall through to a HubSpot alias secret when the ref-key legacy row cannot decrypt", async () => {
    // Pin the real alias order this case depends on.
    expect(
      lookupKeysForRef(
        HUBSPOT_PROVIDER,
        HUBSPOT_REQUESTED_KEY,
        HUBSPOT_CORRUPT_REF_KEY,
      ),
    ).toEqual([
      HUBSPOT_CORRUPT_REF_KEY,
      HUBSPOT_REQUESTED_KEY,
      HUBSPOT_HEALTHY_ALIAS_KEY,
    ]);

    await seedConnection(ALIAS_CONNECTION, {
      refScope: "user",
      provider: HUBSPOT_PROVIDER,
      key: HUBSPOT_CORRUPT_REF_KEY,
    });
    seedLegacyRow(
      userSettingKey(OWNER.userEmail, HUBSPOT_CORRUPT_REF_KEY),
      CORRUPT_CIPHERTEXT,
    );
    await seedWorkspaceSecret(
      "user",
      OWNER.userEmail,
      "fixture-hubspot-alias-app-secret",
      HUBSPOT_HEALTHY_ALIAS_KEY,
    );
    resetAppSecretSelects();

    const resolution = await resolvePinned(ALIAS_CONNECTION, OWNER, APP_ID, {
      provider: HUBSPOT_PROVIDER,
      key: HUBSPOT_REQUESTED_KEY,
    });

    expect(resolution.available).toBe(false);
    expect(resolution.status).toBe("error");
    expect(resolution.value).toBeUndefined();
    expect(resolution.reason).toBe(safeLookupFailureReason(ALIAS_CONNECTION));
    expect(resolution.checked).toHaveLength(1);
    expect(resolution.checked[0]).toMatchObject({
      status: "error",
      reason: safeLookupFailureReason(ALIAS_CONNECTION),
      connectionId: ALIAS_CONNECTION,
      key: HUBSPOT_REQUESTED_KEY,
      resolvedKey: HUBSPOT_CORRUPT_REF_KEY,
      appAccessMode: "allowed-app",
    });
    expect(mocks.getSetting.mock.calls).toEqual([
      [userSettingKey(OWNER.userEmail, HUBSPOT_CORRUPT_REF_KEY)],
    ]);
    // Only the corrupt ref-key app-secret probe happened; neither the
    // requested key nor the later healthy alias key was read.
    expect(appSecretSelects).toEqual([
      {
        scope: "user",
        scopeId: OWNER.userEmail,
        key: HUBSPOT_CORRUPT_REF_KEY,
      },
    ]);
    expect(JSON.stringify(resolution)).not.toContain(
      "fixture-hubspot-alias-app-secret",
    );
    expect(JSON.stringify(resolution)).not.toContain(CORRUPT_CIPHERTEXT);
  });
});
