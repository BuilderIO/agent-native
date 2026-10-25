import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvKeyConfig } from "../server/create-server.js";

const store = vi.hoisted(() => new Map<string, string>());
const env = vi.hoisted(() => new Map<string, string>());
const configs = vi.hoisted(() => new Map<string, boolean>());
const unreadable = vi.hoisted(() => new Set<string>());
const vaultErrors = vi.hoisted(
  () => new Map<string, { scope: string; scopeId: string }>(),
);
const resolverActivity = vi.hoisted(() => ({ active: 0, maxActive: 0 }));
const prefetchSecretsMock = vi.hoisted(() =>
  vi.fn(async (_keys: readonly string[]) => {}),
);
const isUnreadable = (args: { key: string; scope: string; scopeId: string }) =>
  unreadable.has(args.key) ||
  unreadable.has(`${args.scope}:${args.scopeId}:${args.key}`);
const roleRef = vi.hoisted(() => ({ role: "owner" as string | null }));
const readErrorRef = vi.hoisted(() => ({ error: null as Error | null }));
const { AppSecretDecryptionError, CredentialStoreUnavailableError } =
  vi.hoisted(() => ({
    AppSecretDecryptionError: class extends Error {
      readonly errorCode = "app_secret_unreadable";

      scope?: string;
      scopeId?: string;

      constructor(ref?: { scope: string; scopeId: string }) {
        super("A saved connection could not be decrypted.");
        this.name = "AppSecretDecryptionError";
        this.scope = ref?.scope;
        this.scopeId = ref?.scopeId;
      }
    },
    CredentialStoreUnavailableError: class extends Error {
      constructor() {
        super("Could not read saved connections.");
        this.name = "CredentialStoreUnavailableError";
      }
    },
  }));

vi.mock("../secrets/errors.js", () => ({ AppSecretDecryptionError }));

vi.mock("../secrets/storage.js", () => ({
  readAppSecrets: vi.fn(
    async (args: { keys: string[]; scope: string; scopeId: string }) => {
      if (readErrorRef.error) throw readErrorRef.error;
      const out = new Map<string, { value: string }>();
      for (const key of args.keys) {
        const storageKey = `${args.scope}:${args.scopeId}:${key}`;
        const value = store.get(storageKey);
        if (value !== undefined && isUnreadable(args)) {
          throw new AppSecretDecryptionError(args);
        }
        if (value !== undefined) out.set(key, { value });
      }
      return out;
    },
  ),
  readAppSecret: vi.fn(
    async (args: { key: string; scope: string; scopeId: string }) => {
      if (readErrorRef.error) throw readErrorRef.error;
      const value = store.get(`${args.scope}:${args.scopeId}:${args.key}`);
      if (value !== undefined && isUnreadable(args)) {
        throw new AppSecretDecryptionError(args);
      }
      return value === undefined ? null : { value };
    },
  ),
  readAppSecretVersion: vi.fn(
    async (args: { key: string; scope: string; scopeId: string }) =>
      store.get(`${args.scope}:${args.scopeId}:${args.key}`) ?? null,
  ),
  writeAppSecret: vi.fn(
    async (args: {
      key: string;
      value: string;
      scope: string;
      scopeId: string;
    }) => {
      store.set(`${args.scope}:${args.scopeId}:${args.key}`, args.value);
      unreadable.delete(args.key);
      unreadable.delete(`${args.scope}:${args.scopeId}:${args.key}`);
      return "id";
    },
  ),
  deleteAppSecret: vi.fn(
    async (ref: { key: string; scope: string; scopeId: string }) =>
      store.delete(`${ref.scope}:${ref.scopeId}:${ref.key}`),
  ),
  deleteAppSecretsIfVersions: vi.fn(
    async (
      expected: readonly {
        ref: { key: string; scope: string; scopeId: string };
        expectedVersion: string;
      }[],
    ) => {
      if (
        expected.some(
          ({ ref, expectedVersion }) =>
            store.get(`${ref.scope}:${ref.scopeId}:${ref.key}`) !==
            expectedVersion,
        )
      ) {
        return false;
      }
      for (const { ref } of expected) {
        store.delete(`${ref.scope}:${ref.scopeId}:${ref.key}`);
      }
      return true;
    },
  ),
}));

vi.mock("../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: async () => roleRef.role,
}));

vi.mock("../server/credential-provider.js", () => ({
  CredentialStoreUnavailableError,
  prefetchSecrets: (keys: readonly string[]) => prefetchSecretsMock(keys),
  resolveSecretDetailed: async (key: string) => {
    if (readErrorRef.error) throw readErrorRef.error;
    resolverActivity.active++;
    resolverActivity.maxActive = Math.max(
      resolverActivity.maxActive,
      resolverActivity.active,
    );
    await Promise.resolve();
    try {
      const refs = [
        { scope: "user", scopeId: OWNER.userEmail },
        { scope: "org", scopeId: ORG },
        { scope: "workspace", scopeId: ORG },
        { scope: "workspace", scopeId: `solo:${OWNER.userEmail}` },
      ];
      for (const ref of refs) {
        const value = store.get(`${ref.scope}:${ref.scopeId}:${key}`);
        if (value === undefined) continue;
        if (isUnreadable({ ...ref, key })) {
          const fromEnv = env.get(key);
          return {
            value: fromEnv ?? null,
            lookupFailed: true,
            cause: new AppSecretDecryptionError(ref),
            ...(fromEnv ? { source: "env" } : {}),
          };
        }
        return {
          value,
          lookupFailed: false,
          source: ref.scope,
          ...ref,
        };
      }
      const vaultError = vaultErrors.get(key);
      if (vaultError) {
        const fromEnv = env.get(key);
        return {
          value: fromEnv ?? null,
          lookupFailed: true,
          cause: new AppSecretDecryptionError(vaultError),
          ...(fromEnv ? { source: "env" } : {}),
        };
      }
      const fromEnv = env.get(key);
      return fromEnv
        ? { value: fromEnv, lookupFailed: false, source: "env" }
        : { value: null, lookupFailed: false };
    } finally {
      resolverActivity.active--;
    }
  },
}));

vi.mock("./config-store.js", () => ({
  getIntegrationConfig: async (platform: string) =>
    configs.has(platform)
      ? { configData: { enabled: configs.get(platform) } }
      : null,
}));

import {
  deleteAppSecretsIfVersions,
  readAppSecret,
} from "../secrets/storage.js";
import {
  confirmMessagingChannelCredentialRemoval,
  listMessagingChannels,
  prepareMessagingChannelCredentialRemoval,
  registerMessagingChannelWebhook,
  removeMessagingChannelCredentials,
  saveMessagingChannelCredentials,
  setMessagingChannelEnabled,
} from "./channel-settings.js";
import {
  setMountedChannels,
  type MountedChannels,
} from "./mounted-channels.js";
import type { PlatformAdapter } from "./types.js";

const ORG = "org-example";
const OWNER = {
  userEmail: "owner@example.com",
  orgId: ORG,
  caller: "frontend" as const,
  requestHeaders: new Headers({
    host: "clips.example.com",
    "x-forwarded-proto": "https",
  }),
};

function fakeAdapter(platform: string, keys: EnvKeyConfig[]): PlatformAdapter {
  const isSet = (key: string) =>
    [...store.keys()].some((storageKey) => storageKey.endsWith(`:${key}`)) ||
    env.has(key);
  return {
    platform,
    label: platform === "telegram" ? "Telegram" : "Google Docs",
    getRequiredEnvKeys: () => keys,
    getStatus: async () => ({
      platform,
      label: platform === "telegram" ? "Telegram" : "Google Docs",
      enabled: false,
      configured: keys
        .filter((item) => item.required)
        .every((item) => isSet(item.key)),
    }),
  } as unknown as PlatformAdapter;
}

const TELEGRAM_KEYS: EnvKeyConfig[] = [
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram Bot Token", required: true },
  {
    key: "TELEGRAM_WEBHOOK_SECRET",
    label: "Telegram Webhook Secret",
    required: true,
  },
];
const GOOGLE_DOCS_KEYS: EnvKeyConfig[] = [
  {
    key: "GOOGLE_SERVICE_ACCOUNT_KEY",
    label: "Google Service Account Key (JSON)",
    required: true,
    deploymentOnly: true,
  },
];
const EMAIL_KEYS: EnvKeyConfig[] = [
  {
    key: "EMAIL_TRANSACTIONAL_API_KEY",
    label: "Email API Key",
    required: true,
  },
];

describe("channel settings", () => {
  let mounted: MountedChannels & {
    setEnabled: ReturnType<typeof vi.fn>;
    registerWebhook: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    store.clear();
    env.clear();
    configs.clear();
    unreadable.clear();
    vaultErrors.clear();
    resolverActivity.active = 0;
    resolverActivity.maxActive = 0;
    prefetchSecretsMock.mockReset().mockResolvedValue(undefined);
    readErrorRef.error = null;
    roleRef.role = "owner";
    mounted = {
      adapters: [
        fakeAdapter("telegram", TELEGRAM_KEYS),
        fakeAdapter("google-docs", GOOGLE_DOCS_KEYS),
      ],
      webhookUrl: (baseUrl, platform) =>
        `${baseUrl}/_agent-native/integrations/${platform}/webhook`,
      setEnabled: vi.fn(async (platform: string, enabled: boolean) => {
        configs.set(platform, enabled);
      }),
      registerWebhook: vi.fn(async (_platform: string, baseUrl: string) => ({
        ok: true as const,
        webhookUrl: `${baseUrl}/_agent-native/integrations/telegram/webhook`,
      })),
    };
    setMountedChannels(mounted);
  });

  afterEach(() => setMountedChannels(null));

  async function confirmedRemovals(
    platform: string,
    selectedKeys?: readonly string[],
  ) {
    const listed = await listMessagingChannels(OWNER);
    const credentials =
      listed.channels.find((item) => item.platform === platform)?.credentials ??
      [];
    const keys = credentials
      .filter(
        (item) =>
          item.removable && (!selectedKeys || selectedKeys.includes(item.key)),
      )
      .map(({ key }) => key);
    const prepared = await prepareMessagingChannelCredentialRemoval(
      OWNER,
      platform,
      keys,
    );
    const confirmed = await confirmMessagingChannelCredentialRemoval(
      OWNER,
      platform,
      prepared.credentials.map(({ key, candidate }) => ({ key, candidate })),
    );
    return confirmed.credentials;
  }

  it("lists each adapter's own keys with where each value comes from", async () => {
    env.set("TELEGRAM_WEBHOOK_SECRET", "fake-env-secret");
    store.set(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`, "fake-bot-token");

    const result = await listMessagingChannels(OWNER);

    expect(result.canManage).toBe(true);
    const telegram = result.channels.find((row) => row.platform === "telegram");
    expect(telegram).toMatchObject({
      state: "off",
      configured: true,
      webhookUrl:
        "https://clips.example.com/_agent-native/integrations/telegram/webhook",
    });
    expect(
      telegram?.credentials.map(({ key, source, removable, saveable }) => ({
        key,
        source,
        removable,
        saveable,
      })),
    ).toEqual([
      {
        key: "TELEGRAM_BOT_TOKEN",
        source: "saved",
        removable: true,
        saveable: true,
      },
      {
        key: "TELEGRAM_WEBHOOK_SECRET",
        source: "environment",
        removable: false,
        saveable: true,
      },
    ]);
    const docs = result.channels.find((row) => row.platform === "google-docs");
    expect(docs?.credentials[0]).toMatchObject({
      saveable: false,
      source: null,
    });
    // No secret value leaves the server.
    expect(JSON.stringify(result)).not.toContain("fake-");
    expect(readAppSecret).not.toHaveBeenCalled();
    expect(resolverActivity.maxActive).toBeGreaterThan(1);
    expect(prefetchSecretsMock).toHaveBeenCalledWith([
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
      "GOOGLE_SERVICE_ACCOUNT_KEY",
    ]);
  });

  it("does not include removal authorizations in the read-only channel listing", async () => {
    store.set(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`, "fake-bot-token");

    const listed = await listMessagingChannels(OWNER);
    const telegram = listed.channels.find((row) => row.platform === "telegram");
    expect(telegram?.credentials[0]?.removable).toBe(true);
    expect(telegram?.credentials[0]).not.toHaveProperty("removalConfirmation");
  });

  it("issues a removal token only after the UI candidate still matches", async () => {
    const ref = `workspace:${ORG}:TELEGRAM_BOT_TOKEN`;
    store.set(ref, "fake-original-bot-token");
    const prepared = await prepareMessagingChannelCredentialRemoval(
      OWNER,
      "telegram",
      ["TELEGRAM_BOT_TOKEN"],
    );
    expect(prepared.credentials).toEqual([
      {
        key: "TELEGRAM_BOT_TOKEN",
        candidate: expect.any(String),
        removalScope: "workspace",
      },
    ]);

    store.set(ref, "fake-rotated-bot-token");
    await expect(
      confirmMessagingChannelCredentialRemoval(
        OWNER,
        "telegram",
        prepared.credentials.map(({ key, candidate }) => ({ key, candidate })),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "channel_removal_confirmation_stale",
    });
  });

  it("shows members the state but not where credentials come from", async () => {
    roleRef.role = "member";
    store.set(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`, "fake-bot-token");
    const result = await listMessagingChannels(OWNER);
    expect(result.canManage).toBe(false);
    const telegram = result.channels.find((row) => row.platform === "telegram");
    expect(telegram?.credentials.every((item) => item.source === null)).toBe(
      true,
    );
  });

  it("saves credentials for the organization without the template declaring them", async () => {
    const result = await saveMessagingChannelCredentials(OWNER, "telegram", {
      TELEGRAM_BOT_TOKEN: " fake-bot-token ",
      TELEGRAM_WEBHOOK_SECRET: "fake-webhook-secret",
    });
    expect(store.get(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(
      "fake-bot-token",
    );
    expect(result.savedKeys).toEqual([
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
    ]);
    expect(result.channel.configured).toBe(true);
  });

  it("replaces a saved credential", async () => {
    store.set(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`, "fake-old-token");
    await saveMessagingChannelCredentials(OWNER, "telegram", {
      TELEGRAM_BOT_TOKEN: "fake-new-token",
    });
    expect(store.get(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(
      "fake-new-token",
    );
  });

  it("marks unreadable credentials unavailable and repairs them by replacement", async () => {
    store.set(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`, "corrupted-ciphertext");
    store.set(`workspace:${ORG}:TELEGRAM_WEBHOOK_SECRET`, "fake-secret");
    unreadable.add("TELEGRAM_BOT_TOKEN");

    const listed = await listMessagingChannels(OWNER);
    const telegram = listed.channels.find((row) => row.platform === "telegram");
    expect(telegram).toMatchObject({
      state: "unavailable",
      configured: false,
      configurationUnavailable: true,
      credentials: [
        { key: "TELEGRAM_BOT_TOKEN", source: "unreadable", removable: true },
        { key: "TELEGRAM_WEBHOOK_SECRET", source: "saved" },
      ],
    });

    const repaired = await saveMessagingChannelCredentials(OWNER, "telegram", {
      TELEGRAM_BOT_TOKEN: "fake-replacement-token",
    });

    expect(store.get(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(
      "fake-replacement-token",
    );
    expect(repaired.channel).toMatchObject({
      state: "off",
      configured: true,
    });
    expect(repaired.channel.configurationUnavailable).toBeUndefined();
  });

  it("keeps a usable environment fallback and exposes the unreadable personal scope for repair", async () => {
    store.set(
      `user:${OWNER.userEmail}:TELEGRAM_BOT_TOKEN`,
      "corrupted-personal-token",
    );
    unreadable.add(`user:${OWNER.userEmail}:TELEGRAM_BOT_TOKEN`);
    env.set("TELEGRAM_BOT_TOKEN", "fake-env-token");
    env.set("TELEGRAM_WEBHOOK_SECRET", "fake-env-webhook-secret");

    const listed = await listMessagingChannels(OWNER);
    const telegram = listed.channels.find((row) => row.platform === "telegram");
    expect(telegram).toMatchObject({
      state: "off",
      configured: true,
    });
    expect(telegram?.credentials[0]).toMatchObject({
      key: "TELEGRAM_BOT_TOKEN",
      source: "environment",
      unreadableScope: "user",
      repairScope: "user",
      removable: true,
    });
    expect(telegram).not.toHaveProperty("configurationUnavailable");

    await saveMessagingChannelCredentials(OWNER, "telegram", {
      TELEGRAM_BOT_TOKEN: "fake-replacement-token",
    });

    expect(store.get(`user:${OWNER.userEmail}:TELEGRAM_BOT_TOKEN`)).toBe(
      "fake-replacement-token",
    );
    expect(store.has(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(false);
  });

  it("repairs only the caller's unreadable personal credential and keeps it personal", async () => {
    const personalRef = `user:${OWNER.userEmail}:TELEGRAM_BOT_TOKEN`;
    store.set(personalRef, "corrupted-personal-token");
    unreadable.add(personalRef);
    store.set(
      `workspace:${ORG}:TELEGRAM_WEBHOOK_SECRET`,
      "fake-webhook-secret",
    );

    const listed = await listMessagingChannels(OWNER);
    const telegram = listed.channels.find((row) => row.platform === "telegram");
    expect(telegram?.credentials[0]).toMatchObject({
      source: "unreadable",
      unreadableScope: "user",
      repairScope: "user",
    });

    const repaired = await saveMessagingChannelCredentials(OWNER, "telegram", {
      TELEGRAM_BOT_TOKEN: "fake-personal-replacement-token",
    });

    expect(store.get(personalRef)).toBe("fake-personal-replacement-token");
    expect(store.has(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(false);
    expect(repaired.channel).toMatchObject({
      state: "off",
      configured: true,
    });
  });

  it("replaces an unreadable organization credential at its exact scope", async () => {
    store.set(`org:${ORG}:TELEGRAM_BOT_TOKEN`, "corrupted-org-token");
    unreadable.add(`org:${ORG}:TELEGRAM_BOT_TOKEN`);

    const listed = await listMessagingChannels(OWNER);
    const telegram = listed.channels.find((row) => row.platform === "telegram");
    expect(telegram?.credentials[0]).toMatchObject({
      source: "unreadable",
      unreadableScope: "org",
      removable: true,
    });

    await saveMessagingChannelCredentials(OWNER, "telegram", {
      TELEGRAM_BOT_TOKEN: "fake-org-replacement-token",
    });

    expect(store.get(`org:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(
      "fake-org-replacement-token",
    );
    expect(store.has(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(false);
  });

  it("does not write an unreadable email credential into an ineffective workspace scope", async () => {
    const key = "EMAIL_TRANSACTIONAL_API_KEY";
    mounted.adapters.push(fakeAdapter("email", EMAIL_KEYS));
    setMountedChannels(mounted);
    vaultErrors.set(key, { scope: "org", scopeId: ORG });

    await expect(
      saveMessagingChannelCredentials(OWNER, "email", {
        [key]: "fake-email-token",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "credential_repair_unavailable",
      message:
        "This saved credential cannot be repaired from Channels. Replace it in the settings that own its scope.",
    });
    expect(store.has(`workspace:${ORG}:${key}`)).toBe(false);
  });

  it("replaces an unreadable pre-org solo credential at its exact scope", async () => {
    const soloRef = `workspace:solo:${OWNER.userEmail}:TELEGRAM_BOT_TOKEN`;
    store.set(soloRef, "corrupted-solo-token");
    unreadable.add(soloRef);

    const listed = await listMessagingChannels(OWNER);
    const telegram = listed.channels.find((row) => row.platform === "telegram");
    expect(telegram?.credentials[0]).toMatchObject({
      source: "unreadable",
      unreadableScope: "workspace",
      removable: true,
    });

    await saveMessagingChannelCredentials(OWNER, "telegram", {
      TELEGRAM_BOT_TOKEN: "fake-solo-replacement-token",
    });

    expect(store.get(soloRef)).toBe("fake-solo-replacement-token");
    expect(store.has(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(false);
  });

  it.each(["org", "workspace"] as const)(
    "repairs an unreadable designated-vault %s credential with a usable workspace override",
    async (scope) => {
      vaultErrors.set("TELEGRAM_BOT_TOKEN", {
        scope,
        scopeId: "designated-vault",
      });
      env.set("TELEGRAM_WEBHOOK_SECRET", "fake-env-webhook-secret");

      const listed = await listMessagingChannels(OWNER);
      const telegram = listed.channels.find(
        (row) => row.platform === "telegram",
      );
      expect(telegram?.credentials[0]).toMatchObject({
        source: "unreadable",
        unreadableScope: scope,
        repairScope: "workspace",
        removable: false,
      });
      expect(JSON.stringify(telegram)).not.toContain("designated-vault");

      const repaired = await saveMessagingChannelCredentials(
        OWNER,
        "telegram",
        { TELEGRAM_BOT_TOKEN: "fake-vault-replacement-token" },
      );

      expect(store.get(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(
        "fake-vault-replacement-token",
      );
      expect(repaired.channel).toMatchObject({
        state: "off",
        configured: true,
      });
      expect(repaired.channel.configurationUnavailable).toBeUndefined();

      const enabled = await setMessagingChannelEnabled(OWNER, "telegram", true);
      expect(enabled.channel.state).toBe("on");
      expect(mounted.setEnabled).toHaveBeenCalledWith(
        "telegram",
        true,
        expect.objectContaining({ actorEmail: OWNER.userEmail }),
      );
    },
  );

  it("propagates channel credential query failures instead of reporting unreadable values", async () => {
    const error = new Error("database unavailable");
    readErrorRef.error = error;

    await expect(listMessagingChannels(OWNER)).rejects.toBe(error);
  });

  it("saves to the solo workspace without an organization", async () => {
    await saveMessagingChannelCredentials(
      { ...OWNER, orgId: null },
      "telegram",
      { TELEGRAM_BOT_TOKEN: "fake-bot-token" },
    );
    expect(
      store.get("workspace:solo:owner@example.com:TELEGRAM_BOT_TOKEN"),
    ).toBe("fake-bot-token");
  });

  it("refuses members, unknown keys, and deployment-only keys", async () => {
    await expect(
      saveMessagingChannelCredentials(OWNER, "telegram", {
        SLACK_BOT_TOKEN: "fake-token",
      }),
    ).rejects.toMatchObject({ errorCode: "invalid_channel_credentials" });
    await expect(
      saveMessagingChannelCredentials(OWNER, "google-docs", {
        GOOGLE_SERVICE_ACCOUNT_KEY: "{}",
      }),
    ).rejects.toMatchObject({ errorCode: "deployment_only_credential" });
    await expect(
      saveMessagingChannelCredentials(OWNER, "telegram", {
        TELEGRAM_BOT_TOKEN: "   ",
      }),
    ).rejects.toMatchObject({ errorCode: "invalid_channel_credentials" });

    roleRef.role = "member";
    await expect(
      saveMessagingChannelCredentials(OWNER, "telegram", {
        TELEGRAM_BOT_TOKEN: "fake-token",
      }),
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "forbidden" });
    await expect(
      setMessagingChannelEnabled(OWNER, "telegram", false),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      removeMessagingChannelCredentials(OWNER, "telegram", []),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      prepareMessagingChannelCredentialRemoval(OWNER, "telegram", [
        "TELEGRAM_BOT_TOKEN",
      ]),
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "forbidden" });
    expect(store.size).toBe(0);
    expect(mounted.setEnabled).not.toHaveBeenCalled();
  });

  it("removes only the credentials saved from Channels", async () => {
    store.set(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`, "fake-bot-token");
    env.set("TELEGRAM_WEBHOOK_SECRET", "fake-env-secret");

    const confirmed = await confirmedRemovals("telegram");
    const result = await removeMessagingChannelCredentials(
      OWNER,
      "telegram",
      confirmed,
    );

    expect(result.removedKeys).toEqual(["TELEGRAM_BOT_TOKEN"]);
    expect(store.has(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(false);
    expect(env.get("TELEGRAM_WEBHOOK_SECRET")).toBe("fake-env-secret");
    expect(result.channel.state).toBe("not-set-up");
  });

  it("removes only the credential refs the caller confirmed", async () => {
    store.set(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`, "fake-bot-token");
    store.set(
      `workspace:${ORG}:TELEGRAM_WEBHOOK_SECRET`,
      "fake-webhook-secret",
    );
    const confirmed = await confirmedRemovals("telegram", [
      "TELEGRAM_BOT_TOKEN",
    ]);

    const result = await removeMessagingChannelCredentials(
      OWNER,
      "telegram",
      confirmed,
    );

    expect(result.removedKeys).toEqual(["TELEGRAM_BOT_TOKEN"]);
    expect(store.has(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(false);
    expect(store.get(`workspace:${ORG}:TELEGRAM_WEBHOOK_SECRET`)).toBe(
      "fake-webhook-secret",
    );
  });

  it("rejects a stale removal confirmation when the unreadable scope changes", async () => {
    const userRef = `user:${OWNER.userEmail}:TELEGRAM_BOT_TOKEN`;
    const orgRef = `org:${ORG}:TELEGRAM_BOT_TOKEN`;
    store.set(userRef, "corrupted-user-token");
    store.set(orgRef, "corrupted-org-token");
    unreadable.add(userRef);
    unreadable.add(orgRef);
    const confirmed = await confirmedRemovals("telegram", [
      "TELEGRAM_BOT_TOKEN",
    ]);

    store.delete(userRef);
    await expect(
      removeMessagingChannelCredentials(OWNER, "telegram", confirmed),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "channel_removal_confirmation_stale",
    });
    expect(store.get(orgRef)).toBe("corrupted-org-token");
  });

  it("rejects a stale removal confirmation after the credential is rotated", async () => {
    const ref = `workspace:${ORG}:TELEGRAM_BOT_TOKEN`;
    store.set(ref, "fake-original-bot-token");
    const confirmed = await confirmedRemovals("telegram", [
      "TELEGRAM_BOT_TOKEN",
    ]);

    store.set(ref, "fake-rotated-bot-token");
    await expect(
      removeMessagingChannelCredentials(OWNER, "telegram", confirmed),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "channel_removal_confirmation_stale",
    });
    expect(store.get(ref)).toBe("fake-rotated-bot-token");
  });

  it("keeps the whole credential set when an atomic removal detects a concurrent rotation", async () => {
    const botToken = `workspace:${ORG}:TELEGRAM_BOT_TOKEN`;
    const webhookSecret = `workspace:${ORG}:TELEGRAM_WEBHOOK_SECRET`;
    store.set(botToken, "fake-bot-token");
    store.set(webhookSecret, "fake-webhook-secret");
    const confirmed = await confirmedRemovals("telegram");
    vi.mocked(deleteAppSecretsIfVersions).mockResolvedValueOnce(false);

    await expect(
      removeMessagingChannelCredentials(OWNER, "telegram", confirmed),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "channel_removal_confirmation_stale",
    });
    expect(store.get(botToken)).toBe("fake-bot-token");
    expect(store.get(webhookSecret)).toBe("fake-webhook-secret");
  });

  it("removes known channel credentials when one saved value is unreadable", async () => {
    store.set(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`, "corrupted-ciphertext");
    store.set(`workspace:${ORG}:TELEGRAM_WEBHOOK_SECRET`, "fake-secret");
    unreadable.add("TELEGRAM_BOT_TOKEN");

    const confirmed = await confirmedRemovals("telegram");
    const result = await removeMessagingChannelCredentials(
      OWNER,
      "telegram",
      confirmed,
    );

    expect(result.removedKeys).toEqual([
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
    ]);
    expect(store.has(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(false);
    expect(store.has(`workspace:${ORG}:TELEGRAM_WEBHOOK_SECRET`)).toBe(false);
    expect(result.channel.state).toBe("not-set-up");
  });

  it("removes exact unreadable org credentials and preserves readable or foreign scopes", async () => {
    store.set(`user:${OWNER.userEmail}:TELEGRAM_BOT_TOKEN`, "fake-user-token");
    store.set(`org:${ORG}:TELEGRAM_WEBHOOK_SECRET`, "corrupted-org-secret");
    store.set("org:foreign-org:TELEGRAM_WEBHOOK_SECRET", "fake-foreign-secret");
    unreadable.add(`org:${ORG}:TELEGRAM_WEBHOOK_SECRET`);

    const confirmed = await confirmedRemovals("telegram");
    const result = await removeMessagingChannelCredentials(
      OWNER,
      "telegram",
      confirmed,
    );

    expect(result.removedKeys).toEqual(["TELEGRAM_WEBHOOK_SECRET"]);
    expect(store.get(`user:${OWNER.userEmail}:TELEGRAM_BOT_TOKEN`)).toBe(
      "fake-user-token",
    );
    expect(store.has(`org:${ORG}:TELEGRAM_WEBHOOK_SECRET`)).toBe(false);
    expect(store.get("org:foreign-org:TELEGRAM_WEBHOOK_SECRET")).toBe(
      "fake-foreign-secret",
    );
  });

  it("removes an unreadable pre-org solo credential for an org manager", async () => {
    const soloRef = `workspace:solo:${OWNER.userEmail}:TELEGRAM_BOT_TOKEN`;
    store.set(soloRef, "corrupted-solo-token");
    unreadable.add(soloRef);

    const confirmed = await confirmedRemovals("telegram");
    const result = await removeMessagingChannelCredentials(
      OWNER,
      "telegram",
      confirmed,
    );

    expect(result.removedKeys).toEqual(["TELEGRAM_BOT_TOKEN"]);
    expect(store.has(soloRef)).toBe(false);
    expect(store.has(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(false);
  });

  it("preflights store failures before writing or deleting any credential", async () => {
    store.set(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`, "fake-existing-token");
    const confirmed = await confirmedRemovals("telegram");
    const error = new Error("database unavailable");
    readErrorRef.error = error;

    await expect(
      saveMessagingChannelCredentials(OWNER, "telegram", {
        TELEGRAM_BOT_TOKEN: "fake-new-token",
      }),
    ).rejects.toBe(error);
    expect(store.get(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(
      "fake-existing-token",
    );
    await expect(
      removeMessagingChannelCredentials(OWNER, "telegram", confirmed),
    ).rejects.toBe(error);
    expect(store.get(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(
      "fake-existing-token",
    );
  });

  it("turns a set-up channel on as the caller, and refuses one that isn't set up", async () => {
    await expect(
      setMessagingChannelEnabled(OWNER, "telegram", true),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "channel_not_configured",
      details: {
        missing: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"],
      },
    });
    expect(mounted.setEnabled).not.toHaveBeenCalled();

    store.set(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`, "fake-bot-token");
    store.set(`workspace:${ORG}:TELEGRAM_WEBHOOK_SECRET`, "fake-secret");
    const result = await setMessagingChannelEnabled(OWNER, "telegram", true);

    expect(mounted.setEnabled).toHaveBeenCalledWith("telegram", true, {
      actorEmail: "owner@example.com",
      baseUrl: "https://clips.example.com",
    });
    expect(result.channel.state).toBe("on");
  });

  it("registers the webhook at the app's public URL and reports provider failures", async () => {
    const result = await registerMessagingChannelWebhook(OWNER, "telegram");
    expect(mounted.registerWebhook).toHaveBeenCalledWith(
      "telegram",
      "https://clips.example.com",
    );
    expect(result.webhookUrl).toBe(
      "https://clips.example.com/_agent-native/integrations/telegram/webhook",
    );

    mounted.registerWebhook.mockResolvedValueOnce({
      ok: false,
      statusCode: 502,
      error: "Telegram setWebhook failed: Unauthorized",
    });
    await expect(
      registerMessagingChannelWebhook(OWNER, "telegram"),
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "Telegram setWebhook failed: Unauthorized",
    });
  });

  it("fails loudly for a channel the app doesn't mount", async () => {
    await expect(
      setMessagingChannelEnabled(OWNER, "slack", true),
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "channel_not_found",
    });

    setMountedChannels(null);
    expect(await listMessagingChannels(OWNER)).toEqual({
      canManage: true,
      channels: [],
    });
    await expect(
      setMessagingChannelEnabled(OWNER, "telegram", true),
    ).rejects.toMatchObject({ errorCode: "channels_not_mounted" });
  });
});
