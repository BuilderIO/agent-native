import { describe, expect, it } from "vitest";

import { shouldStopNativeHostPolling } from "./browser-control-host-policy.js";

describe("native browser host polling", () => {
  it.each([401, 404, 503])(
    "stops when the bridge returns terminal status %s",
    (status) => {
      expect(shouldStopNativeHostPolling(status)).toBe(true);
    },
  );

  it.each([200, 429, 500])("keeps retrying for status %s", (status) => {
    expect(shouldStopNativeHostPolling(status)).toBe(false);
  });
});
