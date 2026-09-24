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

import { createDesignSystemAuthoringService } from "@agent-native/core/server/design-system-authoring";
import { designSystemWorkspaceSchema } from "@agent-native/core/shared/design-system-authoring";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";
import action from "./get-design-system.js";

describe("Builder authoring publication boundary", () => {
  const workspace = () =>
    designSystemWorkspaceSchema.parse({
      schemaVersion: 1,
      runtime: "builder",
      ownerApp: "design",
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
  it("preserves actual legacy tokens, custom guidance, assets and provider docs after native resume", async () => {
    const row = {
      id: "legacy",
      title: "Legacy actual system",
      data: JSON.stringify({
        source: "builder",
        builderDesignSystemId: "actual-provider",
        colors: { primary: "#345678" },
        typography: {
          headingFont: "Actual Sans",
          headingSizes: { h1: "60px" },
        },
        notes: "Actual legacy note",
      }),
      assets: '[{"name":"Real logo","url":"https://example.test/logo.svg"}]',
      customInstructions: "Keep actual brand guidance",
      isDefault: false,
      visibility: "private",
    };
    const service = createDesignSystemAuthoringService({
      ownerApp: "design",
      nativeThreadState: async () => ({
        exists: false,
        messageCount: 0,
        kickoffReceived: false,
        run: null,
      }),
      read: async () => ({ row: { ...row }, canEdit: true }),
      insert: async () => {
        throw new Error("unexpected insert");
      },
      compareAndSwap: async (_previous, data) => {
        row.data = data;
        return true;
      },
    });
    await service.resume(row.id);
    mockResolveAccess.mockResolvedValue({ role: "owner", resource: row });
    const result = await action.run({ id: row.id, consumedRevision: 0 });
    expect(result.agentContext).toContain("#345678");
    expect(result.agentContext).toContain("Actual Sans");
    expect(result.agentContext).toContain("Keep actual brand guidance");
    expect(result.agentContext).toContain("logo.svg");
    expect(result.agentContext).toContain("Use Acme buttons");
    expect(result.reference.revision).toBe(0);
    const snapshot = await service.get(row.id);
    await service.update({
      id: row.id,
      operationId: "selection",
      expectedRevision: snapshot.workspace!.revision,
      selectedTargetId: "colors",
    });
    await expect(
      action.run({ id: row.id, consumedRevision: 0 }),
    ).resolves.toMatchObject({ reference: { revision: 0 } });
    await service.write({
      id: row.id,
      targetId: "colors",
      expectedRevision: 1,
      operationId: "changed-brand",
      kind: "foundation",
      name: "Colors",
      provenance: "manual",
      sourceIds: [],
      values: { primary: "#654321" },
    });
    await expect(
      action.run({ id: row.id, consumedRevision: 0 }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
  it("resolves a persisted radius scale into generation data without changing artifact history", async () => {
    mockParseBuilderDesignSystemProxyReference.mockReturnValue(null);
    const { designSystemWorkspaceSchema } =
      await import("@agent-native/core/shared/design-system-authoring");
    const values = {
      "radius.sm": "8px",
      "radius.md": "14px",
      "radius.lg": "22px",
      "radius.pill": "999px",
    };
    const workspace = designSystemWorkspaceSchema.parse({
      schemaVersion: 1,
      ownerApp: "design",
      systemId: "scale-system",
      revision: 18,
      contentRevision: 10,
      conversationId: "scale-thread",
      conversationScope: "design-system:scale-system",
      intent: "fresh",
      sources: [],
      run: null,
      selectedTargetId: "radius",
      originDraft: null,
      updatedAt: "now",
      creationHash: "hash",
      operations: [],
      artifacts: [
        {
          id: "radius",
          kind: "foundation",
          name: "Radius",
          revision: 1,
          provenance: "generated",
          sourceIds: [],
          values,
          content: null,
          contentHash: null,
          contentType: null,
          updatedAt: "now",
          history: [],
        },
      ],
    });
    const data = JSON.stringify({ borders: values, authoring: workspace });
    mockResolveAccess.mockResolvedValue({
      role: "owner",
      resource: { id: "scale-system", title: "Scale", data },
    });
    const result = await action.run({
      id: "scale-system",
      consumedRevision: 10,
    });
    expect(JSON.parse(result.data!).borders).toEqual({
      ...values,
      radius: "14px",
    });
    expect(result.agentContext).toContain('"radius": "14px"');
    expect(result.authoring).toEqual(workspace);
    expect(result.reference.revision).toBe(10);
    expect(JSON.parse(data).borders).toEqual(values);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccess.mockResolvedValue({
      role: "owner",
      resource: {
        id: "builder-ds-1",
        title: "Acme System",
        description: "Acme product design language",
        data: JSON.stringify({
          source: "builder",
          builderDesignSystemId: "ds-1",
          builderJobId: "job-1",
          colors: { primary: "var(--primary)" },
        }),
        assets: "[]",
        customInstructions: "Use compact enterprise surfaces.",
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
      tokenValues: { "--acme-accent": "#123456" },
      docCount: 1,
      docs: [
        {
          name: "AGENTS.md",
          type: "agent",
          description: "DSI agent instructions",
          content: "Use Acme buttons and the condensed navigation pattern.",
        },
      ],
    });
  });

  it("returns hydrated Builder DSI context for generation", async () => {
    const result = await action.run({ id: "builder-ds-1" });

    expect(result.agentContext).toContain("Builder DSI");
    expect(result.agentContext).toContain("--acme-accent: #123456");
    expect(result.agentContext).toContain(
      "Use Acme buttons and the condensed navigation pattern.",
    );
    expect(result.agentContext).toContain("override local proxy placeholders");
  });

  it("keeps named tokens, customCSS, and notes out of the truncation tail", async () => {
    // A realistically rich local kit: enough colors to blow the old shared
    // 2,500-char JSON budget several times over. Before sectioning, `notes`
    // and `customCSS` were ordered last by JSON.stringify and never survived.
    mockParseBuilderDesignSystemProxyReference.mockReturnValue(null);
    mockResolveAccess.mockResolvedValue({
      resource: {
        id: "local-ds-1",
        title: "Flo System",
        description: "Imported from floaukenthaler.com",
        data: JSON.stringify({
          colors: Object.fromEntries(
            Array.from({ length: 60 }, (_, i) => [
              `role-${i}-with-a-deliberately-long-name`,
              `#0${i.toString(16).padStart(5, "0")}`,
            ]),
          ),
          typography: { headingFont: "Space Grotesk", bodyFont: "Inter" },
          tokens: [
            {
              name: "color-primary",
              cssVar: "--color-primary",
              value: "#00eaff",
              type: "color",
              group: "Brand",
            },
          ],
          customCSS: ":root { --color-primary: #00eaff; }",
          notes: "Buttons use a 1px accent border and a 120ms ease-out hover.",
        }),
        assets: "[]",
        customInstructions: "",
        isDefault: false,
        visibility: "private",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      },
    });

    const result = await action.run({ id: "local-ds-1" });

    expect(result.agentContext).toContain("--color-primary");
    expect(result.agentContext).toContain(
      ":root { --color-primary: #00eaff; }",
    );
    expect(result.agentContext).toContain("120ms ease-out hover");
    expect(mockHydrateBuilderDesignSystemReference).not.toHaveBeenCalled();
  });

  it("falls back to the local kit when Builder hydration returns nothing usable", async () => {
    mockHydrateBuilderDesignSystemReference.mockResolvedValue({
      source: "builder",
      builderDesignSystemId: "ds-1",
      builderJobId: "job-1",
      tokenValues: {},
      docCount: 0,
      docs: [],
    });

    const result = await action.run({ id: "builder-ds-1" });

    expect(result.agentContext).toContain("no usable docs or token values");
    expect(result.agentContext).toContain("Core design-system tokens:");
  });

  it("does not ask viewers to call the editor-only refresh action", async () => {
    mockResolveAccess.mockResolvedValueOnce({
      role: "viewer",
      resource: {
        id: "builder-ds-1",
        title: "Acme System",
        data: JSON.stringify({
          source: "builder",
          builderDesignSystemId: "ds-1",
          builderJobId: "job-1",
          builderStatus: "in-progress",
        }),
        assets: "[]",
        customInstructions: "",
        isDefault: false,
        visibility: "org",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
    });

    const result = await action.run({ id: "builder-ds-1" });

    expect(result.agentContext).toContain(
      "refreshing the shared system requires editor access",
    );
    expect(result.agentContext).not.toContain(
      "call refresh-design-system-with-builder once",
    );
  });

  it("returns a client-safe not-found error when the design system is unavailable", async () => {
    mockResolveAccess.mockResolvedValue(null);

    await expect(
      action.run({ id: "missing-design-system" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Design system not found",
    });
  });
});
