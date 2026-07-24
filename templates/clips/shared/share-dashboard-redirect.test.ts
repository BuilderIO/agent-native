import { describe, expect, it } from "vitest";

import { CLIP_SHARE_REF, REF_PARAM } from "./share-attribution.js";
import { resolveDashboardRedirect } from "./share-dashboard-redirect.js";

describe("resolveDashboardRedirect", () => {
  it("stays on the share page when the viewer cannot open the dashboard", () => {
    expect(
      resolveDashboardRedirect({
        recordingId: "rec_1",
        canOpenDashboard: false,
        search: "",
      }),
    ).toBeNull();
  });

  it("stays put for anonymous visitors with no recording yet", () => {
    expect(
      resolveDashboardRedirect({
        recordingId: null,
        canOpenDashboard: true,
        search: "",
      }),
    ).toBeNull();
  });

  it("redirects an eligible viewer to the dashboard", () => {
    expect(
      resolveDashboardRedirect({
        recordingId: "rec_1",
        canOpenDashboard: true,
        search: "",
      }),
    ).toBe("/r/rec_1");
  });

  it("does not bounce back when /r already redirected here", () => {
    expect(
      resolveDashboardRedirect({
        recordingId: "rec_1",
        canOpenDashboard: true,
        search: `?${REF_PARAM}=${CLIP_SHARE_REF}`,
      }),
    ).toBeNull();
  });

  it("forwards deep-link params and drops everything else", () => {
    expect(
      resolveDashboardRedirect({
        recordingId: "rec_1",
        canOpenDashboard: true,
        search: "?t=1500&panel=transcript&agent_access=secret&via=slack",
      }),
    ).toBe("/r/rec_1?t=1500&panel=transcript");
  });

  it("never forwards a share access token to the authenticated route", () => {
    const target = resolveDashboardRedirect({
      recordingId: "rec_1",
      canOpenDashboard: true,
      search: "?agent_access=secret-token",
    });
    expect(target).toBe("/r/rec_1");
    expect(target).not.toContain("secret-token");
  });

  it("encodes recording ids that need escaping", () => {
    expect(
      resolveDashboardRedirect({
        recordingId: "rec/1 2",
        canOpenDashboard: true,
        search: "",
      }),
    ).toBe("/r/rec%2F1%202");
  });
});
