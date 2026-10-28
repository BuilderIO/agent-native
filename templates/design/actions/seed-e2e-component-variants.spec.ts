import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  and: vi.fn((...conditions: unknown[]) => ({ kind: "and", conditions })),
  assertAccess: vi.fn(),
  eq: vi.fn((column: unknown, value: unknown) => ({
    kind: "eq",
    column,
    value,
  })),
  getDb: vi.fn(),
  getRequestUserEmail: vi.fn(),
  indexedRows: [] as Array<{ id: string }>,
  selectLimit: undefined as unknown,
  selectWhere: undefined as unknown,
  updateRows: [] as Array<{ id: string }>,
  updateSet: undefined as unknown,
  updateWhere: undefined as unknown,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: mocks.getDb,
  schema: {
    componentIndex: {
      designId: "componentIndex.designId",
      exportName: "componentIndex.exportName",
      filePath: "componentIndex.filePath",
      id: "componentIndex.id",
      name: "componentIndex.name",
      props: "componentIndex.props",
      updatedAt: "componentIndex.updatedAt",
      variants: "componentIndex.variants",
    },
  },
}));

import action from "./seed-e2e-component-variants.js";

const designId = "design-123";
const componentId = "component-index-123";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("E2E_RUN_ROOT", "/tmp/design-e2e-run");
  vi.stubEnv("NODE_ENV", "test");
  mocks.indexedRows = [{ id: componentId }];
  mocks.selectLimit = undefined;
  mocks.selectWhere = undefined;
  mocks.updateRows = [{ id: componentId }];
  mocks.updateSet = undefined;
  mocks.updateWhere = undefined;
  mocks.getRequestUserEmail.mockReturnValue("e2e+autoz@local.test");
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  mocks.getDb.mockReturnValue({
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          mocks.selectWhere = condition;
          return {
            limit: async (limit: number) => {
              mocks.selectLimit = limit;
              return mocks.indexedRows;
            },
          };
        },
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mocks.updateSet = values;
        return {
          where: (condition: unknown) => {
            mocks.updateWhere = condition;
            return { returning: async () => mocks.updateRows };
          },
        };
      },
    }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("seed-e2e-component-variants action", () => {
  it("is a POST-only UI fixture action with a strict described designId", () => {
    expect(action).toMatchObject({
      agentTool: false,
      http: { method: "POST" },
      readOnly: false,
    });
    expect(action.schema.safeParse({ designId }).success).toBe(true);
    expect(action.schema.safeParse({}).success).toBe(false);
    expect(action.schema.safeParse({ designId: "" }).success).toBe(false);
    expect(action.schema.safeParse({ designId, extra: true }).success).toBe(
      false,
    );
    expect(
      (
        action.tool.parameters as {
          properties?: Record<string, { description?: string }>;
        }
      ).properties?.designId?.description,
    ).toMatch(/design project ID/i);
  });

  it("fails closed when E2E_RUN_ROOT is unset", async () => {
    vi.stubEnv("E2E_RUN_ROOT", undefined);

    await expect(action.run({ designId })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mocks.getRequestUserEmail).not.toHaveBeenCalled();
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("fails closed in production even when E2E_RUN_ROOT is set", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(action.run({ designId })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mocks.getRequestUserEmail).not.toHaveBeenCalled();
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires an authenticated request", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(action.run({ designId })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires editor access before opening the app database", async () => {
    const accessError = new Error("editor access denied");
    mocks.assertAccess.mockRejectedValue(accessError);

    await expect(action.run({ designId })).rejects.toBe(accessError);
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      designId,
      "editor",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("updates only the unique indexed E2EButton row after editor authorization", async () => {
    await expect(action.run({ designId })).resolves.toEqual({
      designId,
      componentName: "E2EButton",
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      designId,
      "editor",
    );
    expect(mocks.selectLimit).toBe(2);
    expect(mocks.selectWhere).toEqual({
      kind: "and",
      conditions: [
        { kind: "eq", column: "componentIndex.designId", value: designId },
        { kind: "eq", column: "componentIndex.name", value: "E2EButton" },
      ],
    });
    expect(mocks.updateSet).toMatchObject({
      filePath: "index.html",
      exportName: "E2EButton",
      props: JSON.stringify([
        { name: "variant", type: "primary | secondary | ghost" },
        { name: "size", type: "sm | md | lg" },
      ]),
      variants: JSON.stringify({
        variant: ["primary", "secondary", "ghost"],
        size: ["sm", "md", "lg"],
      }),
      updatedAt: expect.any(String),
    });
    expect(mocks.updateWhere).toEqual({
      kind: "and",
      conditions: [
        { kind: "eq", column: "componentIndex.id", value: componentId },
        { kind: "eq", column: "componentIndex.designId", value: designId },
        { kind: "eq", column: "componentIndex.name", value: "E2EButton" },
      ],
    });
    expect(mocks.assertAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getDb.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ["no indexed row", []],
    ["duplicate indexed rows", [{ id: componentId }, { id: "duplicate-id" }]],
  ])("returns 409 when there is %s", async (_description, rows) => {
    mocks.indexedRows = rows;

    await expect(action.run({ designId })).rejects.toMatchObject({
      statusCode: 409,
      message: "Expected one indexed E2EButton component",
    });
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet).toBeUndefined();
  });

  it("returns 409 if the indexed row disappears before the update completes", async () => {
    mocks.updateRows = [];

    await expect(action.run({ designId })).rejects.toMatchObject({
      statusCode: 409,
      message: "Component metadata fixture was not updated",
    });
  });
});
