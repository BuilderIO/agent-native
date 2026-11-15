/**
 * Strict scoped credential read (`throwOnUnreadable`).
 *
 * DECLARED — authored for the credentials helper this spec sits beside; the
 * relative imports below are final for that location. Not executed here, and
 * no pass/fail is claimed: the opt-in flag is ignored by the current helper,
 * so the strict cases are the ones that must fail before the source change.
 *
 * Contexts are plain structural variables carrying `throwOnUnreadable`, so the
 * file compiles against the unchanged helper signature with no `any`,
 * `as unknown as`, or `ts-ignore`.
 *
 * Provenance pin: the typed error's `.scopeId` is
 * the canonical lowercased user email for user scope and the exact `orgId` for
 * org scope; only that lowercasing is applied, with no trim and no second
 * identity lookup. A mixed-case user email and a mixed-case org id are used so
 * this is enforced rather than assumed.
 *
 * Isolation: every runtime dependency of the helper is replaced with a full
 * factory mock (settings store, crypto, storage, db, permissions, provider,
 * read-order/policy, request context). No real crypto/settings/DB module graph
 * is evaluated. Boundaries the strict read must not touch are configured to
 * throw if called, and alternate user/org rows are always present in the fake
 * settings map so "exact scope only" is proven by call arguments, not by an
 * empty store.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppSecretDecryptionError } from "../secrets/errors.js";

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  putSetting: vi.fn(),
  deleteSetting: vi.fn(),
  encryptSecretValue: vi.fn(),
  decryptSecretValue: vi.fn(),
  isEncryptedSecretValue: vi.fn(),
  readAppSecret: vi.fn(),
  deleteAppSecret: vi.fn(),
  isMissingAppSecretsTableError: vi.fn(),
  getDbExec: vi.fn(),
  canManageOrg: vi.fn(),
  assertCredentialStoreReadable: vi.fn(),
  isPersonalCredentialScope: vi.fn(),
  readsOrgCredentialFirst: vi.fn(),
  isPersonalProviderKeyUseRestricted: vi.fn(),
  isPersonalProviderPolicyKey: vi.fn(),
  readOrgMemberRole: vi.fn(),
  getRequestContext: vi.fn(),
}));

vi.mock("../settings/store.js", () => ({
  getSetting: (...args: unknown[]) => mocks.getSetting(...args),
  putSetting: (...args: unknown[]) => mocks.putSetting(...args),
  deleteSetting: (...args: unknown[]) => mocks.deleteSetting(...args),
}));

vi.mock("../secrets/crypto.js", () => ({
  encryptSecretValue: (...args: unknown[]) => mocks.encryptSecretValue(...args),
  decryptSecretValue: (...args: unknown[]) => mocks.decryptSecretValue(...args),
  isEncryptedSecretValue: (...args: unknown[]) =>
    mocks.isEncryptedSecretValue(...args),
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: (...args: unknown[]) => mocks.readAppSecret(...args),
  deleteAppSecret: (...args: unknown[]) => mocks.deleteAppSecret(...args),
  isMissingAppSecretsTableError: (...args: unknown[]) =>
    mocks.isMissingAppSecretsTableError(...args),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: (...args: unknown[]) => mocks.getDbExec(...args),
}));

vi.mock("../org/permissions.js", () => ({
  canManageOrg: (...args: unknown[]) => mocks.canManageOrg(...args),
}));

vi.mock("../server/credential-provider.js", () => ({
  assertCredentialStoreReadable: (...args: unknown[]) =>
    mocks.assertCredentialStoreReadable(...args),
}));

vi.mock("../server/credential-read-order.js", () => ({
  isPersonalCredentialScope: (...args: unknown[]) =>
    mocks.isPersonalCredentialScope(...args),
  readsOrgCredentialFirst: (...args: unknown[]) =>
    mocks.readsOrgCredentialFirst(...args),
}));

vi.mock("../server/personal-provider-key-policy.js", () => ({
  isPersonalProviderKeyUseRestricted: (...args: unknown[]) =>
    mocks.isPersonalProviderKeyUseRestricted(...args),
  isPersonalProviderPolicyKey: (...args: unknown[]) =>
    mocks.isPersonalProviderPolicyKey(...args),
  readOrgMemberRole: (...args: unknown[]) => mocks.readOrgMemberRole(...args),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestContext: (...args: unknown[]) => mocks.getRequestContext(...args),
}));

const { resolveCredentialForScope } = await import("./index.js");

const CREDENTIAL_KEY = "SEALED_KEY";
const OTHER_KEY = "OTHER_SEALED_KEY";
const SEALED_CIPHERTEXT = "flagged-source-credential";
const SEALED_PLAINTEXT = "sealed-fixture-value";
const DECOY_PLAINTEXT = "decoy-plaintext-fixture";
const DECRYPT_CAUSE_MARKER = "synthetic-private-decrypt-cause-marker";
const RECOGNITION_CAUSE_MARKER = "synthetic-private-recognition-cause-marker";
const STORE_FAILURE_MESSAGE = "settings read timed out";
const STABLE_ERROR_MESSAGE = "A saved connection could not be decrypted.";
const USER_EMAIL = "Member@Example.Test";
const USER_LOOKUP_EMAIL = "member@example.test";
const ORG_ID = "Org-Sealed-AbC";
const USER_SETTING_KEY = `u:${USER_LOOKUP_EMAIL}:credential:${CREDENTIAL_KEY}`;
const ORG_SETTING_KEY = `o:${ORG_ID}:credential:${CREDENTIAL_KEY}`;
const ALT_USER_SETTING_KEY = `u:${USER_LOOKUP_EMAIL}:credential:${OTHER_KEY}`;
const ALT_ORG_SETTING_KEY = `o:${ORG_ID}:credential:${OTHER_KEY}`;

/**
 * Structural stand-in for the scoped context argument. The strict flag is
 * declared optional here and passed through a variable, which the current
 * helper (and the extended one) accepts without excess-property errors.
 */
interface ScopedReadContext {
  userEmail: string;
  orgId?: string | null;
  scope: "user" | "org";
  throwOnUnreadable?: boolean;
}

const strictUserContext: ScopedReadContext = {
  userEmail: USER_EMAIL,
  scope: "user",
  throwOnUnreadable: true,
};

const strictOrgContext: ScopedReadContext = {
  userEmail: USER_EMAIL,
  orgId: ORG_ID,
  scope: "org",
  throwOnUnreadable: true,
};

const legacyUserContext: ScopedReadContext = {
  userEmail: USER_EMAIL,
  scope: "user",
};

const legacyOrgContext: ScopedReadContext = {
  userEmail: USER_EMAIL,
  orgId: ORG_ID,
  scope: "org",
};

const explicitFalseUserContext: ScopedReadContext = {
  userEmail: USER_EMAIL,
  scope: "user",
  throwOnUnreadable: false,
};

const explicitFalseOrgContext: ScopedReadContext = {
  userEmail: USER_EMAIL,
  orgId: ORG_ID,
  scope: "org",
  throwOnUnreadable: false,
};

const strictScopes = [
  {
    label: "user",
    context: strictUserContext,
    key: USER_SETTING_KEY,
    scopeId: USER_LOOKUP_EMAIL,
  },
  {
    label: "org",
    context: strictOrgContext,
    key: ORG_SETTING_KEY,
    scopeId: ORG_ID,
  },
];

/** Fake settings map; always seeded with alternate user/org rows as decoys. */
const settingsRows = new Map<string, Record<string, unknown>>();

function seedRow(settingKey: string, value: unknown): void {
  settingsRows.set(settingKey, { value });
}

function dropRow(settingKey: string): void {
  settingsRows.delete(settingKey);
}

function makeCorruptEncryptedRow(
  settingKey: string,
  cause: Error = new Error(DECRYPT_CAUSE_MARKER),
): void {
  seedRow(settingKey, SEALED_CIPHERTEXT);
  mocks.decryptSecretValue.mockImplementation(() => {
    throw cause;
  });
}

function unexpectedCall(name: string): () => never {
  return () => {
    throw new Error(`unexpected ${name} call`);
  };
}

const bypassBoundaries = () => [
  { name: "readAppSecret", mock: mocks.readAppSecret },
  { name: "deleteAppSecret", mock: mocks.deleteAppSecret },
  {
    name: "isMissingAppSecretsTableError",
    mock: mocks.isMissingAppSecretsTableError,
  },
  { name: "getDbExec", mock: mocks.getDbExec },
  { name: "canManageOrg", mock: mocks.canManageOrg },
  {
    name: "assertCredentialStoreReadable",
    mock: mocks.assertCredentialStoreReadable,
  },
  {
    name: "isPersonalCredentialScope",
    mock: mocks.isPersonalCredentialScope,
  },
  { name: "readsOrgCredentialFirst", mock: mocks.readsOrgCredentialFirst },
  {
    name: "isPersonalProviderKeyUseRestricted",
    mock: mocks.isPersonalProviderKeyUseRestricted,
  },
  {
    name: "isPersonalProviderPolicyKey",
    mock: mocks.isPersonalProviderPolicyKey,
  },
  { name: "readOrgMemberRole", mock: mocks.readOrgMemberRole },
  { name: "getRequestContext", mock: mocks.getRequestContext },
  { name: "encryptSecretValue", mock: mocks.encryptSecretValue },
  { name: "putSetting", mock: mocks.putSetting },
  { name: "deleteSetting", mock: mocks.deleteSetting },
];

function expectNoBypassReads(): void {
  for (const boundary of bypassBoundaries()) {
    expect(boundary.mock, boundary.name).not.toHaveBeenCalled();
  }
}

function expectNoLeak(text: string): void {
  expect(text).not.toContain(SEALED_CIPHERTEXT);
  expect(text).not.toContain(SEALED_PLAINTEXT);
  expect(text).not.toContain(CREDENTIAL_KEY);
  expect(text).not.toContain(USER_EMAIL);
  expect(text).not.toContain(USER_LOOKUP_EMAIL);
  expect(text).not.toContain(ORG_ID);
  expect(text).not.toContain(DECRYPT_CAUSE_MARKER);
  expect(text).not.toContain(RECOGNITION_CAUSE_MARKER);
}

async function readStrict(
  context: ScopedReadContext,
): Promise<string | undefined> {
  return resolveCredentialForScope(CREDENTIAL_KEY, context);
}

async function captureStrictError(
  context: ScopedReadContext,
): Promise<AppSecretDecryptionError> {
  try {
    await readStrict(context);
  } catch (error) {
    expect(error).toBeInstanceOf(AppSecretDecryptionError);
    return error as AppSecretDecryptionError;
  }
  throw new Error(
    "strict scoped read returned instead of throwing for an unreadable row",
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();

  settingsRows.clear();
  // Alternate rows always exist for the same key, other scope and other key,
  // so a strict read that fell back could actually succeed and be caught.
  seedRow(ALT_USER_SETTING_KEY, DECOY_PLAINTEXT);
  seedRow(ALT_ORG_SETTING_KEY, DECOY_PLAINTEXT);
  seedRow(USER_SETTING_KEY, DECOY_PLAINTEXT);
  seedRow(ORG_SETTING_KEY, DECOY_PLAINTEXT);

  mocks.getSetting.mockImplementation(
    async (settingKey: string) => settingsRows.get(settingKey) ?? null,
  );
  mocks.decryptSecretValue.mockReturnValue(SEALED_PLAINTEXT);
  mocks.isEncryptedSecretValue.mockImplementation(
    (value: unknown) => value === SEALED_CIPHERTEXT,
  );

  for (const boundary of bypassBoundaries()) {
    boundary.mock.mockImplementation(unexpectedCall(boundary.name));
  }
});

describe("strict scoped credential read", () => {
  it("throws the typed error for an unreadable encrypted user row and reads only the lowercased user key", async () => {
    makeCorruptEncryptedRow(USER_SETTING_KEY);
    // The alternate org row for the same key stays readable and must be unused.
    expect(settingsRows.get(ORG_SETTING_KEY)).toEqual({
      value: DECOY_PLAINTEXT,
    });

    const error = await captureStrictError(strictUserContext);

    expect(error.name).toBe("AppSecretDecryptionError");
    expect(error.errorCode).toBe("app_secret_unreadable");
    expect(error.message).toBe(STABLE_ERROR_MESSAGE);
    expect(error.scope).toBe("user");
    expect(error.scopeId).toBe(USER_LOOKUP_EMAIL);
    expect(error.scopeId).not.toBe(USER_EMAIL);
    expect(mocks.getSetting.mock.calls).toEqual([[USER_SETTING_KEY]]);
    expect(mocks.isEncryptedSecretValue).toHaveBeenCalledTimes(1);
    expect(mocks.isEncryptedSecretValue).toHaveBeenCalledWith(
      SEALED_CIPHERTEXT,
    );
    expect(mocks.decryptSecretValue).toHaveBeenCalledTimes(1);
    expect(mocks.decryptSecretValue).toHaveBeenCalledWith(SEALED_CIPHERTEXT);
    expectNoBypassReads();
  });

  it("throws the typed error for an unreadable encrypted org row and keeps the org id exact", async () => {
    makeCorruptEncryptedRow(ORG_SETTING_KEY);
    // The alternate user row for the same key stays readable and must be unused.
    expect(settingsRows.get(USER_SETTING_KEY)).toEqual({
      value: DECOY_PLAINTEXT,
    });

    const error = await captureStrictError(strictOrgContext);

    expect(error.errorCode).toBe("app_secret_unreadable");
    expect(error.message).toBe(STABLE_ERROR_MESSAGE);
    expect(error.scope).toBe("org");
    expect(error.scopeId).toBe(ORG_ID);
    expect(mocks.getSetting.mock.calls).toEqual([[ORG_SETTING_KEY]]);
    expect(mocks.decryptSecretValue).toHaveBeenCalledTimes(1);
    expect(mocks.decryptSecretValue).toHaveBeenCalledWith(SEALED_CIPHERTEXT);
    expectNoBypassReads();
  });

  it("keeps the legacy default for corrupt user and org rows when the flag is omitted", async () => {
    const scopes = [
      { label: "user", context: legacyUserContext, key: USER_SETTING_KEY },
      { label: "org", context: legacyOrgContext, key: ORG_SETTING_KEY },
    ];

    for (const scoped of scopes) {
      mocks.getSetting.mockClear();
      makeCorruptEncryptedRow(scoped.key);
      mocks.decryptSecretValue.mockClear();

      await expect(
        readStrict(scoped.context),
        scoped.label,
      ).resolves.toBeUndefined();

      expect(mocks.getSetting.mock.calls, scoped.label).toEqual([[scoped.key]]);
      expect(mocks.decryptSecretValue, scoped.label).toHaveBeenCalledTimes(1);
      expect(mocks.decryptSecretValue, scoped.label).toHaveBeenCalledWith(
        SEALED_CIPHERTEXT,
      );
      expectNoBypassReads();
    }
  });

  it("keeps the legacy default for corrupt user and org rows when the flag is explicitly false", async () => {
    const scopes = [
      {
        label: "user",
        context: explicitFalseUserContext,
        key: USER_SETTING_KEY,
      },
      { label: "org", context: explicitFalseOrgContext, key: ORG_SETTING_KEY },
    ];

    for (const scoped of scopes) {
      mocks.getSetting.mockClear();
      makeCorruptEncryptedRow(scoped.key);
      mocks.decryptSecretValue.mockClear();

      await expect(
        readStrict(scoped.context),
        scoped.label,
      ).resolves.toBeUndefined();

      expect(mocks.getSetting.mock.calls, scoped.label).toEqual([[scoped.key]]);
      expect(mocks.decryptSecretValue, scoped.label).toHaveBeenCalledTimes(1);
      expectNoBypassReads();
    }
  });

  it("returns undefined without decrypting for missing, null, or non-string rows in both scopes", async () => {
    const probes = [
      {
        label: "a missing row",
        apply: (settingKey: string) => dropRow(settingKey),
      },
      {
        label: "a null value",
        apply: (settingKey: string) => seedRow(settingKey, null),
      },
      {
        label: "a numeric value",
        apply: (settingKey: string) => seedRow(settingKey, 42),
      },
    ];

    for (const probe of probes) {
      for (const scoped of strictScopes) {
        probe.apply(scoped.key);
        mocks.getSetting.mockClear();
        mocks.isEncryptedSecretValue.mockClear();
        mocks.decryptSecretValue.mockClear();

        await expect(
          readStrict(scoped.context),
          `${scoped.label} ${probe.label}`,
        ).resolves.toBeUndefined();

        expect(
          mocks.getSetting.mock.calls,
          `${scoped.label} ${probe.label}`,
        ).toEqual([[scoped.key]]);
        expect(
          mocks.isEncryptedSecretValue,
          `${scoped.label} ${probe.label}`,
        ).not.toHaveBeenCalled();
        expect(
          mocks.decryptSecretValue,
          `${scoped.label} ${probe.label}`,
        ).not.toHaveBeenCalled();
        expectNoBypassReads();
      }
    }
  });

  it("passes legacy plaintext through exactly, including empty and whitespace, in both scopes", async () => {
    const plaintexts = [SEALED_PLAINTEXT, "  padded fixture  ", "", "  "];

    for (const plaintext of plaintexts) {
      for (const scoped of strictScopes) {
        seedRow(scoped.key, plaintext);
        mocks.getSetting.mockClear();
        mocks.decryptSecretValue.mockClear();

        await expect(
          readStrict(scoped.context),
          `${scoped.label} ${JSON.stringify(plaintext)}`,
        ).resolves.toBe(plaintext);

        expect(
          mocks.getSetting.mock.calls,
          `${scoped.label} ${JSON.stringify(plaintext)}`,
        ).toEqual([[scoped.key]]);
        expect(
          mocks.isEncryptedSecretValue,
          `${scoped.label} ${JSON.stringify(plaintext)}`,
        ).toHaveBeenCalledWith(plaintext);
        expect(
          mocks.decryptSecretValue,
          `${scoped.label} ${JSON.stringify(plaintext)}`,
        ).not.toHaveBeenCalled();
        expectNoBypassReads();
      }
    }
  });

  it("returns the exact decrypted value for a readable encrypted row in both scopes", async () => {
    for (const scoped of strictScopes) {
      seedRow(scoped.key, SEALED_CIPHERTEXT);
      mocks.getSetting.mockClear();
      mocks.isEncryptedSecretValue.mockClear();
      mocks.decryptSecretValue.mockClear();

      await expect(readStrict(scoped.context), scoped.label).resolves.toBe(
        SEALED_PLAINTEXT,
      );

      expect(mocks.getSetting.mock.calls, scoped.label).toEqual([[scoped.key]]);
      expect(mocks.isEncryptedSecretValue, scoped.label).toHaveBeenCalledWith(
        SEALED_CIPHERTEXT,
      );
      expect(mocks.decryptSecretValue, scoped.label).toHaveBeenCalledTimes(1);
      expect(mocks.decryptSecretValue, scoped.label).toHaveBeenCalledWith(
        SEALED_CIPHERTEXT,
      );
      expectNoBypassReads();
    }
  });

  it("propagates a store read failure unchanged instead of reporting the row missing", async () => {
    for (const scoped of strictScopes) {
      const failure = new Error(STORE_FAILURE_MESSAGE);
      mocks.getSetting.mockClear();
      mocks.getSetting.mockImplementation(async () => {
        throw failure;
      });
      mocks.decryptSecretValue.mockClear();

      await expect(readStrict(scoped.context), scoped.label).rejects.toBe(
        failure,
      );

      expect(mocks.decryptSecretValue, scoped.label).not.toHaveBeenCalled();
      expectNoBypassReads();
    }
  });

  it("propagates an encrypted-recognition failure unchanged and never decrypts", async () => {
    const recognitionFailure = new Error(RECOGNITION_CAUSE_MARKER);
    makeCorruptEncryptedRow(USER_SETTING_KEY);
    mocks.isEncryptedSecretValue.mockImplementation(() => {
      throw recognitionFailure;
    });

    await expect(readStrict(strictUserContext)).rejects.toBe(
      recognitionFailure,
    );

    expect(mocks.decryptSecretValue).not.toHaveBeenCalled();
    expectNoBypassReads();
  });

  it("refuses missing identity before touching the store, decrypting, or falling back", async () => {
    const invalidContexts: ScopedReadContext[] = [
      { userEmail: "", scope: "user", throwOnUnreadable: true },
      { userEmail: "", scope: "org", orgId: ORG_ID, throwOnUnreadable: true },
      { userEmail: USER_EMAIL, scope: "org", throwOnUnreadable: true },
      {
        userEmail: USER_EMAIL,
        scope: "org",
        orgId: null,
        throwOnUnreadable: true,
      },
      {
        userEmail: USER_EMAIL,
        scope: "org",
        orgId: "",
        throwOnUnreadable: true,
      },
    ];

    for (const context of invalidContexts) {
      await expect(
        readStrict(context),
        `${context.scope}:${JSON.stringify(context.orgId ?? null)}:${context.userEmail}`,
      ).resolves.toBeUndefined();
    }

    expect(mocks.getSetting).not.toHaveBeenCalled();
    expect(mocks.isEncryptedSecretValue).not.toHaveBeenCalled();
    expect(mocks.decryptSecretValue).not.toHaveBeenCalled();
    expectNoBypassReads();
  });

  it("keeps the decryption cause out of both scopes' string, message, stack, JSON, and enumerable payload", async () => {
    for (const scoped of strictScopes) {
      makeCorruptEncryptedRow(scoped.key);
      mocks.decryptSecretValue.mockClear();

      const error = await captureStrictError(scoped.context);
      const serialized = JSON.stringify(error);
      const enumerable = Object.entries(error as object)
        .map(([name, value]) => `${name}:${String(value)}`)
        .join(" ");

      expect(error.name, scoped.label).toBe("AppSecretDecryptionError");
      expect(error.errorCode, scoped.label).toBe("app_secret_unreadable");
      expect(error.message, scoped.label).toBe(STABLE_ERROR_MESSAGE);
      // Intentional, authorized getters still report the exact reference.
      expect(error.scope, scoped.label).toBe(scoped.context.scope);
      expect(error.scopeId, scoped.label).toBe(scoped.scopeId);
      // Everything printable/enumerable stays free of cause and fixtures.
      expectNoLeak(String(error));
      expectNoLeak(error.message);
      expectNoLeak(error.stack ?? "");
      expectNoLeak(serialized);
      expectNoLeak(enumerable);
      expect(serialized, scoped.label).not.toContain("value");
      expect(serialized, scoped.label).not.toContain("cause");
      expect(serialized, scoped.label).not.toContain("ref");
      expect(serialized.length, scoped.label).toBeGreaterThan(0);
    }
  });

  it("keeps frozen mixed-case contexts unmutated while reporting canonical user and exact org identities", async () => {
    const frozenUserContext = Object.freeze({
      userEmail: USER_EMAIL,
      scope: "user" as const,
      throwOnUnreadable: true,
    });
    makeCorruptEncryptedRow(USER_SETTING_KEY);

    const userError = await captureStrictError(frozenUserContext);

    expect(Object.isFrozen(frozenUserContext)).toBe(true);
    expect(frozenUserContext.userEmail).toBe(USER_EMAIL);
    expect(frozenUserContext.userEmail).not.toBe(USER_LOOKUP_EMAIL);
    expect(userError.scope).toBe("user");
    expect(userError.scopeId).toBe(USER_LOOKUP_EMAIL);
    expect(userError.scopeId).toBe(frozenUserContext.userEmail.toLowerCase());
    expect(userError.scopeId).not.toBe(USER_EMAIL);
    expect(mocks.getSetting.mock.calls).toEqual([[USER_SETTING_KEY]]);
    expect(mocks.isEncryptedSecretValue).toHaveBeenCalledWith(
      SEALED_CIPHERTEXT,
    );
    expect(mocks.decryptSecretValue).toHaveBeenCalledTimes(1);
    expect(mocks.decryptSecretValue).toHaveBeenCalledWith(SEALED_CIPHERTEXT);
    expectNoBypassReads();

    const frozenOrgContext = Object.freeze({
      userEmail: USER_EMAIL,
      orgId: ORG_ID,
      scope: "org" as const,
      throwOnUnreadable: true,
    });
    mocks.getSetting.mockClear();
    makeCorruptEncryptedRow(ORG_SETTING_KEY);
    mocks.decryptSecretValue.mockClear();

    const orgError = await captureStrictError(frozenOrgContext);

    expect(Object.isFrozen(frozenOrgContext)).toBe(true);
    expect(frozenOrgContext.orgId).toBe(ORG_ID);
    expect(orgError.scope).toBe("org");
    expect(orgError.scopeId).toBe(ORG_ID);
    expect(orgError.scopeId).toBe(frozenOrgContext.orgId);
    expect(mocks.getSetting.mock.calls).toEqual([[ORG_SETTING_KEY]]);
    expect(mocks.decryptSecretValue).toHaveBeenCalledTimes(1);
    expectNoBypassReads();
  });
});
