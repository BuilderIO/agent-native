import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isLocalAppCreationRuntime: vi.fn(() => process.env.NODE_ENV !== "production"),
  scaffoldWorkspaceAppFromTemplate: vi.fn(),
  startWorkspaceAppCreation: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("../server/lib/app-creation-store.js", () => ({
  isLocalAppCreationRuntime: mocks.isLocalAppCreationRuntime,
  scaffoldWorkspaceAppFromTemplate: mocks.scaffoldWorkspaceAppFromTemplate,
  startWorkspaceAppCreation: mocks.startWorkspaceAppCreation,
}));

vi.mock("../server/lib/dispatch-store.js", () => ({
  recordAudit: mocks.recordAudit,
}));

import action from "./remix-workspace-template.js";

describe("remix-workspace-template action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAudit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("scaffolds the curated source template in local app-creation runtime", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NETLIFY", "");
    mocks.scaffoldWorkspaceAppFromTemplate.mockResolvedValue({
      appId: "mail-remix",
      template: "mail",
      output: "scaffolded",
    });

    const result = await action.run({
      templateId: "mail",
      appId: "mail-remix",
      description: "A private support inbox.",
    });

    expect(mocks.scaffoldWorkspaceAppFromTemplate).toHaveBeenCalledWith({
      template: "mail",
      appId: "mail-remix",
    });
    expect(mocks.startWorkspaceAppCreation).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        appId: "mail-remix",
        sourceTemplate: expect.objectContaining({
          id: "mail",
          template: "mail",
          setupNote: expect.any(String),
        }),
      }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace-app.remix-requested",
        targetId: "mail-remix",
        metadata: expect.objectContaining({ sourceTemplate: "mail" }),
      }),
    );
  });

  it("starts a hosted private remix without copying data or secrets", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.startWorkspaceAppCreation.mockResolvedValue({
      mode: "builder",
      appId: "calendar-remix",
      status: "processing",
    });

    const result = await action.run({
      templateId: "calendar",
      description: "A private scheduling workflow.",
    });

    expect(mocks.scaffoldWorkspaceAppFromTemplate).not.toHaveBeenCalled();
    expect(mocks.startWorkspaceAppCreation).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "calendar-remix",
        template: "calendar",
        description: "A private scheduling workflow.",
        prompt: expect.stringContaining(
          "private workspace remix of a curated first-party template",
        ),
      }),
    );
    const prompt = mocks.startWorkspaceAppCreation.mock.calls[0][0].prompt;
    expect(prompt).toContain("Source template: Calendar (calendar)");
    expect(prompt).toContain("Never copy source-app data");
    expect(prompt).toContain("secrets");
    expect(result).toEqual(
      expect.objectContaining({
        mode: "builder",
        sourceTemplate: expect.objectContaining({ id: "calendar" }),
      }),
    );
  });

  it("rejects templates outside the curated catalog before creating an app", async () => {
    await expect(
      action.run({ templateId: "not-a-curated-template", appId: null }),
    ).rejects.toThrow(
      'Unknown curated workspace template "not-a-curated-template".',
    );
    expect(mocks.scaffoldWorkspaceAppFromTemplate).not.toHaveBeenCalled();
    expect(mocks.startWorkspaceAppCreation).not.toHaveBeenCalled();
  });
});
