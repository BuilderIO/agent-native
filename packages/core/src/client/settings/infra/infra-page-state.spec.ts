import { describe, expect, it } from "vitest";

import type {
  ServiceProviderServiceStatus,
  ServiceProvidersStatus,
} from "../../../agent/actions/manage-service-providers.js";
import type { FileStorageStatus } from "../../../file-upload/storage-settings.js";
import type { ModelProvidersListing } from "../model/model-page-state.js";
import {
  aiModelSources,
  appAddress,
  initialServiceChoice,
  optimisticServiceStatus,
  serviceDialogChoices,
  serviceDialogStep,
  storageSource,
  variablesSummary,
} from "./infra-page-state.js";

type Options = ServiceProviderServiceStatus["options"];

function voice(
  options: Partial<
    Record<Options[number]["provider"], Options[number]["keyState"]>
  >,
  choice: ServiceProviderServiceStatus["provider"] = null,
  effective: ServiceProviderServiceStatus["effectiveProvider"] = null,
): ServiceProviderServiceStatus {
  return {
    service: "voice",
    provider: choice,
    effectiveProvider: effective,
    options: (["builder", "gemini", "groq", "openai"] as const).map(
      (provider) => ({ provider, keyState: options[provider] ?? "none" }),
    ),
  };
}

describe("service dialog", () => {
  it("offers Builder.io only while it can answer or is the saved choice", () => {
    expect(serviceDialogChoices(voice({}))).toEqual([
      "gemini",
      "groq",
      "openai",
    ]);
    expect(serviceDialogChoices(voice({ builder: "org" }))).toEqual([
      "builder",
      "gemini",
      "groq",
      "openai",
    ]);
    expect(serviceDialogChoices(voice({}, "builder"))[0]).toBe("builder");
  });

  it("opens on what answers now, else the first organization key", () => {
    expect(
      initialServiceChoice(voice({ builder: "org" }, null, "builder")),
    ).toBe("builder");
    expect(initialServiceChoice(voice({ groq: "org" }))).toBe("groq");
    expect(initialServiceChoice(voice({}))).toBe("gemini");
  });

  it("makes the primary button the next step", () => {
    const status = voice({
      builder: "org",
      gemini: "org",
      groq: "personal",
      openai: "unavailable",
    });
    expect(serviceDialogStep(status, "builder")).toEqual({
      kind: "use-builder",
    });
    expect(serviceDialogStep(status, "gemini")).toEqual({ kind: "save" });
    expect(serviceDialogStep(status, "groq")).toEqual({
      kind: "add",
      agentProvider: "groq",
    });
    // An unreadable key isn't "none"; saving the choice is still allowed.
    expect(serviceDialogStep(status, "openai")).toEqual({ kind: "save" });
  });

  it("adds Voyage's key on the API keys page, not the provider dialog", () => {
    const embeddings: ServiceProviderServiceStatus = {
      service: "embeddings",
      provider: null,
      effectiveProvider: null,
      options: [{ provider: "voyage", keyState: "none" }],
    };
    expect(serviceDialogStep(embeddings, "voyage")).toEqual({
      kind: "add",
      agentProvider: null,
    });
  });
});

describe("optimisticServiceStatus", () => {
  const status: ServiceProvidersStatus = {
    canManage: true,
    updatedAt: null,
    updatedBy: null,
    services: [voice({ builder: "org", gemini: "org" }, null, "builder")],
  };

  it("shows the new provider before the server answers", () => {
    const next = optimisticServiceStatus(status, "voice", "gemini");
    expect(next.services[0]).toMatchObject({
      provider: "gemini",
      effectiveProvider: "gemini",
    });
    // The input is left alone, so a failure can roll back to it.
    expect(status.services[0]?.provider).toBeNull();
  });

  it("keeps the current answer when the new provider has no key", () => {
    const next = optimisticServiceStatus(status, "voice", "groq");
    expect(next.services[0]).toMatchObject({
      provider: "groq",
      effectiveProvider: "builder",
    });
  });
});

describe("aiModelSources", () => {
  const listing = {
    hasOrganization: true,
    providers: [
      {
        provider: "anthropic",
        label: "Anthropic",
        org: { scope: "org", updatedAt: 1 },
        personal: null,
      },
      {
        provider: "openai",
        label: "OpenAI",
        org: { scope: "org", updatedAt: 1, rejectedAt: 2 },
        personal: null,
      },
      {
        provider: "groq",
        label: "Groq",
        org: null,
        personal: { scope: "user", updatedAt: 1 },
      },
    ],
  } as unknown as ModelProvidersListing;

  it("lists Builder.io and working organization keys", () => {
    expect(aiModelSources(listing, true)).toEqual({
      labels: ["Builder.io", "Anthropic"],
      lead: "builder",
    });
    expect(aiModelSources(listing, false)).toEqual({
      labels: ["Anthropic"],
      lead: "anthropic",
    });
  });

  it("uses the only user's keys without an organization", () => {
    expect(
      aiModelSources({ ...listing, hasOrganization: false }, false).labels,
    ).toEqual(["Groq"]);
  });
});

describe("storageSource", () => {
  const base = {
    configured: false,
    provider: null,
    bucket: null,
    activeProvider: null,
  } as unknown as FileStorageStatus;

  it("names the bucket, Builder.io, or nothing", () => {
    expect(
      storageSource({
        ...base,
        configured: true,
        provider: "cloudflare-r2",
        bucket: "clips-recordings",
      }),
    ).toEqual({
      kind: "bucket",
      provider: "cloudflare-r2",
      bucket: "clips-recordings",
    });
    expect(
      storageSource({
        ...base,
        activeProvider: { id: "builder", name: "Builder.io" },
      }),
    ).toEqual({ kind: "builder" });
    expect(storageSource(base)).toEqual({ kind: "none" });
  });
});

describe("appAddress", () => {
  it("prefers the manifest URL, then the gateway, then this origin", () => {
    expect(
      appAddress(
        {
          id: "clips",
          name: "Clips",
          url: "https://clips.example.com",
          path: "/clips",
        },
        "https://apps.example.com",
        "http://localhost:3000",
      ),
    ).toBe("https://clips.example.com");
    expect(
      appAddress(
        { id: "mail", name: "Mail", url: null, path: "/mail" },
        "https://apps.example.com/",
        "http://localhost:3000",
      ),
    ).toBe("https://apps.example.com/mail");
    expect(
      appAddress(
        { id: "mail", name: "Mail", url: null, path: "/mail" },
        null,
        "http://localhost:3000",
      ),
    ).toBe("http://localhost:3000/mail");
    expect(
      appAddress(
        { id: "app", name: "App", url: null, path: null },
        null,
        "http://localhost:3000",
      ),
    ).toBe("http://localhost:3000");
  });
});

describe("variablesSummary", () => {
  it("splits required from optional and names what's missing", () => {
    const summary = variablesSummary([
      { key: "DATABASE_URL", required: true, set: true },
      { key: "A2A_SECRET", required: true, set: false },
      { key: "APP_URL", required: false, set: false },
    ]);
    expect(summary.required.map((variable) => variable.key)).toEqual([
      "DATABASE_URL",
      "A2A_SECRET",
    ]);
    expect(summary.optional.map((variable) => variable.key)).toEqual([
      "APP_URL",
    ]);
    expect(summary.missing).toEqual(["A2A_SECRET"]);
  });
});
