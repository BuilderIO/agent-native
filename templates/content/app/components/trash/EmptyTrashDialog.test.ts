import { describe, expect, it } from "vitest";

import type { ContentTrashPurgeInput } from "@/hooks/use-content-trash";

import { acceptTrashPlanSettlement } from "./EmptyTrashDialog";

describe("Trash purge confirmation planning", () => {
  it("ignores a plan that settles after close or a later gesture", () => {
    const first: ContentTrashPurgeInput = {
      mode: "selection",
      documentIds: ["first"],
    };
    const second: ContentTrashPurgeInput = {
      mode: "selection",
      documentIds: ["second"],
    };

    expect(acceptTrashPlanSettlement(null, first)).toBe(false);
    expect(acceptTrashPlanSettlement(second, first)).toBe(false);
    expect(acceptTrashPlanSettlement(second, second)).toBe(true);
  });
});
