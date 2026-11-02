import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const userHome = os.homedir();
// An existing name that is also sent under its canonical alias.
const ALIASED_EVENT = "skills_cli started";

type TelemetryModule = typeof import("./telemetry.js");

function sentBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([, init]) =>
    JSON.parse(String((init as RequestInit).body)),
  );
}

function sentExceptions(fetchMock: ReturnType<typeof vi.fn>) {
  return sentBodies(fetchMock).filter((body) => body.event === "$exception");
}

describe("CLI telemetry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let home: string;
  let stderr: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "an-cli-telemetry-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DO_NOT_TRACK", "");
    vi.stubEnv("AGENT_NATIVE_TELEMETRY_DISABLED", "");
    vi.stubEnv("AGENT_NATIVE_TELEMETRY_DEBUG", "");
    vi.stubEnv("CI", "");
    vi.stubEnv("GITHUB_ACTIONS", "");
    vi.stubEnv("GITLAB_CI", "");
    fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    stderr = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fs.rmSync(home, { recursive: true, force: true });
  });

  // A fresh import is a fresh CLI process: the notice is checked once per run.
  async function newRun(command = "build") {
    vi.resetModules();
    const { createCliTelemetry }: TelemetryModule =
      await import("./telemetry.js");
    return createCliTelemetry({
      cli: "core",
      cliVersion: "0.9.1",
      command,
      interactive: false,
    });
  }

  async function runCommand(args: string[]) {
    const { runTelemetryCommand } = await import("./telemetry-command.js");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runTelemetryCommand(args);
    const output = log.mock.calls.flat().join("\n");
    log.mockRestore();
    return output;
  }

  describe("notice", () => {
    it("prints once on this machine, before the first send, to stderr", async () => {
      (await newRun()).track("test_event");

      expect(stderr).toContain("Agent-Native collects anonymous usage data.");
      expect(stderr).toContain(
        'Run "npx @agent-native/core telemetry disable" to opt out.',
      );
      expect(stderr).toContain("https://www.agent-native.com/docs/telemetry");

      stderr = "";
      (await newRun()).track("test_event");
      expect(stderr).toBe("");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["CI", "true"],
      ["CI", "1"],
      ["GITHUB_ACTIONS", "true"],
    ])("stays quiet in CI (%s=%s) and still sends", async (name, value) => {
      vi.stubEnv(name, value);

      (await newRun()).track("test_event");

      expect(stderr).toBe("");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentBodies(fetchMock)[0].properties.ci).toBe(true);
    });

    it("does not print until something would actually be sent", async () => {
      await newRun();

      expect(stderr).toBe("");
      expect(fs.existsSync(path.join(home, ".agent-native"))).toBe(false);
    });
  });

  describe("off switches", () => {
    it.each(["DO_NOT_TRACK", "AGENT_NATIVE_TELEMETRY_DISABLED"])(
      "%s=1 means no notice and nothing sent",
      async (name) => {
        vi.stubEnv(name, "1");

        const cli = await newRun();
        cli.track("test_event");
        cli.captureException(new Error("boom"));

        expect(stderr).toBe("");
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it("telemetry disable stops every send, status says so, enable restores", async () => {
      await runCommand(["disable"]);
      const off = await newRun();
      off.track("test_event");
      off.captureException(new Error("boom"));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(stderr).toBe("");
      expect(await runCommand(["status"])).toContain("telemetry is off");

      await runCommand(["enable"]);
      expect(await runCommand(["status"])).toContain("telemetry is on");
      (await newRun()).track("test_event");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stays off when the settings file cannot be read", async () => {
      fs.mkdirSync(path.join(home, ".agent-native"));
      fs.writeFileSync(path.join(home, ".agent-native", "telemetry.json"), "{");

      (await newRun()).track("test_event");

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ["a list", "[]"],
      ["a string for enabled", '{"enabled":"false"}'],
      ["a number for notifiedAt", '{"notifiedAt":1}'],
    ])(
      "stays off when the settings file holds %s",
      async (_label, contents) => {
        fs.mkdirSync(path.join(home, ".agent-native"));
        fs.writeFileSync(
          path.join(home, ".agent-native", "telemetry.json"),
          contents,
        );

        (await newRun()).track("test_event");

        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it("status says when debug mode means nothing is sent", async () => {
      vi.stubEnv("AGENT_NATIVE_TELEMETRY_DEBUG", "1");

      expect(await runCommand(["status"])).toContain("nothing is sent");
    });

    it("stops a running command's events once telemetry is disabled", async () => {
      const cli = await newRun();
      cli.track("test_event");
      const sentBefore = fetchMock.mock.calls.length;
      expect(sentBefore).toBeGreaterThan(0);

      await runCommand(["disable"]);
      cli.track("test_event");
      cli.captureException(new Error("boom"));

      expect(fetchMock).toHaveBeenCalledTimes(sentBefore);
    });

    it("enable says so when an environment variable still wins", async () => {
      vi.stubEnv("DO_NOT_TRACK", "1");

      expect(await runCommand(["enable"])).toContain(
        "stays off while DO_NOT_TRACK is set",
      );
    });

    it("telemetry reset replaces the machine id", async () => {
      (await newRun()).track("test_event");
      const before = sentBodies(fetchMock)[0].anonymousId;

      await runCommand(["reset"]);
      (await newRun()).track("test_event");

      const after = sentBodies(fetchMock)[1].anonymousId;
      expect(after).not.toBe(before);
      expect(after).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe("debug mode", () => {
    beforeEach(() => {
      vi.stubEnv("AGENT_NATIVE_TELEMETRY_DEBUG", "1");
    });

    it("prints each event and sends nothing, with no notice and no id file", async () => {
      const cli = await newRun();
      cli.track(ALIASED_EVENT);
      await cli.flush();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(stderr).not.toContain("collects anonymous usage data");
      const lines = stderr.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^\[telemetry\] /);
      expect(JSON.parse(lines[0].slice("[telemetry] ".length))).toMatchObject({
        event: ALIASED_EVENT,
        properties: { cli: "core", command: "build" },
      });
      expect(fs.existsSync(path.join(home, ".agent-native"))).toBe(false);
    });

    it("previews even when telemetry is off", async () => {
      vi.stubEnv("DO_NOT_TRACK", "1");

      (await newRun()).track("test_event");

      expect(stderr).toContain('[telemetry] {"event":"test_event"');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("properties", () => {
    it("drops anything off the allowlist", async () => {
      (await newRun()).track("skills_cli_completed", {
        scope: "project",
        cwd: "/home/ada/acme",
        repo: "acme/secret",
        email: "ada@example.com",
      });

      const { properties } = sentBodies(fetchMock)[0];
      expect(properties.scope).toBe("project");
      expect(properties).not.toHaveProperty("cwd");
      expect(properties).not.toHaveProperty("repo");
      expect(properties).not.toHaveProperty("email");
    });

    it.each([
      "/home/ada/acme",
      "C:\\Users\\ada\\acme",
      "https://github.com/acme/secret",
      "acme/secret",
      "ada@example.com",
    ])("drops an allowed property holding %s", async (value) => {
      (await newRun()).track("skills_cli_completed", { skills: value });

      expect(sentBodies(fetchMock)[0].properties).not.toHaveProperty("skills");
    });

    it("cuts an error property down to its hint", async () => {
      (await newRun()).track("skills_cli_failed", {
        error: new Error("Failed to read /home/ada/acme/secret.json"),
      });

      expect(sentBodies(fetchMock)[0].properties.error).toBe("Failed to read");
    });
  });

  describe("crash reports", () => {
    const projectPath = path.join(userHome, "work", "acme-secret");

    function failure() {
      const error = new Error(
        `ENOENT: cannot open ${projectPath}/config.json for acme-secret`,
      ) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      error.stack = [
        `Error: ${error.message}`,
        `    at readConfig (file:///${projectPath}/node_modules/@agent-native/core/dist/cli/create.js:12:3)`,
        `    at async runSkills (${here}/skills.js:40:9)`,
        `    at userAction (${projectPath}/actions/secret.ts:1:1)`,
        `    at dep (${projectPath}/node_modules/@agent-native/core/node_modules/dep/x.js:1:1)`,
        "    at node:internal/process/task_queues:105:5",
      ].join("\n");
      return error;
    }

    it("sends type, code, a short hint and only our own frames", async () => {
      (await newRun()).captureException(failure(), { handled: false });

      const { properties } = sentExceptions(fetchMock)[0];
      expect(properties).toMatchObject({
        exceptionType: "Error",
        exceptionCode: "ENOENT",
        exceptionMessage: "ENOENT",
        handled: false,
        release: "agent-native-cli@0.9.1",
      });
      expect(properties.exceptionStack.split("\n")).toEqual([
        "Error",
        "    at readConfig (@agent-native/core/dist/cli/create.js:12:3)",
        "    at async runSkills (@agent-native/core/src/cli/skills.js:40:9)",
      ]);
    });

    it("never carries the home directory, project path or hostname", async () => {
      const cli = await newRun();
      cli.track("skills_cli_failed", { error: failure() });
      cli.captureException(failure(), {
        handled: false,
        tags: { source: "build-step", app: "acme-secret", cwd: projectPath },
        extra: { stderrTail: `failed in ${projectPath}`, exitCode: 1 },
      });

      const payload = JSON.stringify(sentBodies(fetchMock));
      expect(payload).not.toContain(userHome);
      expect(payload).not.toContain(JSON.stringify(userHome).slice(1, -1));
      expect(payload).not.toContain(userHome.replace(/\\/g, "/"));
      expect(payload).not.toContain("acme-secret");
      expect(payload).not.toContain(os.hostname());
      expect(sentExceptions(fetchMock)[0].properties).toMatchObject({
        exceptionTags: { source: "build-step" },
        exceptionExtra: { exitCode: 1 },
      });
    });

    it("keeps the hint to 20 characters of plain words", async () => {
      (await newRun()).captureException(
        new Error("This message runs on far past the limit"),
      );

      expect(sentExceptions(fetchMock)[0].properties.exceptionMessage).toBe(
        "This message runs on",
      );
    });

    it.each([
      ["a GitHub token", "ghp_abcdefghij1234567890", "Error"],
      ["a Stripe key", "sk_live_abcdefghij rejected", "Error"],
      // guard:allow-secret-literal — the example key from AWS docs, not a credential
      ["an AWS key ID", "AKIAIOSFODNN7EXAMPLE rejected", "Error"],
      ["an email", "ada@example.com is invalid", "Error"],
      [
        "a letters-only run too long to fit",
        "abcdefghijklmnopqrstuvwxyz",
        "Error",
      ],
      ["a token after plain words", "Bad token ghp_abc123", "Bad token"],
      ["a Windows path", "Failed to open C:\\Users\\ada", "Failed to open"],
      ["a credential pair", "ada:hunter is invalid", "Error"],
      ["what follows a label", "Build failed: acme secret", "Build failed"],
      ["a word cut by the limit", "Cannot read properties of x", "Cannot read"],
    ])("keeps %s out of the hint", async (_label, message, hint) => {
      (await newRun()).captureException(new Error(message));

      expect(sentExceptions(fetchMock)[0].properties.exceptionMessage).toBe(
        hint,
      );
    });

    it.each([
      ["AcmeBillingError", "Error"],
      ["RangeError", "RangeError"],
    ])("reports the error type %s as %s", async (name, type) => {
      const error = new Error("boom");
      error.name = name;

      (await newRun()).captureException(error);

      expect(sentExceptions(fetchMock)[0].properties.exceptionType).toBe(type);
    });

    it.each([
      ["ACME_BILLING_FAILED", undefined],
      ["ERR_ACME_PRIVATE_BILLING", undefined],
      ["EACMEBILLING", undefined],
      ["ENOENT", "ENOENT"],
      ["ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"],
      ["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT"],
    ])("reports the error code %s as %s", async (code, sent) => {
      const error = new Error("boom") as NodeJS.ErrnoException;
      error.code = code;

      (await newRun()).captureException(error);

      expect(sentExceptions(fetchMock)[0].properties.exceptionCode).toBe(sent);
    });

    it("falls back to the type when the message starts with a path", async () => {
      (await newRun()).captureException(new TypeError("/home/ada/acme: nope"));

      expect(sentExceptions(fetchMock)[0].properties).toMatchObject({
        exceptionType: "TypeError",
        exceptionMessage: "TypeError",
      });
    });

    it("reports our own known errors in full", async () => {
      const cli = await newRun();
      const { buildStepFailureReport } =
        await import("./build-failure-report.js");
      const report = buildStepFailureReport({
        label: "deploy-build",
        exitCode: 1,
        signal: null,
      });

      cli.captureException(report.error, {
        handled: false,
        tags: report.tags,
        extra: report.extra,
      });

      expect(sentExceptions(fetchMock)[0].properties).toMatchObject({
        exceptionType: "Error",
        exceptionMessage: 'Build step "deploy-build" failed',
        release: "agent-native-cli@0.9.1",
        exceptionTags: { source: "build-step", buildStep: "deploy-build" },
        exceptionExtra: { exitCode: 1 },
      });
    });

    it.each([
      [
        "/home/ada/node_modules/.pnpm/@agent-native+core@1.0.0/node_modules/@agent-native/core/dist/cli/index.js",
        "@agent-native/core/dist/cli/index.js",
      ],
      [
        "C:/Users/ada/AppData/npm-cache/_npx/1/node_modules/@agent-native/skills/dist/cli.js",
        "@agent-native/skills/dist/cli.js",
      ],
      ["/home/ada/node_modules/@agent-native/private-app/secret.js", null],
      [
        "/home/ada/node_modules/@agent-native/core/node_modules/@agent-native/private-app/secret.js",
        null,
      ],
      ["/home/ada/node_modules/@agent-native/core/node_modules/dep/x.js", null],
      ["/home/ada/acme-secret/server.js", null],
    ])("treats %s as %s", async (file, owned) => {
      const { ownFilePath } = await import("./telemetry-sanitize.js");

      expect(ownFilePath(file)).toBe(owned);
    });

    it("doesn't treat a folder beside the package as ours", async () => {
      const { ownFilePath } = await import("./telemetry-sanitize.js");

      expect(
        ownFilePath(path.resolve(here, "../../../skills/private.js")),
      ).toBeNull();
    });

    it("never reports the fuzz harness's intercepted process.exit", async () => {
      const cli = await newRun();
      const fuzz = new Error("fuzz-intercepted-process-exit");
      fuzz.stack =
        "Error: fuzz-intercepted-process-exit\n    at process.fuzzInterceptedProcessExit [as exit] (fuzz-exports.js:98:9)";

      cli.captureException(fuzz, { handled: false });

      expect(sentExceptions(fetchMock)).toHaveLength(0);
    });
  });
});

describe("the telemetry docs page", () => {
  const docsPage = fs.readFileSync(
    path.resolve(here, "../../docs/content/telemetry.mdx"),
    "utf8",
  );

  it("lists every property, tag and extra field the CLI can send", async () => {
    const {
      CLI_EXCEPTION_EXTRA,
      CLI_EXCEPTION_TAGS,
      CLI_TELEMETRY_PROPERTIES,
    } = await import("./telemetry-sanitize.js");

    const names = [
      ...CLI_TELEMETRY_PROPERTIES,
      ...CLI_EXCEPTION_TAGS,
      ...CLI_EXCEPTION_EXTRA,
    ];
    const undocumented = names.filter(
      (name) => !docsPage.includes(`\`${name}\``),
    );

    expect(undocumented).toEqual([]);
  });

  it("names each off switch and the debug variable", () => {
    for (const name of [
      "DO_NOT_TRACK",
      "AGENT_NATIVE_TELEMETRY_DISABLED",
      "AGENT_NATIVE_TELEMETRY_DEBUG",
    ]) {
      expect(docsPage).toContain(name);
    }
  });
});
