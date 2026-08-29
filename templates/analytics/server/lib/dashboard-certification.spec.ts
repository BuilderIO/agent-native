import { describe, expect, it } from "vitest";

import {
  isDashboardCertified,
  parseDashboardCertification,
} from "./dashboard-certification";

describe("dashboard certification", () => {
  const certification = {
    status: "certified" as const,
    certifiedAt: "2026-08-28T00:00:00.000Z",
    certifiedBy: "admin@example.com",
    certifiedForUpdatedAt: "v1",
  };

  it("is current only for the certified dashboard version", () => {
    const parsed = parseDashboardCertification(JSON.stringify(certification));
    expect(parsed).toEqual({ status: "valid", certification });
    expect(
      isDashboardCertified(
        parsed.status === "valid" ? parsed.certification : undefined,
        "v1",
      ),
    ).toBe(true);
    expect(
      isDashboardCertified(
        parsed.status === "valid" ? parsed.certification : undefined,
        "v2",
      ),
    ).toBe(false);
  });

  it("distinguishes absent and unreadable certification metadata", () => {
    expect(parseDashboardCertification(undefined)).toEqual({
      status: "absent",
    });
    expect(parseDashboardCertification("not-json")).toEqual({
      status: "invalid",
    });
    expect(
      parseDashboardCertification({
        status: "certified",
        certifiedBy: "admin",
      }),
    ).toEqual({ status: "invalid" });
  });
});
