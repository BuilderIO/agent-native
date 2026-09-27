import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: new Map<string, Record<string, unknown>>(),
  failReads: false,
}));

vi.mock("../settings/store.js", () => ({
  getSetting: async (key: string) => {
    if (mocks.failReads) throw new Error("settings store unavailable");
    return mocks.settings.get(key) ?? null;
  },
  mutateSetting: async (
    key: string,
    update: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ) => {
    const next = await update(mocks.settings.get(key) ?? null);
    mocks.settings.set(key, next);
    return next;
  },
}));

const {
  readServiceProviderChoice,
  readServiceProviderSettings,
  serviceProviderOrder,
  writeServiceProviderChoice,
} = await import("./service-providers.js");
const { runWithRequestContext } = await import("./request-context.js");

beforeEach(() => {
  mocks.settings.clear();
  mocks.failReads = false;
});

describe("serviceProviderOrder", () => {
  it("keeps each service's default order when unset", () => {
    expect(serviceProviderOrder("voice")).toEqual([
      "builder",
      "gemini",
      "groq",
      "openai",
    ]);
    expect(serviceProviderOrder("images")).toEqual([
      "builder",
      "gemini",
      "openai",
    ]);
    expect(serviceProviderOrder("embeddings")).toEqual([
      "builder",
      "gemini",
      "cohere",
      "voyage",
    ]);
  });

  it("moves the choice to the front and keeps the rest in order", () => {
    expect(serviceProviderOrder("voice", "groq")).toEqual([
      "groq",
      "builder",
      "gemini",
      "openai",
    ]);
    expect(serviceProviderOrder("images", "builder")).toEqual([
      "builder",
      "gemini",
      "openai",
    ]);
  });
});

describe("service provider settings", () => {
  it("writes one service without touching the others", async () => {
    await writeServiceProviderChoice("org-1", {
      service: "voice",
      provider: "groq",
      updatedBy: "admin@example.com",
    });
    const result = await writeServiceProviderChoice("org-1", {
      service: "embeddings",
      provider: "gemini",
      updatedBy: "admin@example.com",
    });
    expect(result).toMatchObject({ previous: null, changed: true });
    expect(result.settings.choices).toEqual({
      voice: "groq",
      embeddings: "gemini",
    });
    expect(mocks.settings.get("o:org-1:service-providers")).toMatchObject({
      voice: "groq",
      embeddings: "gemini",
      updatedBy: "admin@example.com",
    });

    const again = await writeServiceProviderChoice("org-1", {
      service: "voice",
      provider: "groq",
      updatedBy: "admin@example.com",
    });
    expect(again).toMatchObject({ previous: "groq", changed: false });

    const cleared = await writeServiceProviderChoice("org-1", {
      service: "voice",
      provider: null,
      updatedBy: "admin@example.com",
    });
    expect(cleared.changed).toBe(true);
    expect(cleared.settings.choices).toEqual({ embeddings: "gemini" });
  });

  it("refuses a provider the service can't use", async () => {
    await expect(
      writeServiceProviderChoice("org-1", {
        service: "images",
        provider: "groq" as never,
        updatedBy: "admin@example.com",
      }),
    ).rejects.toThrow(/can't power images/);
    expect(mocks.settings.size).toBe(0);
  });

  it("drops stored values this version doesn't offer", async () => {
    mocks.settings.set("o:org-1:service-providers", {
      voice: "whisper-local",
      images: "openai",
    });
    await expect(readServiceProviderSettings("org-1")).resolves.toMatchObject({
      choices: { images: "openai" },
    });
  });

  it("reads the request's organization, and nothing outside one", async () => {
    mocks.settings.set("o:org-1:service-providers", { voice: "openai" });
    await expect(
      runWithRequestContext(
        { userEmail: "a@example.com", orgId: "org-1" },
        () => readServiceProviderChoice("voice"),
      ),
    ).resolves.toBe("openai");
    await expect(
      readServiceProviderChoice("voice", { orgId: null }),
    ).resolves.toBeNull();
    await expect(
      readServiceProviderChoice("images", { orgId: "org-1" }),
    ).resolves.toBeNull();
  });

  it("throws when the setting can't be read instead of reporting unset", async () => {
    mocks.failReads = true;
    await expect(
      readServiceProviderChoice("voice", { orgId: "org-1" }),
    ).rejects.toThrow("settings store unavailable");
  });
});
