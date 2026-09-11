import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCuratedWorkspaceTemplates: vi.fn(),
}));

vi.mock("../server/lib/curated-workspace-templates.js", () => ({
  listCuratedWorkspaceTemplates: mocks.listCuratedWorkspaceTemplates,
}));

import action from "./list-curated-workspace-templates.js";

describe("list-curated-workspace-templates action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to the catalog store", async () => {
    const templates = [
      {
        id: "mail",
        name: "Mail",
        description: "Email",
        icon: "Mail",
        color: "#3B82F6",
        template: "mail",
        liveUrl: "https://mail.agent-native.com",
        category: "communication",
        setupNote: "Connect email.",
        installed: false,
      },
    ];
    mocks.listCuratedWorkspaceTemplates.mockResolvedValue(templates);

    await expect(action.run({})).resolves.toEqual(templates);
    expect(mocks.listCuratedWorkspaceTemplates).toHaveBeenCalledOnce();
  });
});
