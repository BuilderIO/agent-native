import { describe, expect, it, vi } from "vitest";

const loadResourcesForPromptMock = vi.hoisted(() => vi.fn());
const promptResourceManifestSectionsMock = vi.hoisted(() => vi.fn());
const buildSchemaBlockMock = vi.hoisted(() => vi.fn());
const buildFrameworkPromptsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/agent-chat/prompt-resources.js", () => ({
  loadResourcesForPrompt: (...args: unknown[]) =>
    loadResourcesForPromptMock(...args),
  promptResourceManifestSections: (...args: unknown[]) =>
    promptResourceManifestSectionsMock(...args),
}));
vi.mock("../../../server/agent-chat/framework-prompts.js", () => ({
  buildSchemaBlock: (...args: unknown[]) => buildSchemaBlockMock(...args),
  buildFrameworkPrompts: (...args: unknown[]) =>
    buildFrameworkPromptsMock(...args),
}));

describe("context-preview-get", () => {
  it("returns a labeled, token-counted preview without a thread", async () => {
    loadResourcesForPromptMock.mockResolvedValue(
      '<resource name="AGENTS.md" scope="personal" path="AGENTS.md">Personal guidance</resource>',
    );
    promptResourceManifestSectionsMock.mockReturnValue([
      {
        label: "AGENTS.md",
        provenance: "personal",
        governance: "user",
        content: "Personal guidance",
        sourceRef: { path: "AGENTS.md", scope: "personal" },
      },
    ]);
    buildSchemaBlockMock.mockResolvedValue("table users (id text)");
    buildFrameworkPromptsMock.mockReturnValue({
      PROD_FRAMEWORK_PROMPT: "Framework prompt",
      PROD_FRAMEWORK_PROMPT_COMPACT: "Compact framework prompt",
    });

    const { buildContextPreview } = await import("./context-preview-get.js");
    const preview = await buildContextPreview({
      ownerEmail: "owner@example.com",
      scope: "user",
    });

    expect(preview.source).toBe("preview");
    expect(preview.scope).toBe("user");
    expect(preview.totalTokens).toBe(preview.systemTokens);
    expect(preview.sections.map((section) => section.provenance)).toEqual([
      "framework-core",
      "personal",
      "db-schema",
    ]);
    expect(
      preview.sections.every((section) => section.preview.length <= 200),
    ).toBe(true);
  });
});
