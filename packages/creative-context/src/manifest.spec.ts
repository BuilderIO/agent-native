import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { assertAgentNativePackageManifest } from "../../core/src/package-lifecycle/manifest.js";
import { creativeContextActions } from "./actions/index.js";
import { CREATIVE_CONTEXT_ACTIONS } from "./client/actions.js";

describe("published creative-context manifest", () => {
  it("keeps package action discovery in sync with the registered action map", () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        new URL("../agent-native.package.json", import.meta.url),
        "utf8",
      ),
    ) as { actions: string[] };

    expect(() => assertAgentNativePackageManifest(manifest)).not.toThrow();
    expect([...manifest.actions].sort()).toEqual(
      Object.keys(creativeContextActions).sort(),
    );
    for (const actionName of Object.values(CREATIVE_CONTEXT_ACTIONS)) {
      expect(manifest.actions).toContain(actionName);
    }
  });
});
