import { describe, expect, expectTypeOf, it } from "vitest";

import {
  PROGRESS_STATUSES,
  type ListRunsOptions,
  type ProgressRunScope,
} from "./types.js";

describe("progress types", () => {
  it("lists the run statuses in lifecycle order", () => {
    expect(PROGRESS_STATUSES).toEqual([
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ]);
  });

  it("lets list options carry an optional, nullable source app scope", () => {
    expectTypeOf<ListRunsOptions>().toExtend<ProgressRunScope>();
    expectTypeOf<ProgressRunScope["sourceAppId"]>().toEqualTypeOf<
      string | null | undefined
    >();
    const unscoped: ListRunsOptions = { activeOnly: true };
    const missingApp: ListRunsOptions = { sourceAppId: null };
    expect(unscoped.sourceAppId).toBeUndefined();
    expect(missingApp.sourceAppId).toBeNull();
  });
});
