import { beforeEach, describe, expect, it, vi } from "vitest";

const { registerRecurringSweepHandler, sweepOrphanedUploadedAssetObjects } =
  vi.hoisted(() => ({
    registerRecurringSweepHandler: vi.fn(),
    sweepOrphanedUploadedAssetObjects: vi.fn(),
  }));

vi.mock("@agent-native/core/server", () => ({
  registerRecurringSweepHandler,
}));

vi.mock("../handlers/assets.js", () => ({
  sweepOrphanedUploadedAssetObjects,
}));

import registerOrphanedAssetCleanup from "./orphaned-asset-cleanup";

beforeEach(() => {
  registerRecurringSweepHandler.mockReset();
  registerRecurringSweepHandler.mockReturnValue(vi.fn());
  sweepOrphanedUploadedAssetObjects.mockReset();
});

describe("orphaned asset cleanup plugin", () => {
  it("registers the bounded retry sweep and unregisters it when Nitro closes", () => {
    const removeHandler = vi.fn();
    const onClose = vi.fn();
    registerRecurringSweepHandler.mockReturnValue(removeHandler);
    registerOrphanedAssetCleanup({
      hooks: {
        hook: (_name: string, callback: () => void) =>
          onClose.mockImplementation(callback),
      },
    });

    expect(registerRecurringSweepHandler).toHaveBeenCalledWith(
      "slides-2-orphaned-asset-cleanup",
      sweepOrphanedUploadedAssetObjects,
    );
    onClose();
    expect(removeHandler).toHaveBeenCalledOnce();
  });
});
