import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = Array<Record<string, unknown>>;

const mocks = vi.hoisted(() => {
  const state = {
    queryResults: [] as QueryResult[],
    selectCount: 0,
    whereArgs: [] as unknown[],
  };

  const select = vi.fn(() => {
    const result = state.queryResults[state.selectCount++] ?? [];
    const chain: {
      from: () => typeof chain;
      where: (condition: unknown) => typeof chain;
      orderBy: () => Promise<QueryResult>;
      groupBy: () => Promise<QueryResult>;
      then: Promise<QueryResult>["then"];
    } = {
      from: () => chain,
      where: (condition) => {
        state.whereArgs.push(condition);
        return chain;
      },
      orderBy: () => Promise.resolve(result),
      groupBy: () => Promise.resolve(result),
      then: (onFulfilled, onRejected) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return chain;
  });

  return {
    accessFilter: vi.fn(() => ({ kind: "access" })),
    and: vi.fn((...conditions: unknown[]) => ({ kind: "and", conditions })),
    count: vi.fn(() => ({ kind: "count" })),
    desc: vi.fn((value: unknown) => ({ kind: "desc", value })),
    eq: vi.fn((left: unknown, right: unknown) => ({
      kind: "eq",
      left,
      right,
    })),
    inArray: vi.fn((left: unknown, values: unknown[]) => ({
      kind: "inArray",
      left,
      values,
    })),
    select,
    state,
  };
});

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: mocks.accessFilter,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  count: mocks.count,
  desc: mocks.desc,
  eq: mocks.eq,
  inArray: mocks.inArray,
  sql: vi.fn((strings, ...values) => ({ strings, values })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: {
    designs: {
      id: "designs.id",
      title: "designs.title",
      description: "designs.description",
      projectType: "designs.projectType",
      designSystemId: "designs.designSystemId",
      visibility: "designs.visibility",
      isTemplate: "designs.isTemplate",
      templateMeta: "designs.templateMeta",
      createdAt: "designs.createdAt",
      updatedAt: "designs.updatedAt",
    },
    designShares: "designShares",
    designFiles: {
      designId: "designFiles.designId",
      filename: "designFiles.filename",
      content: "designFiles.content",
      fileType: "designFiles.fileType",
    },
  },
}));

import listDesignsAction, { PREVIEW_MAX_BYTES } from "./list-designs.js";
import listTemplatesAction from "./list-templates.js";

const templateRow = {
  id: "template_1",
  title: "Checkout flow",
  description: "Reusable checkout",
  projectType: "prototype",
  designSystemId: "system_1",
  visibility: "org",
  templateMeta: '{"sourceDesignId":"design_1"}',
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
};

describe("list-templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.queryResults = [];
    mocks.state.selectCount = 0;
    mocks.state.whereArgs = [];
  });

  it("always returns built-in templates and scopes saved templates", async () => {
    mocks.state.queryResults = [[]];

    const result = await listTemplatesAction.run({});

    expect(result.count).toBe(0);
    expect(result.templates).toEqual([]);
    expect(result.builtInTemplates).toHaveLength(5);
    expect(
      result.builtInTemplates.find(
        (template) => template.id === "starter:wireframe-kit",
      ),
    ).toMatchObject({ hasSeedScreens: true, screenCount: 1 });
    expect(mocks.state.whereArgs[0]).toEqual({
      kind: "and",
      conditions: [
        { kind: "access" },
        { kind: "eq", left: "designs.isTemplate", right: true },
      ],
    });
  });

  it("returns screen counts and bounded index previews", async () => {
    const oversizedPreview = "x".repeat(PREVIEW_MAX_BYTES + 250);
    mocks.state.queryResults = [
      [templateRow],
      [{ designId: templateRow.id, value: 2 }],
      [
        {
          designId: templateRow.id,
          filename: "other.html",
          content: "<main>Other</main>",
          fileType: "html",
        },
        {
          designId: templateRow.id,
          filename: "index.html",
          content: oversizedPreview,
          fileType: "html",
        },
        {
          designId: templateRow.id,
          filename: "styles.css",
          content: "body{}",
          fileType: "css",
        },
      ],
    ];

    const result = await listTemplatesAction.run({ includePreview: "true" });

    expect(result.count).toBe(1);
    expect(result.templates[0]).toMatchObject({
      id: templateRow.id,
      screenCount: 2,
      previewHtml: oversizedPreview.slice(0, PREVIEW_MAX_BYTES),
    });
    expect(
      (result.templates[0] as { previewHtml: string }).previewHtml,
    ).toHaveLength(PREVIEW_MAX_BYTES);
  });

  it("returns compact metadata without loading preview files", async () => {
    mocks.state.queryResults = [
      [templateRow],
      [{ designId: templateRow.id, value: 2 }],
    ];

    const result = await listTemplatesAction.run({
      compact: "true",
      includePreview: "true",
    });

    expect(result.templates).toEqual([
      {
        id: templateRow.id,
        title: templateRow.title,
        designSystemId: templateRow.designSystemId,
        screenCount: 2,
      },
    ]);
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });
});

describe("list-designs template filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.queryResults = [[]];
    mocks.state.selectCount = 0;
    mocks.state.whereArgs = [];
  });

  it("excludes template rows by default", async () => {
    await listDesignsAction.run({});

    expect(mocks.state.whereArgs[0]).toEqual({
      kind: "and",
      conditions: [
        { kind: "access" },
        { kind: "eq", left: "designs.isTemplate", right: false },
      ],
    });
  });

  it("can explicitly include template rows", async () => {
    await listDesignsAction.run({ includeTemplates: "true" });

    expect(mocks.state.whereArgs[0]).toEqual({ kind: "access" });
  });
});
