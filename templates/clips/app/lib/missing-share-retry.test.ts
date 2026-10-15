import { describe, expect, it } from "vitest";

import { missingShareRetryDelayMs } from "./missing-share-retry";

describe("missingShareRetryDelayMs", () => {
  it("backs off while a share the loader could not find is still missing", () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((updateCount) =>
      missingShareRetryDelayMs({
        status: 404,
        updateCount,
        loaderFoundClip: false,
      }),
    );
    expect(delays).toEqual([250, 500, 1000, 2000, 2000, 2000, 2000]);
  });

  it("gives up after the retry limit", () => {
    expect(
      missingShareRetryDelayMs({
        status: 404,
        updateCount: 8,
        loaderFoundClip: false,
      }),
    ).toBeNull();
  });

  it("does not retry a 404 once the loader found the clip", () => {
    expect(
      missingShareRetryDelayMs({
        status: 404,
        updateCount: 1,
        loaderFoundClip: true,
      }),
    ).toBeNull();
  });

  it("does not retry other statuses", () => {
    for (const status of [200, 401, 403, 410, undefined]) {
      expect(
        missingShareRetryDelayMs({
          status,
          updateCount: 1,
          loaderFoundClip: false,
        }),
      ).toBeNull();
    }
  });
});
