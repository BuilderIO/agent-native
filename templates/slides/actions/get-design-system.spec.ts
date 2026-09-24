vi.mock("@agent-native/core/server/builder-dsi-access", () => ({
  assertBuilderDsiAccess: vi.fn(async () => ({
    status: "ready",
    eligible: true,
  })),
  getBuilderDsiAccess: vi.fn(async () => ({ status: "ready", eligible: true })),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHydrateBuilderDesignSystemReference = vi.fn();
const mockParseBuilderDesignSystemProxyReference = vi.fn();
const mockResolveAccess = vi.fn();

vi.mock("@agent-native/core/server", () => ({
  hydrateBuilderDesignSystemReference: (
    ...args: Parameters<typeof mockHydrateBuilderDesignSystemReference>
  ) => mockHydrateBuilderDesignSystemReference(...args),
  parseBuilderDesignSystemProxyReference: (
    ...args: Parameters<typeof mockParseBuilderDesignSystemProxyReference>
  ) => mockParseBuilderDesignSystemProxyReference(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: Parameters<typeof mockResolveAccess>) =>
    mockResolveAccess(...args),
}));

vi.mock("../server/db/index.js", () => ({}));
vi.mock("../server/lib/design-system-authoring.js", () => ({
  designSystemAuthoring: { get: vi.fn() },
}));

import { designSystemWorkspaceSchema } from "@agent-native/core/shared/design-system-authoring";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";
import action from "./get-design-system.js";

describe("Builder authoring publication boundary", () => {
  const workspace = () =>
    designSystemWorkspaceSchema.parse({
      schemaVersion: 1,
      runtime: "builder",
      ownerApp: "slides",
      systemId: "system",
      revision: 3,
      contentRevision: 2,
      conversationId: "conversation",
      conversationScope: "design-system:system",
      intent: "fresh",
      sources: [],
      artifacts: [
        {
          id: "artifact",
          name: "Actual tokens",
          kind: "foundation",
          revision: 1,
          provenance: "generated",
          sourceIds: [],
          content: null,
          contentType: "text/css",
          contentHash: "example-hash",
          provider: { id: "tokens/tokens.css", kind: "css" },
          updatedAt: "now",
          history: [],
        },
      ],
      run: null,
      selectedTargetId: null,
      originDraft: null,
      updatedAt: "now",
      creationHash: "example",
      operations: [],
      builder: {
        sessionId: "session",
        revision: "remote-revision",
        sourceIds: [],
        sourceOutcomes: [],
        operations: [],
        publication: null,
      },
    });
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseBuilderDesignSystemProxyReference.mockReturnValue(null);
    mockResolveAccess.mockResolvedValue({
      role: "owner",
      resource: {
        id: "system",
        title: "Example",
        data: JSON.stringify({ authoring: workspace() }),
        assets: "[]",
      },
    });
  });
  it("rejects unpublished compact context without calling Builder", async () => {
    await expect(
      action.run({ id: "system", compact: "true" }),
    ).rejects.toMatchObject({
      errorCode: "design_system_publication_required",
    });
    expect(designSystemAuthoring.get).not.toHaveBeenCalled();
  });
  it("rejects full context when the live publication is not usable", async () => {
    vi.mocked(designSystemAuthoring.get).mockResolvedValue({
      id: "system",
      title: "Example",
      canEdit: true,
      workspace: workspace(),
      canUse: false,
    });
    await expect(action.run({ id: "system" })).rejects.toMatchObject({
      errorCode: "design_system_publication_required",
    });
  });
  it("uses confirmed live metadata and instructs generation to read real files", async () => {
    const live = workspace();
    live.contentRevision = 4;
    vi.mocked(designSystemAuthoring.get).mockResolvedValue({
      id: "system",
      title: "Example",
      canEdit: true,
      workspace: live,
      canUse: true,
    });
    const result = await action.run({ id: "system", consumedRevision: 4 });
    expect(result.reference.revision).toBe(4);
    expect(result.agentContext).toContain("get-design-system-artifact");
    expect(result.agentContext).toContain("Actual tokens");
    expect(mockHydrateBuilderDesignSystemReference).not.toHaveBeenCalled();
  });
});

describe("get-design-system", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "builder-ds-1",
        title: "Acme Slides",
        description: "Acme presentation system",
        data: JSON.stringify({
          source: "builder",
          builderDesignSystemId: "ds-1",
          builderJobId: "job-1",
          colors: { primary: "var(--primary)" },
        }),
        assets: "[]",
        customInstructions: "Use restrained executive presentation layouts.",
        isDefault: false,
        visibility: "private",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
    });
    mockParseBuilderDesignSystemProxyReference.mockReturnValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      builderProjectId: "project-1",
      builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
      builderStatus: "ready",
    });
    mockHydrateBuilderDesignSystemReference.mockResolvedValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      builderProjectId: "project-1",
      builderUrl: "https://builder.io/app/design-system-intelligence/ds-1",
      builderStatus: "ready",
      tokenValues: { "--acme-slide-accent": "#654321" },
      docCount: 1,
      docs: [
        {
          name: "deck-guidance.md",
          type: "agent",
          description: "DSI slide guidance",
          content: "Use quiet title slides and Acme metric-card components.",
        },
      ],
    });
  });

  it("returns hydrated Builder DSI context for deck generation", async () => {
    const result = await action.run({ id: "builder-ds-1" });

    expect(result.agentContext).toContain("Builder DSI");
    expect(result.agentContext).toContain("--acme-slide-accent: #654321");
    expect(result.agentContext).toContain(
      "Use quiet title slides and Acme metric-card components.",
    );
    expect(result.agentContext).toContain("override local proxy placeholders");
  });
});
