import { ActionContractError } from "@agent-native/core/action";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertBuilder: vi.fn(),
  getBuilder: vi.fn(),
  resolveAccess: vi.fn(),
  assertAccess: vi.fn(),
}));
vi.mock("@agent-native/core/server/builder-dsi-access", async (original) => ({
  ...(await original<
    typeof import("@agent-native/core/server/builder-dsi-access")
  >()),
  assertBuilderDsiAccess: mocks.assertBuilder,
  getBuilderDsiAccess: mocks.getBuilder,
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: mocks.resolveAccess,
  assertAccess: mocks.assertAccess,
}));

import {
  assertDesignSystemAccess,
  assertDesignSystemDsiAccess,
  filterAccessibleDesignSystems,
  resolveDesignSystemAccess,
} from "./design-system-dsi-access.js";

const legacy = { id: "local", data: '{"colors":{"primary":"example-color"}}' };
const indexed = {
  id: "dsi",
  data: '{"source":"builder","builderDesignSystemId":"example-dsi"}',
};
const authored = {
  id: "authored",
  data: '{"authoring":{"systemId":"authored"}}',
};
const denied = new ActionContractError("Connect your own Builder account", {
  errorCode: "builder_dsi_missing",
  statusCode: 403,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertBuilder.mockRejectedValue(denied);
  mocks.getBuilder.mockResolvedValue({ status: "missing", eligible: false });
});

describe("design-system DSI server boundary", () => {
  it.each([indexed, authored])(
    "denies cached $id data even when the resource is shared with the caller",
    async (row) => {
      mocks.resolveAccess.mockResolvedValue({ role: "viewer", resource: row });
      await expect(resolveDesignSystemAccess(row.id)).rejects.toBe(denied);
      expect(mocks.resolveAccess).toHaveBeenCalledWith("design-system", row.id);
      expect(mocks.assertBuilder).toHaveBeenCalledWith();
    },
  );

  it("preserves the resource access boundary before checking account eligibility", async () => {
    mocks.resolveAccess.mockResolvedValue(null);
    await expect(resolveDesignSystemAccess("not-shared")).resolves.toBeNull();
    mocks.assertAccess.mockRejectedValue(new Error("resource denied"));
    await expect(
      assertDesignSystemAccess(indexed.id, "editor"),
    ).rejects.toThrow("resource denied");
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design-system",
      indexed.id,
      "editor",
    );
    expect(mocks.assertBuilder).not.toHaveBeenCalled();
  });

  it("does not gate unrelated curated or local systems", async () => {
    const access = { role: "owner", resource: legacy };
    mocks.resolveAccess.mockResolvedValue(access);
    mocks.assertAccess.mockResolvedValue(access);
    await expect(resolveDesignSystemAccess(legacy.id)).resolves.toBe(access);
    await expect(assertDesignSystemAccess(legacy.id, "editor")).resolves.toBe(
      access,
    );
    await assertDesignSystemDsiAccess(null);
    expect(mocks.assertBuilder).not.toHaveBeenCalled();
  });

  it("returns the original scoped resource only after the current personal-account assertion succeeds", async () => {
    mocks.assertBuilder.mockResolvedValue({ status: "ready", eligible: true });
    const access = { role: "editor", resource: indexed };
    mocks.assertAccess.mockResolvedValue(access);
    await expect(assertDesignSystemAccess(indexed.id, "editor")).resolves.toBe(
      access,
    );
    expect(mocks.assertBuilder).toHaveBeenCalledOnce();
  });

  it("does not turn unreadable provenance into a local-system bypass", async () => {
    await expect(assertDesignSystemDsiAccess("{broken")).rejects.toMatchObject({
      errorCode: "design_system_data_invalid",
      statusCode: 409,
    });
  });

  it.each(["missing", "reconnect_required", "unauthenticated"])(
    "omits DSI caches from mixed catalogs when account status is %s",
    async (status) => {
      mocks.getBuilder.mockResolvedValue({ status });
      await expect(
        filterAccessibleDesignSystems([legacy, indexed, authored]),
      ).resolves.toEqual([legacy]);
      expect(mocks.getBuilder).toHaveBeenCalledOnce();
    },
  );

  it("reports an unreadable account store instead of pretending a DSI catalog is empty", async () => {
    mocks.getBuilder.mockResolvedValue({
      status: "unavailable",
      eligible: null,
      reason: "store_unavailable",
    });
    await expect(
      filterAccessibleDesignSystems([indexed]),
    ).rejects.toMatchObject({
      errorCode: "builder_dsi_unavailable",
      statusCode: 503,
    });
  });

  it("returns a local-only catalog without requiring Builder and preserves eligible DSI rows", async () => {
    await expect(filterAccessibleDesignSystems([legacy])).resolves.toEqual([
      legacy,
    ]);
    expect(mocks.getBuilder).not.toHaveBeenCalled();
    mocks.getBuilder.mockResolvedValue({ status: "ready", eligible: true });
    mocks.assertBuilder.mockResolvedValue({ status: "ready", eligible: true });
    await expect(
      filterAccessibleDesignSystems([legacy, indexed]),
    ).resolves.toEqual([legacy, indexed]);
  });

  it("does not return cached DSI rows when a refreshable account fails the execution assertion", async () => {
    mocks.getBuilder.mockResolvedValue({ status: "ready", eligible: true });
    await expect(filterAccessibleDesignSystems([indexed])).rejects.toBe(denied);
  });
});
