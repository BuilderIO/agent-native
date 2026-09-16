import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getDb: vi.fn(),
  resolveAccess: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(),
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("../server/db/index.js", () => ({ getDb: mocks.getDb, schema: {} }));
vi.mock("../shared/source-mode.js", () => ({
  designSourceTypeFromData: () => "fusion",
}));

import {
  COMPONENT_ARCHIVE_ATTR,
  encodeComponentArchivePointer,
} from "../shared/component-archive.js";
import { COMPONENT_REF_ATTR } from "../shared/component-model.js";
import action from "./get-component-details.js";
import { canRestoreComponentMain } from "./get-component-details.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAccess.mockResolvedValue({ resource: { data: "{}" } });
  mocks.assertAccess.mockRejectedValue(new Error("editor access required"));
});

describe("get-component-details", () => {
  it("requires editor access before reading connected-app metadata", async () => {
    await expect(
      action.run(
        { designId: "design_1", nodeId: "node_1" } as never,
        {} as never,
      ),
    ).rejects.toThrow("editor access required");

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_1",
      "editor",
    );
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("exposes restore only for an instance with a matching valid archive pointer", () => {
    const archive = encodeComponentArchivePointer({
      schemaVersion: 1,
      versionId: "checkpoint-1",
      fileId: "file-main",
      componentId: "cmp-card",
      mainNodeId: "main-root",
      sourceVersionHash: "hash-main",
    });
    const node = (dataAttributes: Record<string, string>) =>
      ({ dataAttributes }) as never;

    expect(
      canRestoreComponentMain(
        node({
          [COMPONENT_REF_ATTR]: "cmp-card",
          [COMPONENT_ARCHIVE_ATTR]: archive,
        }),
      ),
    ).toBe(true);
    expect(
      canRestoreComponentMain(
        node({
          [COMPONENT_REF_ATTR]: "cmp-other",
          [COMPONENT_ARCHIVE_ATTR]: archive,
        }),
      ),
    ).toBe(false);
    expect(
      canRestoreComponentMain(
        node({
          [COMPONENT_REF_ATTR]: "cmp-card",
          [COMPONENT_ARCHIVE_ATTR]: encodeURIComponent("{}"),
        }),
      ),
    ).toBe(false);
    expect(canRestoreComponentMain(node({}))).toBe(false);
  });
});
