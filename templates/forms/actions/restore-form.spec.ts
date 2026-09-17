import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockInvalidatePublicFormCache = vi.hoisted(() => vi.fn());

const state = vi.hoisted(() => ({
  forms: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@agent-native/core/action", async () => ({
  ...(await vi.importActual<typeof import("@agent-native/core/action")>(
    "@agent-native/core/action",
  )),
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/sharing", async () => ({
  ...(await vi.importActual<typeof import("@agent-native/core/sharing")>(
    "@agent-native/core/sharing",
  )),
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", async () => ({
  ...(await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm")),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/lib/public-form-ssr.js", () => ({
  invalidatePublicFormCache: mockInvalidatePublicFormCache,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (clause: { value: string }) => ({
          limit: async () => {
            const form = state.forms.get(clause.value);
            return form ? [form] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => ({
        where: async (clause: { value: string }) => {
          const existing = state.forms.get(clause.value);
          if (existing)
            state.forms.set(clause.value, { ...existing, ...updates });
        },
      }),
    }),
  }),
  schema: { forms: { id: "forms.id" } },
}));

const { ForbiddenError } = await vi.importActual<
  typeof import("@agent-native/core/sharing")
>("@agent-native/core/sharing");

const { default: restoreForm } = await import("./restore-form.js");

describe("restore-form action", () => {
  beforeEach(() => {
    state.forms = new Map([
      ["form-1", { id: "form-1", deletedAt: "2026-01-01T00:00:00.000Z" }],
      ["form-2", { id: "form-2", deletedAt: "2026-01-01T00:00:00.000Z" }],
    ]);
    mockAssertAccess.mockReset();
    mockAssertAccess.mockResolvedValue({ role: "admin" });
    mockInvalidatePublicFormCache.mockClear();
  });

  it("rejects a single forbidden id instead of resolving with success: false", async () => {
    mockAssertAccess.mockRejectedValueOnce(new ForbiddenError());

    await expect(restoreForm.run({ id: "form-1" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("rejects a single missing id instead of resolving with success: false", async () => {
    await expect(restoreForm.run({ id: "missing-form" })).rejects.toMatchObject(
      {
        errorCode: "form_not_found",
        statusCode: 404,
      },
    );
  });

  it("rejects the whole batch when one id is forbidden, instead of reporting it as a completed action", async () => {
    mockAssertAccess.mockImplementation(async (_type: string, id: string) => {
      if (id === "form-2") throw new ForbiddenError();
      return { role: "admin" };
    });

    await expect(
      restoreForm.run({ id: ["form-1", "form-2"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("still reports an ordinary not-found id as a per-item batch failure", async () => {
    const result = await restoreForm.run({
      id: ["form-1", "missing-form"],
    });

    expect(result.success).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({ id: "form-1", success: true }),
      expect.objectContaining({ id: "missing-form", success: false }),
    ]);
  });
});
