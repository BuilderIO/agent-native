import { afterEach, describe, expect, it } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { getObservabilityConfig } from "./traces.js";

describe("getObservabilityConfig", () => {
  afterEach(() => resetAppConfigForTests());

  it("serves declared defaults when nothing is configured", async () => {
    const config = await getObservabilityConfig();
    expect(config.aiTelemetryEnabled).toBe(true);
    expect(config.capturePrompts).toBe(false);
    expect(config.captureToolArgs).toBe(false);
    expect(config.captureToolResults).toBe(false);
    expect(config.captureLlmSpans).toBe(true);
    expect(config.evalSampleRate).toBe(0);
  });

  it("reads the declared field", async () => {
    defineAppConfig({
      observability: { captureToolArgs: true, evalSampleRate: 0.05 },
    });
    const config = await getObservabilityConfig();
    expect(config.captureToolArgs).toBe(true);
    expect(config.evalSampleRate).toBe(0.05);
  });

  it("honours the deprecated `enabled` spelling over the renamed field", async () => {
    // The schema strips unknown keys, so dropping `enabled` outright would
    // silently turn trace capture back on for an app that had switched it off.
    defineAppConfig({ observability: { enabled: false } });
    expect((await getObservabilityConfig()).aiTelemetryEnabled).toBe(false);
  });

  it("rejects a sample rate outside 0-1 at the call site that set it", () => {
    expect(() =>
      defineAppConfig({ observability: { evalSampleRate: 5 } }),
    ).toThrow();
  });

  it("touches no store, so it is not a database read on every agent turn", async () => {
    // Regression guard: this used to `getSetting("observability-config")` on
    // the agent hot path, inside a catch that made an outage and "never
    // configured" the same answer.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/observability/traces.ts", "utf8"),
    );
    expect(source).not.toContain("observability-config");
    const body = source.slice(
      source.indexOf("export async function getObservabilityConfig"),
    );
    expect(body.slice(0, body.indexOf("\n}"))).not.toContain("getSetting");
  });
});
