import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedSecretDetail } from "./credential-provider.js";

const mocks = vi.hoisted(() => ({
  rows: new Map<string, ResolvedSecretDetail>(),
  env: new Map<string, string>(),
  resolveSecret: vi.fn(),
}));

vi.mock("./credential-provider.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./credential-provider.js")>();
  return {
    assertCredentialStoreReadable: actual.assertCredentialStoreReadable,
    CredentialStoreUnavailableError: actual.CredentialStoreUnavailableError,
    readDeployCredentialEnv: (key: string) => mocks.env.get(key),
    resolveSecret: mocks.resolveSecret,
    resolveSecretDetailed: vi.fn(
      async (key: string, options?: { skipUserScope?: boolean }) => {
        const row = mocks.rows.get(key);
        if (!row || (options?.skipUserScope && row.source === "user")) {
          return { value: null, lookupFailed: false };
        }
        return row;
      },
    ),
  };
});

const {
  GEMINI_API_KEY,
  LEGACY_GEMINI_API_KEY,
  canonicalSecretKey,
  readGeminiDeployCredentialEnv,
  resolveGeminiApiKey,
  resolveGeminiApiKeyDetailed,
  resolveSecretWithAliases,
  secretKeyNames,
} = await import("./secret-key-aliases.js");
const { CredentialStoreUnavailableError } =
  await import("./credential-provider.js");

function row(
  value: string,
  source: ResolvedSecretDetail["source"],
  scopeId?: string,
): ResolvedSecretDetail {
  return { value, lookupFailed: false, source, scopeId };
}

describe("Gemini key aliases", () => {
  beforeEach(() => {
    mocks.rows.clear();
    mocks.env.clear();
    mocks.resolveSecret.mockReset();
  });

  it("names the chat key as the one Gemini key", () => {
    expect(GEMINI_API_KEY).toBe("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(secretKeyNames(LEGACY_GEMINI_API_KEY)).toEqual([
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "GEMINI_API_KEY",
    ]);
    expect(canonicalSecretKey("GEMINI_API_KEY")).toBe(
      "GOOGLE_GENERATIVE_AI_API_KEY",
    );
    expect(secretKeyNames("OPENAI_API_KEY")).toEqual(["OPENAI_API_KEY"]);
  });

  it("reads a key saved under the chat name", async () => {
    mocks.rows.set(GEMINI_API_KEY, row("chat-key", "user", "a@example.com"));

    await expect(resolveGeminiApiKey()).resolves.toBe("chat-key");
    await expect(resolveGeminiApiKeyDetailed()).resolves.toMatchObject({
      value: "chat-key",
      key: GEMINI_API_KEY,
      source: "user",
    });
  });

  it("reads a key saved under the older service name", async () => {
    mocks.rows.set(LEGACY_GEMINI_API_KEY, row("service-key", "org", "org-1"));

    await expect(resolveGeminiApiKey()).resolves.toBe("service-key");
    await expect(resolveGeminiApiKeyDetailed()).resolves.toMatchObject({
      key: LEGACY_GEMINI_API_KEY,
      source: "org",
    });
  });

  it("prefers the chat name when both are saved at the same scope", async () => {
    mocks.rows.set(GEMINI_API_KEY, row("chat-key", "user", "a@example.com"));
    mocks.rows.set(
      LEGACY_GEMINI_API_KEY,
      row("service-key", "user", "a@example.com"),
    );

    await expect(resolveGeminiApiKey()).resolves.toBe("chat-key");
  });

  it("keeps scope precedence ahead of the name", async () => {
    mocks.rows.set(GEMINI_API_KEY, row("org-key", "org", "org-1"));
    mocks.rows.set(
      LEGACY_GEMINI_API_KEY,
      row("personal-key", "user", "a@example.com"),
    );
    await expect(resolveGeminiApiKey()).resolves.toBe("personal-key");

    mocks.rows.set(GEMINI_API_KEY, row("env-key", "env"));
    mocks.rows.set(
      LEGACY_GEMINI_API_KEY,
      row("solo-key", "workspace", "solo:a@example.com"),
    );
    await expect(resolveGeminiApiKey()).resolves.toBe("solo-key");

    mocks.rows.set(
      GEMINI_API_KEY,
      row("solo-chat-key", "workspace", "solo:a@example.com"),
    );
    mocks.rows.set(
      LEGACY_GEMINI_API_KEY,
      row("workspace-key", "workspace", "org-1"),
    );
    await expect(resolveGeminiApiKey()).resolves.toBe("workspace-key");
  });

  it("passes skipUserScope to both names for the shared-fallback check", async () => {
    mocks.rows.set(
      GEMINI_API_KEY,
      row("personal-key", "user", "a@example.com"),
    );
    mocks.rows.set(LEGACY_GEMINI_API_KEY, row("org-key", "org", "org-1"));

    await expect(
      resolveGeminiApiKeyDetailed({ skipUserScope: true }),
    ).resolves.toMatchObject({ value: "org-key", key: LEGACY_GEMINI_API_KEY });
  });

  it("reports absent and unreadable as different answers", async () => {
    await expect(resolveGeminiApiKey()).resolves.toBeNull();
    await expect(resolveGeminiApiKeyDetailed()).resolves.toEqual({
      value: null,
      lookupFailed: false,
    });

    const cause = Object.assign(new Error("connection terminated"), {
      code: "57P01",
    });
    mocks.rows.set(GEMINI_API_KEY, {
      value: null,
      lookupFailed: true,
      cause,
    });
    await expect(resolveGeminiApiKeyDetailed()).resolves.toMatchObject({
      value: null,
      lookupFailed: true,
      cause,
    });
    await expect(resolveGeminiApiKey()).rejects.toBeInstanceOf(
      CredentialStoreUnavailableError,
    );
  });

  it("passes a key without aliases straight to resolveSecret", async () => {
    mocks.resolveSecret.mockResolvedValue("sk-openai");

    await expect(resolveSecretWithAliases("OPENAI_API_KEY")).resolves.toBe(
      "sk-openai",
    );
    expect(mocks.resolveSecret).toHaveBeenCalledWith("OPENAI_API_KEY");
  });

  it("reads either name from the deploy environment, chat name first", () => {
    expect(readGeminiDeployCredentialEnv()).toBeUndefined();
    mocks.env.set(LEGACY_GEMINI_API_KEY, "env-service-key");
    expect(readGeminiDeployCredentialEnv()).toBe("env-service-key");
    mocks.env.set(GEMINI_API_KEY, "env-chat-key");
    expect(readGeminiDeployCredentialEnv()).toBe("env-chat-key");
  });
});
