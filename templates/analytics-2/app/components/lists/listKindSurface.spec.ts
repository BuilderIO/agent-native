import { describe, expect, it } from "vitest";

import { listKindHasSurface } from "./listKindSurface";

/**
 * Row 221: /home/tasks has no surface while the shared automation model has no
 * schedule end date and no notification destination, and the list shell used to
 * import a Tasks workspace this app does not have.
 */
describe("listKindHasSurface", () => {
  it("reports no tasks surface until the automation model carries end dates and recipients", () => {
    expect(listKindHasSurface("tasks")).toBe(false);
  });

  it("keeps the project, thread, exploration and data surfaces", () => {
    for (const kind of ["projects", "threads", "explorations", "data"]) {
      expect(listKindHasSurface(kind)).toBe(true);
    }
  });

  it("leaves an unknown kind to the live route, which renders its own not-found state", () => {
    expect(listKindHasSurface("nope")).toBe(true);
    expect(listKindHasSurface(undefined)).toBe(true);
  });
});
