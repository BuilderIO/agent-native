import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { prepareScreenshotPage } from "./screenshot-readiness.js";

function pageWithPendingImage(error: Error) {
  return {
    setContent: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(["https://example.test/pending.png"]),
    waitForFunction: vi.fn().mockRejectedValue(error),
  } as unknown as Page;
}

describe("screenshot readiness failure reporting", () => {
  it("preserves a non-timeout browser failure instead of reporting an image timeout", async () => {
    const failure = new Error("Execution context was destroyed");
    await expect(
      prepareScreenshotPage(pageWithPendingImage(failure), "<html></html>"),
    ).rejects.toBe(failure);
  });

  it("reports actual pending images when image readiness times out", async () => {
    const failure = new Error("Polling timed out");
    failure.name = "TimeoutError";
    await expect(
      prepareScreenshotPage(pageWithPendingImage(failure), "<html></html>"),
    ).rejects.toMatchObject({
      errorCode: "screenshot_images_unready",
      details: {
        pendingImages: ["https://example.test/pending.png"],
        cause: "Polling timed out",
      },
    });
  });
});
