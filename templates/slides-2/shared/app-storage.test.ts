import { describe, expect, it } from "vitest";

import { appStorageKey } from "./app-storage";

describe("Slides 2 browser storage keys", () => {
  it("adds an idempotent app namespace", () => {
    expect(appStorageKey("composer-draft")).toBe("slides-2:composer-draft");
    expect(appStorageKey("slides-2:composer-draft")).toBe(
      "slides-2:composer-draft",
    );
  });
});
