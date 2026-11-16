import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: "owner@example.test" as string | undefined,
  assertAccess: vi.fn(),
  data: {} as Record<string, unknown>,
  stored: undefined as Record<string, unknown> | undefined,
  blockedByDns: vi.fn(),
  columns: {} as Record<string, unknown>,
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  isBlockedExtensionUrlWithDns: mocks.blockedByDns,
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
  schema: {
    designs: {
      id: "id",
      data: "data",
      liveCollaborationEnabled: "liveCollaborationEnabled",
    },
  },
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
      limit: async () => [
        { data: JSON.stringify(mocks.data), liveCollaborationEnabled: false },
      ],
    };
    const update = {
      set: (value: Record<string, unknown> & { data: string }) => {
        mocks.columns = value;
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
  mocks.columns = {};
  mocks.blockedByDns.mockReset().mockResolvedValue(false);
});
it("persists only the selected localhost mapping without replacing peer state", async () => {
  await expect(
    action.run({
      designId: "design-one",
      fileId: "local",
      tunnelUrl: "https://demo.ngrok-free.app/",
    }),
  ).resolves.toMatchObject({ tunnelUrl: "https://demo.ngrok-free.app" });
  expect(mocks.columns).not.toHaveProperty("liveCollaborationEnabled");
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
it("enables design-wide collaboration only when the owner explicitly opts in", async () => {
  await expect(
    action.run({
      designId: "design-one",
      fileId: "local",
      tunnelUrl: "https://demo.ngrok-free.app",
      enableLiveCollaboration: true,
    }),
  ).resolves.toMatchObject({ liveCollaborationEnabled: true });
  expect(mocks.columns).toMatchObject({ liveCollaborationEnabled: true });
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
it("rejects a hostname that resolves to a private address before storing it", async () => {
  mocks.blockedByDns.mockResolvedValue(true);
  await expect(
    action.run({
      designId: "design-one",
      fileId: "local",
      tunnelUrl: "https://intranet-alias.example.com",
    }),
  ).rejects.toMatchObject({ errorCode: "private_tunnel_address" });
  expect(mocks.blockedByDns).toHaveBeenCalledWith(
    "https://intranet-alias.example.com",
  );
  expect(mocks.stored).toBeUndefined();
});
it.each(["https://service.internal", "https://router.lan", "https://intranet"])(
  "rejects the private-network name %s without a lookup",
  async (tunnelUrl) => {
    await expect(
      action.run({ designId: "design-one", fileId: "local", tunnelUrl }),
    ).rejects.toThrow("public HTTPS preview hostname");
    expect(mocks.blockedByDns).not.toHaveBeenCalled();
    expect(mocks.stored).toBeUndefined();
  },
);
