import { describe, expect, it } from "vitest";

import { buildChatFirstAppCreationPrompt } from "./chat-first-app-creation.js";

const baseInput = {
  appId: "quality",
  prompt: "Build a quality dashboard",
  selectedKeys: [],
  selectedResources: [],
  vaultAccessMode: "manual" as const,
};

describe("buildChatFirstAppCreationPrompt", () => {
  it("tells the agent to keep the router basename call for the default mount", () => {
    expect(buildChatFirstAppCreationPrompt(baseInput)).toContain(
      "- Keep the configureClientRouterBasename() call in app/entry.client.tsx so /quality hydrates correctly.",
    );
  });

  it("uses a custom mount path in the router basename instruction", () => {
    expect(
      buildChatFirstAppCreationPrompt({ ...baseInput, mountPath: "/qa" }),
    ).toContain(
      "- Keep the configureClientRouterBasename() call in app/entry.client.tsx so /qa hydrates correctly.",
    );
  });
});
