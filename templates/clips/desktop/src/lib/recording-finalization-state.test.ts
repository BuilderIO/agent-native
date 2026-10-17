import { describe, expect, it } from "vitest";

import {
  clearResolvedFinalizationError,
  RECORDING_FINALIZATION_IN_PROGRESS_MESSAGE,
} from "./recording-finalization-state";

describe("clearResolvedFinalizationError", () => {
  it("keeps the retry message while finalization is still active", () => {
    expect(
      clearResolvedFinalizationError(
        RECORDING_FINALIZATION_IN_PROGRESS_MESSAGE,
        true,
      ),
    ).toBe(RECORDING_FINALIZATION_IN_PROGRESS_MESSAGE);
  });

  it("clears the retry message after finalization settles", () => {
    expect(
      clearResolvedFinalizationError(
        RECORDING_FINALIZATION_IN_PROGRESS_MESSAGE,
        false,
      ),
    ).toBeNull();
  });

  it("preserves a real stop failure after finalization settles", () => {
    expect(clearResolvedFinalizationError("Finalize failed (500)", false)).toBe(
      "Finalize failed (500)",
    );
  });
});
