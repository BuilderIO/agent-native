import { describe, expect, it } from "vitest";
import {
  isPendingGenerationStale,
  PENDING_GENERATION_STALE_MS,
} from "./pending-generation";

describe("pending generation freshness", () => {
  it("keeps multi-minute design generations active", () => {
    const startedAt = 10_000;

    expect(
      isPendingGenerationStale({ startedAt }, startedAt + 5 * 60_000),
    ).toBe(false);
  });

  it("expires abandoned generation state after the orphan timeout", () => {
    const startedAt = 10_000;

    expect(
      isPendingGenerationStale(
        { startedAt },
        startedAt + PENDING_GENERATION_STALE_MS + 1,
      ),
    ).toBe(true);
  });
});
