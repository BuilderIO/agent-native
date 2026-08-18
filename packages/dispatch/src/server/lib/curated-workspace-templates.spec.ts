import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listWorkspaceApps: vi.fn(),
}));

vi.mock("./app-creation-store.js", () => ({
  listWorkspaceApps: mocks.listWorkspaceApps,
}));

import {
  CURATED_WORKSPACE_TEMPLATES,
  getCuratedWorkspaceTemplate,
  listCuratedWorkspaceTemplates,
} from "./curated-workspace-templates.js";

describe("curated workspace templates", () => {
  it("validates only the curated first-party template ids", () => {
    expect(getCuratedWorkspaceTemplate(" MAIL ")).toEqual(
      expect.objectContaining({ id: "mail", template: "mail" }),
    );
    expect(() => getCuratedWorkspaceTemplate("unknown")).toThrow(
      'Unknown curated workspace template "unknown".',
    );
  });

  it("returns stable catalog metadata and current installation status", async () => {
    mocks.listWorkspaceApps.mockResolvedValue([
      { id: "dispatch" },
      { id: "mail", archived: true },
      { id: "custom-app" },
    ]);

    const result = await listCuratedWorkspaceTemplates();

    expect(result).toHaveLength(10);
    expect(result.map((template) => template.id)).toEqual(
      CURATED_WORKSPACE_TEMPLATES.map((template) => template.id),
    );
    expect(result.find((template) => template.id === "mail")).toEqual(
      expect.objectContaining({
        name: "Mail",
        template: "mail",
        liveUrl: "https://mail.agent-native.com",
        installed: true,
      }),
    );
    expect(result.find((template) => template.id === "calendar")).toEqual(
      expect.objectContaining({ installed: false }),
    );
    expect(mocks.listWorkspaceApps).toHaveBeenCalledWith({
      includeAgentCards: false,
      includeArchived: true,
    });
  });
});
