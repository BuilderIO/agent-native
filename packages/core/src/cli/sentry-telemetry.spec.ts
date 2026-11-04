import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userHome = os.homedir();

afterEach(() => {
  vi.doUnmock("../shared/optional-peer.js");
  vi.resetModules();
});

describe("CLI Sentry telemetry", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "an-cli-sentry-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DO_NOT_TRACK", "");
    vi.stubEnv("AGENT_NATIVE_TELEMETRY_DISABLED", "");
    vi.stubEnv("AGENT_NATIVE_TELEMETRY_DEBUG", "");
    vi.stubEnv("CI", "");
    vi.stubEnv("GITHUB_ACTIONS", "");
    vi.stubEnv("GITLAB_CI", "");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function missingPeer() {
    const state = { loads: 0 };
    class MissingPeerError extends Error {
      readonly code = "ERR_AGENT_NATIVE_OPTIONAL_PEER";
      readonly packageName = "@sentry/node";
    }
    vi.doMock("../shared/optional-peer.js", () => ({
      OptionalPeerDependencyError: MissingPeerError,
      loadOptionalPeer: async () => {
        state.loads++;
        throw new MissingPeerError(
          "This feature requires optional peer @sentry/node. Install it with `pnpm add @sentry/node`.",
        );
      },
    }));
    return state;
  }

  it("reports the missing optional peer once without rejecting the command path", async () => {
    const peer = missingPeer();
    const stderr = { write: vi.fn(() => true) };
    const { captureSentryException } = await import("./sentry-telemetry.js");
    expect(peer.loads).toBe(0);

    await expect(
      captureSentryException(new Error("command failed"), undefined, stderr),
    ).resolves.toBeUndefined();
    await captureSentryException(
      new Error("another command failed"),
      undefined,
      stderr,
    );

    expect(peer.loads).toBe(1);
    expect(stderr.write).toHaveBeenCalledTimes(1);
    expect(stderr.write.mock.calls[0]?.[0]).toContain(
      "requires optional peer @sentry/node",
    );
  });

  it.each([
    ["DO_NOT_TRACK", "1"],
    ["AGENT_NATIVE_TELEMETRY_DISABLED", "1"],
  ])("never loads the SDK when %s=%s", async (name, value) => {
    vi.stubEnv(name, value);
    const peer = missingPeer();
    const { captureSentryException } = await import("./sentry-telemetry.js");

    await captureSentryException(new Error("boom"));

    expect(peer.loads).toBe(0);
  });

  it("never loads the SDK after telemetry disable", async () => {
    const peer = missingPeer();
    const { setTelemetryEnabled } = await import("./telemetry-settings.js");
    setTelemetryEnabled(false);
    const { captureSentryException } = await import("./sentry-telemetry.js");

    await captureSentryException(new Error("boom"));

    expect(peer.loads).toBe(0);
  });

  it("prints the report in debug mode and never loads the SDK", async () => {
    vi.stubEnv("AGENT_NATIVE_TELEMETRY_DEBUG", "1");
    const peer = missingPeer();
    const { captureSentryException } = await import("./sentry-telemetry.js");

    await captureSentryException(new Error("/home/ada/acme: boom"), {
      tags: { source: "process" },
    });

    expect(peer.loads).toBe(0);
    const printed = vi.mocked(process.stderr.write).mock.calls.flat().join("");
    expect(printed).toContain('[telemetry] {"event":"sentry"');
    expect(printed).not.toContain("/home/ada/acme");
  });

  it("prints the notice before a first report", async () => {
    missingPeer();
    const { captureSentryException } = await import("./sentry-telemetry.js");

    await captureSentryException(new Error("boom"), undefined, {
      write: () => true,
    });

    expect(
      vi.mocked(process.stderr.write).mock.calls.flat().join(""),
    ).toContain("Agent-Native collects anonymous usage data.");
  });

  it("drops a report when telemetry is turned off before Sentry sends it", async () => {
    let beforeSend: ((event: object, hint: object) => unknown) | undefined;
    vi.doMock("../shared/optional-peer.js", () => ({
      OptionalPeerDependencyError: class extends Error {},
      loadOptionalPeer: async () => ({
        init: (options: { beforeSend: typeof beforeSend }) => {
          beforeSend = options.beforeSend;
        },
        captureException: vi.fn(),
      }),
    }));
    const { captureSentryException } = await import("./sentry-telemetry.js");
    const { setTelemetryEnabled } = await import("./telemetry-settings.js");
    await captureSentryException(new Error("boom"));
    expect(beforeSend?.({}, {})).not.toBeNull();

    setTelemetryEnabled(false);

    expect(beforeSend?.({}, {})).toBeNull();
  });

  it("sends the real SDK's report with no hostname, path, log or identity", async () => {
    const sent: string[] = [];
    const realSentry = await import("@sentry/node");
    vi.doMock("../shared/optional-peer.js", () => ({
      OptionalPeerDependencyError: class extends Error {},
      loadOptionalPeer: async () => ({
        ...realSentry,
        init: (options: Parameters<typeof realSentry.init>[0]) =>
          realSentry.init({
            ...options,
            transport: () => ({
              send: async (envelope: unknown) => {
                sent.push(JSON.stringify(envelope));
                return {};
              },
              flush: async () => true,
            }),
          }),
      }),
    }));
    vi.stubEnv("BUILDER_USER_ID", "builder-user-secret");
    vi.stubEnv("BUILDER_PUBLIC_KEY", "builder-space-secret");
    vi.stubEnv("SENTRY_ENVIRONMENT", "acme-secret-environment");
    vi.stubEnv("SENTRY_RELEASE", "acme-secret-release");
    const argv = process.argv;
    process.argv = [...argv.slice(0, 2), "fix the acme-secret billing bug"];
    realSentry.addBreadcrumb({ message: "acme-secret console log" });

    try {
      const { captureSentryException, flushSentryTelemetry } =
        await import("./sentry-telemetry.js");
      const projectPath = path.join(userHome, "work", "acme-secret");
      const failure = new Error(
        `ENOENT: cannot open ${projectPath}/config.json`,
      ) as NodeJS.ErrnoException;
      failure.code = "ENOENT";
      failure.name = "AcmeBillingError";

      await captureSentryException(failure, {
        tags: { source: "process", app: "acme-secret" },
        extra: {
          cwd: projectPath,
          stderrTail: "acme-secret build log",
          exitCode: 1,
        },
      });
      await flushSentryTelemetry();
    } finally {
      process.argv = argv;
    }

    expect(sent).toHaveLength(1);
    const report = sent[0];
    expect(report).not.toContain("acme-secret");
    expect(report).not.toContain("AcmeBillingError");
    expect(report).not.toContain("builder-user-secret");
    expect(report).not.toContain("builder-space-secret");
    expect(report).not.toContain(os.hostname());
    expect(report).not.toContain("server_name");
    expect(report).not.toContain(JSON.stringify(userHome).slice(1, -1));
    expect(report).not.toContain(userHome.replace(/\\/g, "/"));
    expect(report).toContain('"environment":"production"');
    expect(report).toContain('"value":"ENOENT"');
    expect(report).toContain('"code":"ENOENT"');
    expect(report).toContain('"exitCode":1');
    expect(report).toContain('"command":"unknown"');
    expect(report).toContain("@agent-native/core/src/cli/");
  });

  it("keeps the grouping fingerprint on the sanitized report", async () => {
    const { sanitizeSentryEvent } = await import("./sentry-telemetry.js");

    const safe = sanitizeSentryEvent({
      type: undefined,
      fingerprint: ["build-step", "deploy-build", "signal"],
    });

    expect(safe.fingerprint).toEqual(["build-step", "deploy-build", "signal"]);
  });
});
