import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createAgentNativeConfigContext,
  loadResolvedAgentNativeConfig,
} from "../../packages/core/src/vite/agent-native-config-loader.js";

const planRoot = path.dirname(fileURLToPath(import.meta.url));

describe("Plan onboarding config", () => {
  it("keeps first-run onboarding off for production builds", async () => {
    const config = await loadResolvedAgentNativeConfig(
      planRoot,
      createAgentNativeConfigContext("build", "production"),
      { loadProjectConfig: false },
    );

    expect(config.onboarding?.firstRun).toBe("off");
  });
});
