import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  duplicateDesignRecord: vi.fn(),
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/design/templates"),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("../server/lib/duplicate-design-record.js", () => ({
  duplicateDesignRecord: mocks.duplicateDesignRecord,
}));

import action from "./save-as-template.js";

const source = {
  id: "source_design",
  title: "Checkout flow",
  description: "A reusable checkout flow",
  projectType: "prototype",
  designSystemId: "system_1",
  data: "{}",
};

describe("save-as-template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("designer@example.com");
    mocks.getRequestOrgId.mockReturnValue("org_1");
    mocks.resolveAccess.mockResolvedValue({ resource: source, role: "viewer" });
    mocks.duplicateDesignRecord.mockResolvedValue({
      id: "template_1",
      title: source.title,
      fileCount: 2,
    });
  });

  it("creates an org-visible frozen template owned by the caller", async () => {
    const result = await action.run({ designId: source.id });

    expect(mocks.resolveAccess).toHaveBeenCalledWith("design", source.id);
    expect(mocks.duplicateDesignRecord).toHaveBeenCalledWith({
      source,
      title: source.title,
      description: source.description,
      ownerEmail: "designer@example.com",
      orgId: "org_1",
      visibility: "org",
      isTemplate: true,
      templateMeta: { sourceDesignId: source.id },
    });
    expect(result).toEqual({
      id: "template_1",
      title: source.title,
      fileCount: 2,
    });
  });

  it("uses explicit template copy and keeps personal templates private", async () => {
    mocks.getRequestOrgId.mockReturnValue(undefined);

    await action.run({
      designId: source.id,
      title: "Reusable checkout",
      description: "For product teams",
    });

    expect(mocks.duplicateDesignRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Reusable checkout",
        description: "For product teams",
        orgId: null,
        visibility: "private",
      }),
    );
  });

  it("rejects inaccessible source designs without attempting a copy", async () => {
    mocks.resolveAccess.mockResolvedValue(null);

    await expect(action.run({ designId: "missing" })).rejects.toThrow(
      "Design not found: missing",
    );
    expect(mocks.duplicateDesignRecord).not.toHaveBeenCalled();
  });

  it("requires an authenticated owner", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(action.run({ designId: source.id })).rejects.toThrow(
      "no authenticated user",
    );
    expect(mocks.duplicateDesignRecord).not.toHaveBeenCalled();
  });
});
