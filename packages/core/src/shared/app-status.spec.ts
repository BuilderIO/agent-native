import { describe, expect, it } from "vitest";

import { APP_STATUS, getAppStatus } from "./app-status.js";

describe("getAppStatus", () => {
  it("defaults unknown and unmapped apps to alpha", () => {
    expect(getAppStatus("mail")).toBe("alpha");
    expect(getAppStatus("not-a-real-app")).toBe("alpha");
    expect(getAppStatus(undefined)).toBe("alpha");
  });

  it("returns the mapped status for apps listed in APP_STATUS", () => {
    for (const [appId, status] of Object.entries(APP_STATUS)) {
      expect(getAppStatus(appId)).toBe(status);
      expect(getAppStatus(appId.toUpperCase())).toBe(status);
    }
  });
});
