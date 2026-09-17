import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertAgentNativePackageManifest } from "../../core/src/package-lifecycle/manifest.js";
import { MANIFEST } from "./manifest.js";

describe("scheduling package manifest", () => {
  it("keeps the published static manifest in parity with the typed manifest", () => {
    const file = fileURLToPath(
      new URL("../agent-native.package.json", import.meta.url),
    );
    const published = JSON.parse(fs.readFileSync(file, "utf8"));
    assertAgentNativePackageManifest(published);
    expect(published).toEqual(MANIFEST);
    expect(published.peerProviders).toContain("teams");
  });
});
