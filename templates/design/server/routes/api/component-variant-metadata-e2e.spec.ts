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
  getSession: vi.fn(),
  indexedRows: [] as Array<{ id: string }>,
  runWithRequestContext: vi.fn(),
  selectLimit: undefined as unknown,
  selectWhere: undefined as unknown,
  setResponseStatus: vi.fn(),
  updateRows: [] as Array<{ id: string }>,
  updateSet: undefined as unknown,
  updateWhere: undefined as unknown,
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  runWithRequestContext: mocks.runWithRequestContext,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
}));

vi.mock("h3", () => ({
  createError: ({ statusCode, statusMessage }: Record<string, unknown>) =>
    Object.assign(new Error(String(statusMessage)), {
      statusCode,
      statusMessage,
    }),
  defineEventHandler: (handler: unknown) => handler,
  readBody: async (event: { body?: unknown }) => event.body,
  setResponseStatus: (event: { status?: number }, status: number) => {
    event.status = status;
  },
}));

vi.mock("../../db/index.js", () => ({
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

import handler from "./e2e/component-variant-metadata.post.js";

const designId = "design-123";
const componentId = "component-index-123";

function makeEvent(body: unknown = { designId }) {
  return { body, status: 200 };
}

describe("POST /api/e2e/component-variant-metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectLimit = undefined;
    mocks.selectWhere = undefined;
    mocks.updateSet = undefined;
    mocks.updateWhere = undefined;
    vi.stubEnv("E2E_RUN_ROOT", "/tmp/design-e2e-run");
    vi.stubEnv("NODE_ENV", "test");
    mocks.indexedRows = [{ id: componentId }];
    mocks.updateRows = [{ id: componentId }];
    mocks.getSession.mockResolvedValue({
      email: "e2e+autoz@local.test",
      orgId: "e2e-org",
    });
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.runWithRequestContext.mockImplementation(
      (_context: unknown, callback: () => unknown) => callback(),
    );
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

  it("returns 404 when the E2E run root is unset", async () => {
    vi.stubEnv("E2E_RUN_ROOT", undefined);
    const event = makeEvent();

    await expect(handler(event as never)).resolves.toEqual({
      error: "Not found",
    });

    expect(event.status).toBe(404);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns 404 in production even when the E2E run root is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const event = makeEvent();

    await expect(handler(event as never)).resolves.toEqual({
      error: "Not found",
    });

    expect(event.status).toBe(404);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires an authenticated request", async () => {
    mocks.getSession.mockResolvedValue(null);
    const event = makeEvent();

    await expect(handler(event as never)).resolves.toEqual({
      error: "Unauthorized",
    });

    expect(event.status).toBe(401);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("requires editor access before opening the app database", async () => {
    const accessError = new Error("editor access denied");
    mocks.assertAccess.mockRejectedValue(accessError);

    await expect(handler(makeEvent() as never)).rejects.toBe(accessError);

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      designId,
      "editor",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("updates only the unique indexed E2EButton row after editor authorization", async () => {
    const result = await handler(makeEvent() as never);

    expect(result).toEqual({ designId, componentName: "E2EButton" });
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "e2e+autoz@local.test", orgId: "e2e-org" },
      expect.any(Function),
    );
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
    const event = makeEvent();

    const error = await handler(event as never).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      statusCode: 409,
      statusMessage: "Expected one indexed E2EButton component",
    });
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet).toBeUndefined();
  });

  it("returns 409 if the indexed row disappears before the update completes", async () => {
    mocks.updateRows = [];

    const error = await handler(makeEvent() as never).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      statusCode: 409,
      statusMessage: "Component metadata fixture was not updated",
    });
  });
});
