import { describe, expect, it } from "vitest";

import { shouldDeferLineupRecenterToCameraCommand } from "./multi-screen/overview-layout";

describe("new-screen camera ownership", () => {
  it("suppresses the intermediate lineup recenter until the explicit fit runs", () => {
    expect(
      shouldDeferLineupRecenterToCameraCommand({
        cameraCommandNonce: 7,
        lastHandledCameraCommandNonce: 6,
      }),
    ).toBe(true);
  });

  it("allows ordinary recentering once the explicit camera command is handled", () => {
    expect(
      shouldDeferLineupRecenterToCameraCommand({
        cameraCommandNonce: 7,
        lastHandledCameraCommandNonce: 7,
      }),
    ).toBe(false);
    expect(
      shouldDeferLineupRecenterToCameraCommand({
        lastHandledCameraCommandNonce: null,
      }),
    ).toBe(false);
  });
});
