import { describe, expect, it } from "vitest";

import { buildStepFailureReport } from "./build-failure-report.js";
import { errorHint } from "./telemetry-sanitize.js";

describe("buildStepFailureReport", () => {
  it("keeps the template out of the message so one step is one issue", () => {
    const a = buildStepFailureReport({
      label: "react-router-build",
      exitCode: 1,
      signal: null,
    });
    const b = buildStepFailureReport({
      label: "react-router-build",
      exitCode: 2,
      signal: null,
      template: "content",
    });

    expect(a.error.message).toBe('Build step "react-router-build" failed');
    expect(b.error.message).toBe(a.error.message);
    expect(a.tags).toEqual({
      source: "build-step",
      buildStep: "react-router-build",
    });
    expect(b.tags).toMatchObject({ template: "content" });
  });

  it("reports a signal-killed step separately from a failed one", () => {
    const killed = buildStepFailureReport({
      label: "deploy-build",
      exitCode: 1,
      signal: "SIGKILL",
    });
    const failed = buildStepFailureReport({
      label: "deploy-build",
      exitCode: 1,
      signal: null,
    });

    expect(killed.error.message).toBe(
      'Build step "deploy-build" killed by SIGKILL',
    );
    expect(failed.error.message).toBe('Build step "deploy-build" failed');
    expect(killed.fingerprint).toEqual([
      "build-step",
      "deploy-build",
      "signal",
      "SIGKILL",
    ]);
    expect(failed.fingerprint).toEqual([
      "build-step",
      "deploy-build",
      "failed",
    ]);
  });

  it("groups each recognized termination signal separately and stably", () => {
    const report = (signal: string, template?: string) =>
      buildStepFailureReport({
        label: "deploy-build",
        exitCode: 1,
        signal,
        template,
      });
    const killed = report("SIGKILL");
    const terminated = report("SIGTERM");

    expect(killed.fingerprint).not.toEqual(terminated.fingerprint);
    expect(killed.fingerprint).toEqual([
      "build-step",
      "deploy-build",
      "signal",
      "SIGKILL",
    ]);
    expect(terminated.fingerprint).toEqual([
      "build-step",
      "deploy-build",
      "signal",
      "SIGTERM",
    ]);
    expect(report("SIGKILL", "content").fingerprint).toEqual(
      killed.fingerprint,
    );
    expect(report("SIGTERM", "content").fingerprint).toEqual(
      terminated.fingerprint,
    );
    expect(report("toString").fingerprint).toEqual([
      "build-step",
      "deploy-build",
      "signal",
    ]);
    expect(report("SIGKILL-private-value").fingerprint).toEqual([
      "build-step",
      "deploy-build",
      "signal",
    ]);
  });

  it("carries the exit code and signal", () => {
    const report = buildStepFailureReport({
      label: "deploy-build",
      exitCode: 1,
      signal: "SIGTERM",
    });

    // oracle-change: reports no longer carry stderr, stdout, the working directory or the child command
    expect(report.extra).toEqual({ exitCode: 1, signal: "SIGTERM" });
  });

  it("reports the whole message, since we wrote it", () => {
    const report = buildStepFailureReport({
      label: "deploy-build",
      exitCode: 1,
      signal: null,
    });

    expect(errorHint(report.error)).toBe('Build step "deploy-build" failed');
  });
});
