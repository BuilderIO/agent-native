import { describe, expect, it } from "vitest";

import type { ServiceProviderServiceStatus } from "../../agent/actions/manage-service-providers.js";
import { builderUsages } from "./builder-usage.js";

function service(
  id: ServiceProviderServiceStatus["service"],
  effectiveProvider: ServiceProviderServiceStatus["effectiveProvider"],
): ServiceProviderServiceStatus {
  return { service: id, provider: null, effectiveProvider, options: [] };
}

describe("builderUsages", () => {
  it("lists storage and services only while Builder.io answers them", () => {
    const usages = builderUsages({
      storageOnBuilder: true,
      services: [
        service("voice", "builder"),
        service("images", "gemini"),
        service("embeddings", "builder"),
      ],
      defaultModel: { status: "elsewhere" },
    });
    expect(usages.map((usage) => usage.id)).toEqual([
      "ai-model",
      "file-storage",
      "voice",
      "embeddings",
      "design-system",
      "background-agents",
      "browser-automation",
    ]);
    expect(usages.find((usage) => usage.id === "voice")?.loss).toBe(
      "service-stops",
    );
    expect(usages.find((usage) => usage.id === "file-storage")?.loss).toBe(
      "uploads-fail",
    );
    expect(usages[0]).toEqual({ id: "ai-model", loss: "model-picker" });
  });

  it("says the default model switches when it runs on Builder.io", () => {
    const [aiModel] = builderUsages({
      storageOnBuilder: false,
      services: [],
      defaultModel: {
        status: "builder",
        model: "claude-sonnet-4-5",
        whenDisconnected: { status: "switches", next: "Anthropic" },
      },
    });
    expect(aiModel).toEqual({
      id: "ai-model",
      loss: "default-switches",
      defaultModel: { model: "claude-sonnet-4-5", next: "Anthropic" },
    });
  });

  it("says chats stop when nothing can take over the default model", () => {
    const [aiModel] = builderUsages({
      storageOnBuilder: false,
      services: [],
      defaultModel: {
        status: "builder",
        model: "claude-sonnet-4-5",
        whenDisconnected: { status: "stops" },
      },
    });
    expect(aiModel).toEqual({
      id: "ai-model",
      loss: "default-stops",
      defaultModel: { model: "claude-sonnet-4-5" },
    });
  });

  it("leaves out storage and services it couldn't read instead of guessing", () => {
    const usages = builderUsages({
      storageOnBuilder: null,
      services: null,
      defaultModel: null,
    });
    expect(usages.map((usage) => usage.id)).toEqual([
      "ai-model",
      "design-system",
      "background-agents",
      "browser-automation",
    ]);
  });

  it("leaves out storage on its own bucket", () => {
    const usages = builderUsages({
      storageOnBuilder: false,
      services: [],
      defaultModel: { status: "elsewhere" },
    });
    expect(usages.some((usage) => usage.id === "file-storage")).toBe(false);
  });
});
