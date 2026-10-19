import { describe, expect, it } from "vitest";

import { planNativeWorkerBackdropRoute } from "./native-worker-backdrop-route";

describe("native worker backdrop source routing", () => {
  it("uses a sibling Glass target source even while composing the root scene", () => {
    expect(planNativeWorkerBackdropRoute(undefined, undefined)).toBe(
      "target-source",
    );
    expect(planNativeWorkerBackdropRoute(undefined, "wave-fill")).toBe(
      "target-source",
    );
  });

  it("stages a Layer child against its owner and reuses that output elsewhere", () => {
    expect(planNativeWorkerBackdropRoute("wave-layer", "wave-layer")).toBe(
      "group-local",
    );
    expect(planNativeWorkerBackdropRoute("wave-layer", undefined)).toBe(
      "owner-output",
    );
  });
});
