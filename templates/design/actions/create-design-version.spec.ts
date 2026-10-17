import { describe, expect, it, vi } from "vitest";

const createDesignVersionSnapshotWithSourceMutationLock = vi.hoisted(() =>
  vi.fn(),
);

vi.mock("../server/lib/design-versions.js", () => ({
  createDesignVersionSnapshotWithSourceMutationLock,
}));

import action from "./create-design-version.js";

describe("create-design-version", () => {
  it("uses the source-locked snapshot writer for the public editor action", async () => {
    createDesignVersionSnapshotWithSourceMutationLock.mockResolvedValue({
      id: "version-1",
      createdAt: "2026-10-11T12:00:00.000Z",
      label: "Before editor screen delete",
    });

    await expect(action.run({ designId: "design-1" })).resolves.toMatchObject({
      id: "version-1",
    });
    expect(
      createDesignVersionSnapshotWithSourceMutationLock,
    ).toHaveBeenCalledWith("design-1", {
      label: "Before editor screen delete",
      chatContext: { surface: "editor", actionName: "delete-file" },
    });
  });
});
