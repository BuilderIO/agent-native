import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvKeyConfig } from "../server/create-server.js";

const store = vi.hoisted(() => new Map<string, string>());
const env = vi.hoisted(() => new Map<string, string>());
const configs = vi.hoisted(() => new Map<string, boolean>());
const roleRef = vi.hoisted(() => ({ role: "owner" as string | null }));

vi.mock("../secrets/storage.js", () => ({
  readAppSecrets: vi.fn(
    async (args: { keys: string[]; scope: string; scopeId: string }) => {
      const out = new Map<string, { value: string }>();
      for (const key of args.keys) {
        const value = store.get(`${args.scope}:${args.scopeId}:${key}`);
        if (value !== undefined) out.set(key, { value });
      }
      return out;
    },
  ),
  writeAppSecret: vi.fn(
    async (args: {
      key: string;
      value: string;
      scope: string;
      scopeId: string;
    }) => {
      store.set(`${args.scope}:${args.scopeId}:${args.key}`, args.value);
      return "id";
    },
  ),
  deleteAppSecret: vi.fn(
    async (ref: { key: string; scope: string; scopeId: string }) =>
      store.delete(`${ref.scope}:${ref.scopeId}:${ref.key}`),
  ),
}));

vi.mock("../server/personal-provider-key-policy.js", () => ({
  readOrgMemberRole: async () => roleRef.role,
}));

vi.mock("../server/credential-provider.js", () => ({
  resolveSecretDetailed: async (key: string) => {
    const workspace = store.get(`workspace:${ORG}:${key}`);
    if (workspace) {
      return {
        value: workspace,
        lookupFailed: false,
        source: "workspace",
        scopeId: ORG,
      };
    }
    const fromEnv = env.get(key);
    return fromEnv
      ? { value: fromEnv, lookupFailed: false, source: "env" }
      : { value: null, lookupFailed: false };
  },
}));

vi.mock("./config-store.js", () => ({
  getIntegrationConfig: async (platform: string) =>
    configs.has(platform)
      ? { configData: { enabled: configs.get(platform) } }
      : null,
}));

import {
  listMessagingChannels,
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
    store.has(`workspace:${ORG}:${key}`) || env.has(key);
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

describe("channel settings", () => {
  let mounted: MountedChannels & {
    setEnabled: ReturnType<typeof vi.fn>;
    registerWebhook: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    store.clear();
    env.clear();
    configs.clear();
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
      removeMessagingChannelCredentials(OWNER, "telegram"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(store.size).toBe(0);
    expect(mounted.setEnabled).not.toHaveBeenCalled();
  });

  it("removes only the credentials saved from Channels", async () => {
    store.set(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`, "fake-bot-token");
    env.set("TELEGRAM_WEBHOOK_SECRET", "fake-env-secret");

    const result = await removeMessagingChannelCredentials(OWNER, "telegram");

    expect(result.removedKeys).toEqual(["TELEGRAM_BOT_TOKEN"]);
    expect(store.has(`workspace:${ORG}:TELEGRAM_BOT_TOKEN`)).toBe(false);
    expect(env.get("TELEGRAM_WEBHOOK_SECRET")).toBe("fake-env-secret");
    expect(result.channel.state).toBe("not-set-up");
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
