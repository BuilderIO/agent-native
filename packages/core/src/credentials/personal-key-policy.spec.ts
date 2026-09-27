import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppSecret: vi.fn(),
  isRestricted: vi.fn(),
  settings: new Map<string, { value: unknown }>(),
}));

vi.mock("../secrets/storage.js", () => ({
  readAppSecret: mocks.readAppSecret,
}));
vi.mock("../settings/store.js", () => ({
  getSetting: async (key: string) => mocks.settings.get(key) ?? null,
  putSetting: vi.fn(),
  deleteSetting: vi.fn(),
}));
vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: async () => "org-1",
}));
vi.mock(
  "../server/personal-provider-key-policy.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/personal-provider-key-policy.js")
    >()),
    isPersonalProviderKeyUseRestricted: mocks.isRestricted,
  }),
);

import { resolveCredential } from "./index.js";

const EMAIL = "member@example.com";

function rows(values: Record<string, string>) {
  mocks.readAppSecret.mockImplementation(
    async ({ key, scope, scopeId }: any) => {
      const value = values[`${scope}:${scopeId}:${key}`];
      return value ? { value } : null;
    },
  );
}

beforeEach(() => {
  mocks.readAppSecret.mockReset();
  mocks.settings.clear();
  mocks.isRestricted.mockReset();
  mocks.isRestricted.mockResolvedValue(false);
});

describe("resolveCredential with personal API keys restricted", () => {
  it("skips a restricted member's personal provider key for the org's", async () => {
    mocks.isRestricted.mockResolvedValue(true);
    rows({
      [`user:${EMAIL}:ANTHROPIC_API_KEY`]: "sk-ant-personal",
      [`workspace:solo:${EMAIL}:ANTHROPIC_API_KEY`]: "sk-ant-solo",
      "org:org-1:ANTHROPIC_API_KEY": "sk-ant-org",
    });

    await expect(
      resolveCredential("ANTHROPIC_API_KEY", {
        userEmail: EMAIL,
        orgId: "org-1",
      }),
    ).resolves.toBe("sk-ant-org");
    expect(mocks.isRestricted).toHaveBeenCalledWith({
      email: EMAIL,
      orgId: "org-1",
    });
    expect(
      mocks.readAppSecret.mock.calls.some(([ref]) => ref.scope === "user"),
    ).toBe(false);
  });

  it("returns nothing rather than the member's own or pre-org key", async () => {
    mocks.isRestricted.mockResolvedValue(true);
    mocks.settings.set(`u:${EMAIL}:credential:OPENAI_API_KEY`, {
      value: "sk-legacy-personal",
    });
    rows({ [`workspace:solo:${EMAIL}:OPENAI_API_KEY`]: "sk-solo" });

    await expect(
      resolveCredential("OPENAI_API_KEY", { userEmail: EMAIL }),
    ).resolves.toBeUndefined();
    expect(mocks.isRestricted).toHaveBeenCalledWith({ email: EMAIL });
  });

  it("leaves other credentials and unrestricted callers alone", async () => {
    mocks.isRestricted.mockResolvedValue(true);
    rows({ [`user:${EMAIL}:NOTION_TOKEN`]: "notion-personal" });
    await expect(
      resolveCredential("NOTION_TOKEN", { userEmail: EMAIL }),
    ).resolves.toBe("notion-personal");
    expect(mocks.isRestricted).not.toHaveBeenCalled();

    mocks.isRestricted.mockResolvedValue(false);
    rows({ [`user:${EMAIL}:ANTHROPIC_API_KEY`]: "sk-ant-personal" });
    await expect(
      resolveCredential("ANTHROPIC_API_KEY", { userEmail: EMAIL }),
    ).resolves.toBe("sk-ant-personal");
  });

  it("fails loudly when the restriction can't be read", async () => {
    mocks.isRestricted.mockRejectedValue(new Error("settings unavailable"));
    rows({ [`user:${EMAIL}:ANTHROPIC_API_KEY`]: "sk-ant-personal" });
    await expect(
      resolveCredential("ANTHROPIC_API_KEY", { userEmail: EMAIL }),
    ).rejects.toThrow("settings unavailable");
  });
});
