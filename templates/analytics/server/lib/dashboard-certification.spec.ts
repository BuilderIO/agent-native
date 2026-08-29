import { describe, expect, it } from "vitest";

import {
  certifyDashboardConfig,
  isDashboardCertified,
  readDashboardCertification,
} from "./dashboard-certification";

describe("dashboard certification", () => {
  const certification = {
    status: "certified" as const,
    certifiedAt: "2026-08-28T00:00:00.000Z",
    certifiedBy: "admin@example.com",
    certifiedForUpdatedAt: "v1",
  };

  it("is current only for the certified dashboard version", () => {
    const config = certifyDashboardConfig({ name: "Revenue" }, certification);
    expect(readDashboardCertification(config)).toEqual(certification);
    expect(isDashboardCertified(config, "v1")).toBe(true);
    expect(isDashboardCertified(config, "v2")).toBe(false);
  });

  it("rejects malformed certification metadata", () => {
    expect(
      readDashboardCertification({
        certification: { status: "certified", certifiedBy: "admin" },
      }),
    ).toBeNull();
  });
});
