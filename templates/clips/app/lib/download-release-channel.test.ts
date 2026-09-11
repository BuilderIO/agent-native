import { describe, expect, it } from "vitest";

import {
  BETA_CLIPS_HOSTNAME,
  getDefaultDownloadChannel,
} from "./download-release-channel";

describe("getDefaultDownloadChannel", () => {
  it("defaults beta Clips to Nightly", () => {
    expect(getDefaultDownloadChannel(BETA_CLIPS_HOSTNAME)).toBe("nightly");
  });

  it("normalizes the beta hostname", () => {
    expect(getDefaultDownloadChannel("BETA.CLIPS.AGENT-NATIVE.COM.")).toBe(
      "nightly",
    );
  });

  it("keeps production and local hosts on Stable", () => {
    expect(getDefaultDownloadChannel("clips.agent-native.com")).toBe(
      "production",
    );
    expect(getDefaultDownloadChannel("localhost")).toBe("production");
    expect(getDefaultDownloadChannel(undefined)).toBe("production");
  });
});
