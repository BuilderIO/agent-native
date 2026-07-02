import { describe, expect, it } from "vitest";

import {
  classifyClipsAsset,
  compareClipsReleaseTags,
} from "../server/routes/api/clips-latest.json.get";

describe("classifyClipsAsset", () => {
  it("recognizes Clips installer assets", () => {
    expect(classifyClipsAsset("Clips_0.1.56_universal.dmg")).toBe(
      "mac-universal",
    );
    expect(classifyClipsAsset("Clips_0.1.56_aarch64.dmg")).toBe("mac-arm64");
    expect(classifyClipsAsset("Clips_0.1.56_x64.dmg")).toBe("mac-x64");
    expect(classifyClipsAsset("Clips_0.1.56_x64_en-US.msi")).toBe(
      "windows-msi",
    );
  });

  it("ignores updater bundles and signatures", () => {
    expect(classifyClipsAsset("Clips_universal.app.tar.gz")).toBe("unknown");
    expect(classifyClipsAsset("Clips_0.1.56_x64_en-US.msi.sig")).toBe(
      "unknown",
    );
    expect(classifyClipsAsset("Clips_0.1.56_x64-setup.exe")).toBe("unknown");
    expect(classifyClipsAsset("latest.json")).toBe("unknown");
  });
});

describe("compareClipsReleaseTags", () => {
  it("orders releases by semantic version instead of lexical order", () => {
    expect(
      compareClipsReleaseTags("clips-v0.1.56", "clips-v0.1.9"),
    ).toBeGreaterThan(0);
    expect(
      compareClipsReleaseTags("clips-v0.2.0", "clips-v0.1.99"),
    ).toBeGreaterThan(0);
    expect(
      compareClipsReleaseTags("clips-v1.0.0", "clips-v0.99.999"),
    ).toBeGreaterThan(0);
  });
});
