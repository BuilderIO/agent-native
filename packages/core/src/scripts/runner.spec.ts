import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openCliHandoff } from "./runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const runnerSource = path.resolve(__dirname, "runner.ts");

// `tsx` is a transitive (not declared) dependency, so the hoisted
// `node_modules/.bin/tsx` shim exists under a local non-strict install but
// NOT under CI's `pnpm install --frozen-lockfile` strict layout — spawning
// the missing shim returns `status: null` (ENOENT). Resolve the real CLI
// entry from the pnpm virtual store (always present when tsx is locked) and
// run it through `process.execPath` so the spec is layout-independent.
function resolveTsxCli(): string {
  const binCandidates = [
    path.join(repoRoot, "node_modules", ".bin", "tsx"),
    path.join(repoRoot, "packages", "core", "node_modules", ".bin", "tsx"),
  ];
  for (const candidate of binCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  if (fs.existsSync(pnpmDir)) {
    const tsxEntry = fs
      .readdirSync(pnpmDir)
      .filter((name) => name.startsWith("tsx@"))
      .sort()
      .pop();
    if (tsxEntry) {
      const cli = path.join(
        pnpmDir,
        tsxEntry,
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs",
      );
      if (fs.existsSync(cli)) return cli;
    }
  }
  return binCandidates[0];
}

const tsxCli = resolveTsxCli();
// A `.bin` shim is directly executable; a resolved `cli.mjs` must be run via
// node. Normalize both into a (command, leadingArgs) pair.
const tsxIsBinShim = !tsxCli.endsWith(".mjs") && !tsxCli.endsWith(".js");
const tsxCommand = tsxIsBinShim ? tsxCli : process.execPath;
const tsxLeadingArgs = tsxIsBinShim ? [] : [tsxCli];
const spawnTimeoutMs = 30_000;

describe("runScript package actions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-runner-"));
    fs.mkdirSync(path.join(tmpDir, "actions"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "actions", "run.ts"),
      `
        import { writeFileSync } from "node:fs";
        import { runScript } from ${JSON.stringify(pathToFileURL(runnerSource).href)};

        runScript({
          packageActionLabel: "Fixture package actions",
          packageActions: {
            "package-action": {
              tool: {
                description: "Fixture package action",
                parameters: { type: "object", properties: {} },
              },
              run: async (args) => {
                writeFileSync("package-output.json", JSON.stringify(args, null, 2));
                return "package-ok";
              },
            },
            "package-context": {
              tool: {
                description: "Fixture package action context",
                parameters: { type: "object", properties: {} },
              },
              run: async (_args, ctx) => {
                writeFileSync(
                  "package-context.json",
                  JSON.stringify({
                    caller: ctx?.caller,
                    userEmail: ctx?.userEmail ?? null,
                    orgId: ctx?.orgId ?? null,
                  }),
                );
                return "context-ok";
              },
            },
            "package-handoff": {
              tool: {
                description: "Fixture package action handoff",
                parameters: { type: "object", properties: {} },
              },
              run: async () => ({
                openUrl: "/visual-edit/design_1",
                embedStartUrl:
                  "/_agent-native/embed/start?ticket=terminal-secret",
              }),
            },
            "package-handoff-error": {
              tool: {
                description: "Fixture package action failed handoff",
                parameters: { type: "object", properties: {} },
              },
              run: async () => {
                throw new Error(
                  "Could not open /_agent-native/embed/start?ticket=error-secret",
                );
              },
            },
          },
        });
      `,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists package actions in help output", () => {
    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "--help"],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_USER_EMAIL: "owner@example.test",
        },
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Fixture package actions:");
    expect(result.stdout).toContain("package-action");
  }, 40_000);

  it("runs a package action when no local action exists", () => {
    const result = spawnSync(
      tsxCommand,
      [
        ...tsxLeadingArgs,
        "actions/run.ts",
        "package-action",
        "--enabled",
        "true",
        "--dryRun=false",
        "--sourceIds",
        "mail",
        "--sourceIds=calendar",
        "--limit",
        "8",
      ],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_USER_EMAIL: "owner@example.test",
        },
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("package-ok");
    expect(
      JSON.parse(
        fs.readFileSync(path.join(tmpDir, "package-output.json"), "utf8"),
      ),
    ).toEqual({
      enabled: true,
      dryRun: false,
      sourceIds: ["mail", "calendar"],
      limit: "8",
    });
  }, 40_000);

  it("marks a signed-out local action invocation as CLI without inventing an account user", () => {
    const env = { ...process.env };
    delete env.AGENT_USER_EMAIL;
    delete env.AGENT_ORG_ID;
    env.NODE_ENV = "production";

    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "package-context"],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env,
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("context-ok");
    expect(
      JSON.parse(
        fs.readFileSync(path.join(tmpDir, "package-context.json"), "utf8"),
      ),
    ).toEqual({
      caller: "cli",
      userEmail: null,
      orgId: null,
    });
  }, 40_000);

  it("fails safely when browser handoff is disabled without printing its credential", () => {
    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "package-handoff"],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_NATIVE_NO_OPEN: "1",
          AGENT_USER_EMAIL: "owner@example.test",
        },
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("/visual-edit/design_1");
    expect(result.stdout).not.toContain("terminal-secret");
    expect(result.stdout).not.toContain("embedStartUrl");
    expect(result.stdout).not.toContain("/_agent-native/embed/start");
    expect(result.stderr).toContain(
      "Secure browser handoff is disabled by AGENT_NATIVE_NO_OPEN",
    );
    expect(result.stderr).not.toContain("terminal-secret");
    expect(result.stderr).not.toContain("/_agent-native/embed/start");
  }, 40_000);

  it("exits nonzero with an actionable diagnostic when handoff has no app base URL", () => {
    const env = { ...process.env };
    delete env.AGENT_NATIVE_NO_OPEN;
    delete env.APP_URL;
    delete env.WORKSPACE_GATEWAY_URL;
    delete env.VITE_WORKSPACE_GATEWAY_URL;
    delete env.BETTER_AUTH_URL;

    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "package-handoff"],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env,
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Secure browser handoff needs APP_URL or WORKSPACE_GATEWAY_URL",
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain("terminal-secret");
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      "/_agent-native/embed/start",
    );
  }, 40_000);

  it("exits nonzero with an actionable diagnostic for an invalid app base URL", () => {
    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "package-handoff"],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_NATIVE_NO_OPEN: "0",
          APP_URL: "not a URL",
        },
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Secure browser handoff found an invalid app URL",
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain("terminal-secret");
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      "/_agent-native/embed/start",
    );
  }, 40_000);

  it("redacts an embed handoff credential from runner error output", () => {
    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "package-handoff-error"],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_NATIVE_NO_OPEN: "1",
          AGENT_USER_EMAIL: "owner@example.test",
        },
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[redacted embed handoff]");
    expect(result.stderr).not.toContain("error-secret");
    expect(result.stderr).not.toContain("/_agent-native/embed/start");
  }, 40_000);

  it("invokes the system opener with the absolute handoff URL", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = openCliHandoff(
      "/_agent-native/embed/start?ticket=trusted-only",
      {
        env: { APP_URL: "http://localhost:8140" },
        platform: "darwin",
        spawn: (command, args) => {
          calls.push({ command, args });
          return { status: 0 };
        },
      },
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        command: "open",
        args: [
          "http://localhost:8140/_agent-native/embed/start?ticket=trusted-only",
        ],
      },
    ]);
  });

  it("reports an opener failure without returning the handoff credential", () => {
    const result = openCliHandoff(
      "/_agent-native/embed/start?ticket=trusted-only",
      {
        env: { APP_URL: "http://localhost:8140" },
        platform: "linux",
        spawn: () => ({ status: 1 }),
      },
    );

    expect(result).toEqual({
      ok: false,
      reason: "open-failed",
      message:
        "Secure browser handoff could not invoke the system URL opener. Verify local URL handling, then rerun this action.",
    });
    expect(JSON.stringify(result)).not.toContain("trusted-only");
    expect(JSON.stringify(result)).not.toContain("/_agent-native/embed/start");
  });

  it("runs a package action with a positional JSON object", () => {
    const result = spawnSync(
      tsxCommand,
      [
        ...tsxLeadingArgs,
        "actions/run.ts",
        "package-action",
        JSON.stringify({
          enabled: true,
          limit: 8,
          cursors: { slack: "next-page" },
          sourceIds: ["mail", "calendar"],
        }),
      ],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_USER_EMAIL: "owner@example.test",
        },
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("package-ok");
    expect(
      JSON.parse(
        fs.readFileSync(path.join(tmpDir, "package-output.json"), "utf8"),
      ),
    ).toEqual({
      enabled: true,
      limit: 8,
      cursors: { slack: "next-page" },
      sourceIds: ["mail", "calendar"],
    });
  }, 40_000);

  it("lets explicit flags override positional JSON object keys", () => {
    const result = spawnSync(
      tsxCommand,
      [
        ...tsxLeadingArgs,
        "actions/run.ts",
        "package-action",
        JSON.stringify({
          enabled: true,
          limit: 8,
          cursors: { slack: "next-page" },
        }),
        "--enabled=false",
        "--limit",
        "12",
      ],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_USER_EMAIL: "owner@example.test",
        },
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(0);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(tmpDir, "package-output.json"), "utf8"),
      ),
    ).toEqual({
      enabled: false,
      limit: "12",
      cursors: { slack: "next-page" },
    });
  }, 40_000);

  it("reports invalid positional JSON object input", () => {
    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "package-action", "{bad-json"],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_USER_EMAIL: "owner@example.test",
        },
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid positional JSON argument");
  }, 40_000);

  it("preserves empty package action arguments", () => {
    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "package-action", "--label", ""],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_USER_EMAIL: "owner@example.test",
        },
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(0);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(tmpDir, "package-output.json"), "utf8"),
      ),
    ).toEqual({ label: "" });
  }, 40_000);
});
