import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    accessibleDesignSystemIds: new Set<string>(),
    defaultDesignSystems: [] as Array<{ id: string }>,
    inserts: [] as Array<{ table: unknown; values: unknown }>,
    nanoidCounter: 0,
    templateSource: null as Record<string, unknown> | null,
  };

  return {
    accessFilter: vi.fn(() => ({ kind: "access" })),
    and: vi.fn((...conditions: unknown[]) => ({ kind: "and", conditions })),
    assertAccess: vi.fn(),
    desc: vi.fn((value: unknown) => ({ kind: "desc", value })),
    duplicateDesignRecord: vi.fn(),
    eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
    getRequestOrgId: vi.fn(),
    getRequestUserEmail: vi.fn(),
    resolveAccess: vi.fn(),
    state,
  };
});

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  desc: mocks.desc,
  eq: mocks.eq,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("nanoid", () => ({
  nanoid: () => {
    mocks.state.nanoidCounter += 1;
    return `generated_${mocks.state.nanoidCounter}`;
  },
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(mocks.state.defaultDesignSystems),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        mocks.state.inserts.push({ table, values });
        return Promise.resolve();
      },
    }),
    transaction: async (
      run: (tx: {
        insert: (table: unknown) => {
          values: (values: unknown) => Promise<void>;
        };
      }) => Promise<unknown>,
    ) =>
      run({
        insert: (table: unknown) => ({
          values: (values: unknown) => {
            mocks.state.inserts.push({ table, values });
            return Promise.resolve();
          },
        }),
      }),
  }),
  schema: {
    designs: "designs",
    designFiles: "designFiles",
    designSystems: {
      id: "designSystems.id",
      isDefault: "designSystems.isDefault",
      updatedAt: "designSystems.updatedAt",
    },
    designSystemShares: "designSystemShares",
  },
}));

vi.mock("../server/lib/duplicate-design-record.js", () => ({
  duplicateDesignRecord: mocks.duplicateDesignRecord,
}));

import action from "./create-design.js";

const savedTemplate = {
  id: "template_1",
  title: "Checkout template",
  description: "Reusable checkout",
  projectType: "prototype",
  designSystemId: "template_system",
  data: '{"canvasFrames":{}}',
  ownerEmail: "owner@example.com",
  orgId: "org_1",
  visibility: "org",
};

describe("create-design templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.accessibleDesignSystemIds = new Set();
    mocks.state.defaultDesignSystems = [];
    mocks.state.inserts = [];
    mocks.state.nanoidCounter = 0;
    mocks.state.templateSource = savedTemplate;
    mocks.getRequestUserEmail.mockReturnValue("designer@example.com");
    mocks.getRequestOrgId.mockReturnValue("org_1");
    mocks.assertAccess.mockImplementation(async (type: string, id: string) => {
      if (type === "design") {
        if (!mocks.state.templateSource) throw new Error("Design not found");
        return { resource: mocks.state.templateSource, role: "viewer" };
      }
      return { resource: { id }, role: "viewer" };
    });
    mocks.resolveAccess.mockImplementation(async (_type: string, id: string) =>
      mocks.state.accessibleDesignSystemIds.has(id)
        ? { resource: { id }, role: "viewer" }
        : null,
    );
    mocks.duplicateDesignRecord.mockResolvedValue({
      id: "new_design",
      title: "New checkout",
      fileCount: 2,
    });
  });

  it("copies a saved template with provenance and its accessible design system", async () => {
    mocks.state.accessibleDesignSystemIds.add("template_system");

    const result = await action.run({
      id: "new_design",
      title: "New checkout",
      templateId: savedTemplate.id,
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      savedTemplate.id,
      "viewer",
    );
    expect(mocks.duplicateDesignRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        newId: "new_design",
        source: savedTemplate,
        title: "New checkout",
        designSystemId: "template_system",
        isTemplate: false,
        templateMeta: null,
        dataPatch: {
          templateProvenance: {
            templateId: savedTemplate.id,
            templateTitle: savedTemplate.title,
            appliedAt: expect.any(String),
          },
        },
      }),
    );
    expect(result).toMatchObject({
      id: "new_design",
      renderable: true,
      templateApplied: { fileCount: 2, designSystemMismatch: false },
    });
  });

  it("reports a mismatch when an explicit design system overrides the template", async () => {
    mocks.state.accessibleDesignSystemIds.add("template_system");

    const result = await action.run({
      id: "new_design",
      title: "Rebranded checkout",
      templateId: savedTemplate.id,
      designSystemId: "override_system",
    });

    expect(mocks.duplicateDesignRecord).toHaveBeenCalledWith(
      expect.objectContaining({ designSystemId: "override_system" }),
    );
    expect(result.templateApplied).toEqual({
      fileCount: 2,
      designSystemMismatch: true,
    });
  });

  it("falls back from an inaccessible template system to the accessible default", async () => {
    mocks.state.defaultDesignSystems = [{ id: "default_system" }];

    const result = await action.run({
      id: "new_design",
      title: "Shared checkout",
      templateId: savedTemplate.id,
    });

    expect(mocks.duplicateDesignRecord).toHaveBeenCalledWith(
      expect.objectContaining({ designSystemId: "default_system" }),
    );
    expect(result.templateApplied).toEqual({
      fileCount: 2,
      designSystemMismatch: true,
    });
  });

  it("keeps an explicit null design system when copying a saved template", async () => {
    mocks.state.accessibleDesignSystemIds.add("template_system");

    await action.run({
      id: "new_design",
      title: "Unbranded checkout",
      templateId: savedTemplate.id,
      designSystemId: null,
    });

    expect(mocks.duplicateDesignRecord).toHaveBeenCalledWith(
      expect.objectContaining({ designSystemId: null }),
    );
    expect(mocks.assertAccess).not.toHaveBeenCalledWith(
      "design-system",
      expect.anything(),
      "viewer",
    );
  });

  it("persists wireframe starter screens and matching canvas geometry", async () => {
    const result = await action.run({
      id: "wireframe_design",
      title: "Wireframe copy",
      templateId: "starter:wireframe-kit",
      designSystemId: null,
    });

    expect(mocks.state.inserts).toHaveLength(2);
    const designInsert = mocks.state.inserts[0]!.values as {
      id: string;
      data: string;
    };
    const fileInsert = (
      mocks.state.inserts[1]!.values as Array<{
        id: string;
        designId: string;
        filename: string;
        content: string;
      }>
    )[0]!;
    const data = JSON.parse(designInsert.data) as {
      canvasFrames: Record<string, unknown>;
      templateProvenance: { templateId: string };
    };

    expect(mocks.state.inserts[0]!.table).toBe("designs");
    expect(mocks.state.inserts[1]!.table).toBe("designFiles");
    expect(fileInsert).toMatchObject({
      designId: "wireframe_design",
      filename: "index.html",
    });
    expect(fileInsert.content).toContain("data-agent-native-node-id");
    expect(Object.keys(data.canvasFrames)).toEqual([fileInsert.id]);
    expect(data.templateProvenance.templateId).toBe("starter:wireframe-kit");
    expect(result).toMatchObject({
      renderable: true,
      templateApplied: { fileCount: 1, designSystemMismatch: false },
    });
  });

  it("records provenance and requests generation for brief-only starters", async () => {
    const result = await action.run({
      id: "landing_design",
      title: "Landing page",
      templateId: "starter:landing",
      designSystemId: null,
    });

    expect(mocks.state.inserts).toHaveLength(1);
    const designInsert = mocks.state.inserts[0]!.values as { data: string };
    const data = JSON.parse(designInsert.data) as {
      templateProvenance: { templateId: string; templateTitle: string };
    };
    expect(data.templateProvenance).toMatchObject({
      templateId: "starter:landing",
      templateTitle: "starter.landing.title",
    });
    expect(result.renderable).toBe(false);
    expect(result.templateApplied).toEqual({
      fileCount: 0,
      designSystemMismatch: false,
    });
    expect(result.nextRequiredAction).toContain("show-design-questions");
  });

  it("does not copy an inaccessible saved template", async () => {
    mocks.assertAccess.mockRejectedValue(new Error("forbidden"));

    await expect(
      action.run({
        id: "new_design",
        title: "Blocked",
        templateId: savedTemplate.id,
      }),
    ).rejects.toThrow("forbidden");
    expect(mocks.duplicateDesignRecord).not.toHaveBeenCalled();
    expect(mocks.state.inserts).toEqual([]);
  });
});
