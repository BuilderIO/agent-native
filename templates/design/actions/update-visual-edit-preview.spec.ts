import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: "owner@example.test" as string | undefined,
  assertAccess: vi.fn(),
  data: {} as Record<string, unknown>,
  stored: undefined as Record<string, unknown> | undefined,
}));
vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
  fail: (message: string, details: unknown) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.email,
  getRequestContext: () => ({ requestOrigin: "https://design.example.test" }),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  accessFilter: () => ({ scope: "editor" }),
  currentAccess: () => ({
    userEmail: mocks.email,
    authCapability: "local-capability",
  }),
}));
vi.mock("../server/db/index.js", () => ({
  schema: { designs: { id: "id", data: "data" } },
}));
vi.mock("../server/source-workspace.js", () => ({
  withDesignSourceMutationTransaction: async (
    _id: string,
    run: (tx: unknown) => Promise<void>,
  ) => {
    const selection = {
      from: () => selection,
      where: () => selection,
      for: () => selection,
      limit: async () => [{ data: JSON.stringify(mocks.data) }],
    };
    const update = {
      set: (value: { data: string }) => {
        mocks.stored = JSON.parse(value.data);
        return update;
      },
      where: () => update,
      returning: async () => [{ id: "design-one" }],
    };
    return run({ select: () => selection, update: () => update });
  },
}));
import action from "./update-visual-edit-preview";

beforeEach(() => {
  mocks.email = "owner@example.test";
  mocks.assertAccess.mockReset().mockResolvedValue({ role: "editor" });
  mocks.data = {
    screenMetadata: {
      local: { sourceType: "localhost", url: "http://localhost:5173/flow" },
      peer: { title: "Keep" },
    },
    tweaks: [{ id: "speed" }],
  };
  mocks.stored = undefined;
});
it("persists only the selected localhost mapping without replacing peer state", async () => {
  await expect(
    action.run({
      designId: "design-one",
      fileId: "local",
      tunnelUrl: "https://demo.ngrok-free.app/",
    }),
  ).resolves.toMatchObject({ tunnelUrl: "https://demo.ngrok-free.app" });
  expect(mocks.stored).toEqual({
    ...mocks.data,
    screenMetadata: {
      local: {
        sourceType: "localhost",
        url: "http://localhost:5173/flow",
        tunnelUrl: "https://demo.ngrok-free.app",
      },
      peer: { title: "Keep" },
    },
  });
  expect(mocks.assertAccess).toHaveBeenCalledWith(
    "design",
    "design-one",
    "editor",
    { userEmail: "owner@example.test", authCapability: undefined },
  );
});
it("denies signed-out local capabilities and non-editors before storing anything", async () => {
  mocks.email = undefined;
  await expect(
    action.run({ designId: "design-one", fileId: "local", tunnelUrl: null }),
  ).rejects.toMatchObject({ errorCode: "visual_edit_account_required" });
  expect(mocks.stored).toBeUndefined();
  mocks.email = "viewer@example.test";
  mocks.assertAccess.mockRejectedValueOnce(new Error("Requires editor"));
  await expect(
    action.run({ designId: "design-one", fileId: "local", tunnelUrl: null }),
  ).rejects.toThrow("Requires editor");
  expect(mocks.stored).toBeUndefined();
});
it("rejects an inline screen without writing a tunnel", async () => {
  await expect(
    action.run({
      designId: "design-one",
      fileId: "peer",
      tunnelUrl: "https://demo.ngrok-free.app",
    }),
  ).rejects.toMatchObject({ errorCode: "not_localhost_screen" });
  expect(mocks.stored).toBeUndefined();
});
