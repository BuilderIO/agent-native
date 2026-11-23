import { describe, expect, it } from "vitest";

import createProject from "./create-project.js";
import listLibraryApps from "./list-library-apps.js";

const caller = { caller: "frontend" } as const;

describe("report A2-ACTION-VALIDATION-PATHS", () => {
  it.each([
    [{ afterUpdatedAt: "2026-01-01" }, "afterId"],
    [{ afterId: "project-1" }, "afterUpdatedAt"],
  ])("identifies the missing cursor field for %o", async (input, field) => {
    await expect(listLibraryApps.run(input, caller)).rejects.toThrow(
      `Invalid action parameters — ${field}:`,
    );
  });

  it("identifies cells when combined with a sample dataset", async () => {
    await expect(
      createProject.run({ cells: [], sampleDataset: "orders" }, caller),
    ).rejects.toThrow("Invalid action parameters — cells:");
  });
});
