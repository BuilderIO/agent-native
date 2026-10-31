import { afterEach, describe, expect, it, vi } from "vitest";

import { getAppConfig, resetAppConfigForTests } from "../app-config/index.js";

vi.mock("@agent-native/core/server", async () => {
  const { defineAppConfig } = await import("../app-config/index.js");
  return { defineAppConfig };
});

const plugins = {
  design: () => import("../../../../templates/design/server/plugins/config.js"),
  slides: () => import("../../../../templates/slides/server/plugins/config.js"),
  clips: () => import("../../../../templates/clips/server/plugins/config.js"),
};

describe("template first-run credits configuration", () => {
  afterEach(() => {
    delete process.env.FIRST_RUN_CREDITS_EXPERIMENT;
    resetAppConfigForTests();
    vi.resetModules();
  });

  it.each(Object.entries(plugins))(
    "uses v2 by default and honors the v1 kill switch in %s",
    async (_app, loadPlugin) => {
      delete process.env.FIRST_RUN_CREDITS_EXPERIMENT;
      resetAppConfigForTests();
      await loadPlugin();
      const current = () => {
        const onboarding = getAppConfig().onboarding;
        return (
          onboarding.firstRunCreditsExperimentOverride ??
          onboarding.firstRunCreditsExperiment
        );
      };
      expect(current()).toBe("v2");
      process.env.FIRST_RUN_CREDITS_EXPERIMENT = "v1";
      expect(current()).toBe("v1");
    },
  );
});
