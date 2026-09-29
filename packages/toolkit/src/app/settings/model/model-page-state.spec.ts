import { describe, expect, it } from "vitest";

import {
  addableProviders,
  addDialogChoices,
  defaultModelGroups,
  defaultModelValue,
  hostOf,
  keyDetailParts,
  parseDefaultModelValue,
  providerRows,
  replaceableKey,
  type ModelProvidersListing,
  type ProviderModelsRead,
} from "./model-page-state.js";

function listing(
  overrides: Partial<ModelProvidersListing> = {},
): ModelProvidersListing {
  return {
    providers: [
      {
        provider: "anthropic",
        label: "Anthropic",
        org: { scope: "org", masked: "••••aaaa", updatedAt: 1 },
        personal: null,
      },
      {
        provider: "groq",
        label: "Groq",
        org: null,
        personal: { scope: "user", masked: "••••bbbb", updatedAt: 1 },
      },
      {
        provider: "openai",
        label: "OpenAI",
        org: {
          scope: "org",
          masked: "••••cccc",
          updatedAt: 1,
          rejectedAt: 5,
        },
        personal: null,
      },
      {
        provider: "mistral",
        label: "Mistral",
        org: null,
        personal: null,
      },
    ],
    hasOrganization: true,
    canManageOrg: true,
    personalKeysRestricted: false,
    defaultModel: null,
    defaultModelSource: "none",
    canUpdateDefault: true,
    ...overrides,
  };
}

const models: ProviderModelsRead = {
  providers: [
    {
      provider: "builder",
      recommendedModels: ["auto", "gpt-5.6-luna"],
      rows: { org: { models: ["gpt-5.6-luna"] } },
    },
    {
      provider: "anthropic",
      recommendedModels: ["claude-sonnet-5", "claude-haiku-4-5"],
      rows: { org: { models: null }, user: { models: null } },
    },
    {
      provider: "groq",
      recommendedModels: ["llama-3.3-70b"],
      rows: { user: { models: [] } },
    },
    {
      provider: "openai",
      recommendedModels: ["gpt-a"],
      rows: {},
    },
  ],
};

describe("model page state", () => {
  it("splits keys into organization and personal rows with their model counts", () => {
    const rows = providerRows(listing(), models);
    expect(rows.org.map((row) => [row.provider, row.modelCount])).toEqual([
      ["anthropic", 2],
      ["openai", 1],
    ]);
    expect(rows.personal.map((row) => [row.provider, row.modelCount])).toEqual([
      ["groq", 0],
    ]);
    expect(providerRows(listing(), undefined).org[0].modelCount).toBeNull();
  });

  it("marks personal rows restricted while the policy applies", () => {
    const rows = providerRows(
      listing({ personalKeysRestricted: true }),
      models,
    );
    expect(rows.personal.every((row) => row.restricted)).toBe(true);
    expect(rows.org.every((row) => !row.restricted)).toBe(true);
  });

  it("offers admins providers with no key at either scope", () => {
    expect(addableProviders(listing())).toEqual(["mistral"]);
  });

  it("offers members providers without a personal key, next to the organization's", () => {
    expect(addableProviders(listing({ canManageOrg: false }))).toEqual([
      "anthropic",
      "openai",
      "mistral",
    ]);
  });

  it("offers nothing to add while personal keys are restricted", () => {
    expect(
      addableProviders(
        listing({ canManageOrg: false, personalKeysRestricted: true }),
      ),
    ).toEqual([]);
  });

  it("offers admins a rejected organization key to replace next to new providers", () => {
    expect(addDialogChoices(listing())).toEqual([
      {
        provider: "openai",
        replaces: {
          scope: "org",
          masked: "••••cccc",
          updatedAt: 1,
          rejectedAt: 5,
        },
      },
      { provider: "mistral", replaces: null },
    ]);
  });

  it("never offers members an organization key to replace", () => {
    expect(
      addDialogChoices(listing({ canManageOrg: false })).map((choice) => [
        choice.provider,
        choice.replaces?.scope ?? null,
      ]),
    ).toEqual([
      ["anthropic", null],
      ["openai", null],
      ["mistral", null],
    ]);
  });

  it("offers saved keys as replaces only when nothing is left to add", () => {
    const full = listing();
    full.providers = full.providers.filter(
      (entry) => entry.provider !== "mistral" && entry.provider !== "openai",
    );
    expect(
      addDialogChoices(full).map((choice) => [
        choice.provider,
        choice.replaces?.scope ?? null,
      ]),
    ).toEqual([
      ["anthropic", "org"],
      ["groq", "user"],
    ]);
    expect(
      replaceableKey(
        {
          ...full,
          providers: [
            {
              provider: "groq",
              label: "Groq",
              org: { scope: "org", updatedAt: 1, rejectedAt: 3 },
              personal: { scope: "user", updatedAt: 1 },
            },
          ],
        },
        "groq",
      )?.scope,
    ).toBe("org");
  });

  it("offers a restricted member nothing to add or replace", () => {
    expect(
      addDialogChoices(
        listing({ canManageOrg: false, personalKeysRestricted: true }),
      ),
    ).toEqual([]);
  });

  it("builds the default select from organization providers only", () => {
    expect(
      defaultModelGroups({
        listing: listing(),
        models,
        builderConnected: true,
        builderLabel: "Builder.io",
      }),
    ).toEqual([
      {
        engine: "builder",
        provider: "builder",
        label: "Builder.io",
        models: ["gpt-5.6-luna"],
      },
      {
        engine: "anthropic",
        provider: "anthropic",
        label: "Anthropic",
        models: ["claude-sonnet-5", "claude-haiku-4-5"],
      },
    ]);
  });

  it("uses personal keys for the default of someone without an organization", () => {
    const groups = defaultModelGroups({
      listing: listing({ hasOrganization: false }),
      models: {
        providers: [
          {
            provider: "groq",
            recommendedModels: ["llama-3.3-70b"],
            rows: { user: { models: null } },
          },
        ],
      },
      builderConnected: false,
      builderLabel: "Builder.io",
    });
    expect(groups.map((group) => group.engine)).toEqual(["ai-sdk:groq"]);
  });

  it("round-trips a select value and ignores foreign ones", () => {
    const value = defaultModelValue("ai-sdk:openai", "gpt-a");
    expect(parseDefaultModelValue(value)).toEqual({
      engine: "ai-sdk:openai",
      model: "gpt-a",
    });
    expect(parseDefaultModelValue("gpt-a")).toBeNull();
  });

  it("shows a key's mask and its endpoint host", () => {
    expect(hostOf("https://gateway.example/v1")).toBe("gateway.example");
    expect(
      keyDetailParts({
        scope: "org",
        masked: "••••cccc",
        endpoint: "https://gateway.example/v1",
        updatedAt: 1,
      }),
    ).toEqual(["••••cccc", "gateway.example"]);
    expect(
      keyDetailParts({
        scope: "user",
        endpoint: "http://localhost:11434",
        updatedAt: 1,
      }),
    ).toEqual(["localhost:11434"]);
  });
});
