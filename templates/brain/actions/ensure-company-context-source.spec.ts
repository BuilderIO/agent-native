import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  createSource: vi.fn(),
  isBrainAdmin: vi.fn(),
  getRequestOrgId: vi.fn(() => "org-1"),
  getRequestUserEmail: vi.fn(() => "admin@example.test"),
  rows: [] as unknown[][],
  updateSet: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.rows.shift() ?? [] }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        mocks.updateSet(values);
        return { where: async () => undefined };
      },
    }),
  }),
  schema: { brainSources: { id: "id", orgId: "orgId" } },
}));

vi.mock("../server/lib/brain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/brain.js")>()),
  createSource: mocks.createSource,
  serializeSource: (source: { id: string }) => ({ id: source.id }),
}));

vi.mock("../server/lib/zoom-governance.js", () => ({
  isBrainAdmin: mocks.isBrainAdmin,
}));

import { isCompanyContextIntakeSource } from "../server/lib/brain.js";
import ensureAction from "./ensure-company-context-source.js";

const ensure = ensureAction as unknown as { run: () => Promise<unknown> };

const intake = (overrides: Record<string, unknown> = {}) => ({
  id: "company-context-org-1",
  orgId: "org-1",
  status: "active",
  visibility: "org",
  configJson: '{"companyContextIntake":true}',
  ...overrides,
});

describe("ensure-company-context-source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.isBrainAdmin.mockResolvedValue(true);
    mocks.assertAccess.mockImplementation(async () => ({
      resource: intake(),
    }));
  });

  it("rejects non-admins with a non-Zoom message", async () => {
    mocks.isBrainAdmin.mockResolvedValue(false);
    await expect(ensure.run()).rejects.toMatchObject({
      message: expect.not.stringMatching(/zoom/i),
      errorCode: "brain_admin_required",
    });
    expect(mocks.createSource).not.toHaveBeenCalled();
  });

  it("creates one org-visible source under the deterministic id", async () => {
    mocks.rows = [[], [intake()]];
    mocks.createSource.mockResolvedValue(intake());
    await expect(ensure.run()).resolves.toEqual({
      created: true,
      source: { id: "company-context-org-1" },
    });
    expect(mocks.createSource).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "company-context-org-1",
        visibility: "org",
        config: { companyContextIntake: true },
      }),
    );
  });

  it("reuses the existing source", async () => {
    mocks.rows = [[intake()]];
    await expect(ensure.run()).resolves.toMatchObject({ created: false });
    expect(mocks.createSource).not.toHaveBeenCalled();
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "brain-source",
      "company-context-org-1",
      "editor",
    );
  });

  it("reuses the concurrently created source when insert collides", async () => {
    mocks.rows = [[], [intake()], [intake()]];
    mocks.createSource.mockRejectedValue(new Error("duplicate key"));
    await expect(ensure.run()).resolves.toMatchObject({ created: false });
  });

  it("restores a source that was made private or archived", async () => {
    for (const overrides of [
      { visibility: "private" },
      { status: "archived" },
    ]) {
      mocks.updateSet.mockClear();
      mocks.rows = [[intake(overrides)]];
      await expect(ensure.run()).resolves.toMatchObject({ created: false });
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "active", visibility: "org" }),
      );
    }
  });

  it("does not touch an intact source", async () => {
    mocks.rows = [[intake()]];
    await ensure.run();
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });
});

describe("isCompanyContextIntakeSource", () => {
  it("requires both the deterministic id and the marker", () => {
    expect(isCompanyContextIntakeSource(intake())).toBe(true);
    expect(isCompanyContextIntakeSource(intake({ id: "other" }))).toBe(false);
    expect(isCompanyContextIntakeSource(intake({ orgId: "org-2" }))).toBe(
      false,
    );
    expect(isCompanyContextIntakeSource(intake({ configJson: "{}" }))).toBe(
      false,
    );
  });
});
