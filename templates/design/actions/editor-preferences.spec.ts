import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  email: "member@example.com" as string | null,
  stored: null as unknown,
  mutate: vi.fn(
    async (
      _email: string,
      _key: string,
      updater: (
        current: Record<string, unknown> | null,
      ) => Record<string, unknown>,
    ) => {
      state.stored = updater(state.stored as Record<string, unknown> | null);
      return state.stored as Record<string, unknown>;
    },
  ),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options: { statusCode: number }) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => state.email,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: async () => state.stored,
  mutateUserSetting: state.mutate,
}));

const [{ default: getAction }, { default: updateAction }] = await Promise.all([
  import("./get-editor-preferences"),
  import("./update-editor-preferences"),
]);

describe("Design editor preference actions", () => {
  beforeEach(() => {
    state.email = "member@example.com";
    state.stored = null;
    state.mutate.mockClear();
  });

  it("reads an absent override as inheritance", async () => {
    await expect((getAction as any).run({})).resolves.toEqual({
      nativeShaderPreview: null,
    });
  });

  it("persists a user-scoped policy while preserving sibling settings", async () => {
    state.stored = { futurePreference: "preserved" };
    const nativeShaderPreview = {
      quality: "performance",
      frameRateTarget: 120,
      colorMode: "display-p3",
      dynamicRange: "hdr",
    };

    await expect(
      (updateAction as any).run({ nativeShaderPreview }),
    ).resolves.toEqual({ nativeShaderPreview });
    expect(state.mutate).toHaveBeenCalledWith(
      "member@example.com",
      "design-editor-preferences",
      expect.any(Function),
    );
    await expect((getAction as any).run({})).resolves.toEqual({
      nativeShaderPreview,
    });
    expect(
      (state.stored as Record<string, unknown> | null)?.futurePreference,
    ).toBe("preserved");
  });

  it("clears the override without deleting sibling preferences", async () => {
    state.stored = {
      futurePreference: "preserved",
      nativeShaderPreview: { quality: "quality", frameRateTarget: 60 },
    };
    await expect(
      (updateAction as any).run({ nativeShaderPreview: null }),
    ).resolves.toEqual({ nativeShaderPreview: null });
    expect(state.stored).toEqual({
      futurePreference: "preserved",
      nativeShaderPreview: null,
    });
  });

  it.each(["corrupt", 12, []])(
    "rejects malformed stored setting containers: %j",
    async (value) => {
      state.stored = value;
      await expect((getAction as any).run({})).rejects.toMatchObject({
        errorCode: "design_editor_preferences_invalid",
        statusCode: 500,
      });
      await expect(
        (updateAction as any).run({ nativeShaderPreview: null }),
      ).rejects.toMatchObject({
        errorCode: "design_editor_preferences_invalid",
        statusCode: 500,
      });
      expect(state.stored).toEqual(value);
    },
  );

  it("rejects unauthenticated reads and writes", async () => {
    state.email = null;
    await expect((getAction as any).run({})).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(
      (updateAction as any).run({ nativeShaderPreview: null }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("rejects invalid policies and extra input fields", () => {
    expect(
      (updateAction as any).schema.safeParse({
        nativeShaderPreview: { quality: "fast", frameRateTarget: 60 },
      }).success,
    ).toBe(false);
    expect(
      (updateAction as any).schema.safeParse({
        nativeShaderPreview: { quality: "auto", frameRateTarget: 60 },
        userEmail: "other@example.com",
        designId: "design-1",
        fileId: "file-1",
      }).success,
    ).toBe(false);
  });
});
