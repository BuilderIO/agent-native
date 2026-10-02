import { describe, expect, it, vi } from "vitest";

import { uploadTargetAtStart } from "./upload-target";

describe("uploadTargetAtStart", () => {
  it("uses a target that settled during the countdown", async () => {
    const onLate = vi.fn();
    const target = Promise.resolve({ id: "srv-1" });
    await target;

    await expect(uploadTargetAtStart(target, onLate)).resolves.toEqual({
      id: "srv-1",
    });
    expect(onLate).not.toHaveBeenCalled();
  });

  it("starts capture at once when the storage status never answers", async () => {
    const hung = new Promise<{ id: string } | null>(() => {});

    const started = Date.now();
    await expect(uploadTargetAtStart(hung, vi.fn())).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("hands a row that opens after capture started over for cleanup", async () => {
    let open!: (value: { id: string } | null) => void;
    const slow = new Promise<{ id: string } | null>((resolve) => {
      open = resolve;
    });
    const onLate = vi.fn();

    await expect(uploadTargetAtStart(slow, onLate)).resolves.toBeNull();
    open({ id: "srv-late" });
    await vi.waitFor(() =>
      expect(onLate).toHaveBeenCalledWith({ id: "srv-late" }),
    );
  });
});
