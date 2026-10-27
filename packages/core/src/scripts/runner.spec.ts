import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const approvalAudit = vi.hoisted(() => vi.fn(async (_input: any) => {}));
const question = vi.hoisted(() => vi.fn(async () => "n"));
const closePrompt = vi.hoisted(() => vi.fn());
vi.mock("../audit/record.js", () => ({ recordActionAudit: approvalAudit }));
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({ question, close: closePrompt }),
}));

import { defineAction } from "../action.js";
import { openCliHandoff, runScript } from "./runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runnerSource = path.resolve(__dirname, "runner.ts");
const fileUploadIndex = path.resolve(__dirname, "../file-upload/index.ts");

// Searches upward from this file rather than from a fixed repo root, so the
// spec also finds tsx from a copy of Core, such as Stryker's sandbox.
function resolveTsxCli(): string {
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    const bin = path.join(dir, "node_modules", ".bin", "tsx");
    if (process.platform !== "win32" && fs.existsSync(bin)) return bin;
    const pnpmDir = path.join(dir, "node_modules", ".pnpm");
    const tsxEntry = fs.existsSync(pnpmDir)
      ? fs
          .readdirSync(pnpmDir)
          .filter((name) => name.startsWith("tsx@"))
          .sort()
          .pop()
      : undefined;
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
    if (path.dirname(dir) === dir) return "tsx";
  }
}

const tsxCli = resolveTsxCli();
const tsxIsBinShim = !tsxCli.endsWith(".mjs") && !tsxCli.endsWith(".js");
const tsxCommand = tsxIsBinShim ? tsxCli : process.execPath;
const tsxLeadingArgs = tsxIsBinShim ? [] : [tsxCli];
const spawnTimeoutMs = 30_000;

describe("runScript CLI approval", () => {
  const originalArgv = process.argv;
  const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  function setTty(value: boolean) {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value,
    });
  }
  let run: ReturnType<typeof vi.fn>;
  let error: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    run = vi.fn(async (args) => args);
    approvalAudit.mockClear();
    question.mockReset().mockResolvedValue("n");
    closePrompt.mockClear();
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
    setTty(false);
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("AGENT_USER_EMAIL", "owner@example.test");
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
    else delete (process.stdin as any).isTTY;
    if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty);
    else delete (process.stdout as any).isTTY;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function invoke(
    needsApproval: any,
    args: string[] = [],
    auditEnabled = false,
  ) {
    vi.mocked(process.exit).mockClear();
    process.argv = ["node", "actions/run.ts", "fixture-action", ...args];
    return runScript({
      packageActions: {
        "fixture-action": defineAction({
          schema: z.object({ action: z.string().default("delete") }).strict(),
          needsApproval,
          audit: { enabled: auditEnabled },
          changeEvents: false,
          run,
        }),
      },
    }).catch((error) => {
      // A mocked exit throws through dispatch's catch; the first exit is the CLI result.
      const code = vi.mocked(process.exit).mock.calls[0]?.[0];
      if (code !== undefined) throw new Error(`exit:${code}`);
      throw error;
    });
  }

  it("refuses a flat gate with a copy-pasteable command and never runs", async () => {
    await expect(invoke(true, ['{"action":"delete"}'])).rejects.toThrow(
      "exit:1",
    );
    expect(error).toHaveBeenCalledWith(
      'Action "fixture-action" failed:',
      'Action "fixture-action" requires human approval. Ask the person to approve this call, then rerun:\npnpm action fixture-action \'{"action":"delete"}\' --approved',
    );
    expect(run).not.toHaveBeenCalled();
    expect(question).not.toHaveBeenCalled();
    expect(approvalAudit).not.toHaveBeenCalled();
  });

  it("evaluates a function gate against defaulted args and cli context", async () => {
    const gate = (args: any, ctx: any) =>
      ctx?.caller === "cli" && args.action === "delete";
    await expect(invoke(gate)).rejects.toThrow("exit:1");
    expect(run).not.toHaveBeenCalled();
    await expect(invoke(gate, ["--action", "read"])).rejects.toThrow("exit:0");
    expect(run).toHaveBeenCalledWith(
      { action: "read" },
      expect.objectContaining({ caller: "cli" }),
    );
    expect(approvalAudit).not.toHaveBeenCalled();
  });

  it("strips --approved before strict validation and records it on the action's audit row", async () => {
    await expect(
      invoke(true, ["--approved", '{"action":"delete"}'], true),
    ).rejects.toThrow("exit:0");
    expect(run).toHaveBeenCalledWith(
      { action: "delete" },
      expect.objectContaining({ caller: "cli" }),
    );
    expect(question).not.toHaveBeenCalled();
    // One row per run: the approval rides on the action's own audit event.
    expect(approvalAudit).toHaveBeenCalledTimes(1);
    expect(approvalAudit.mock.calls[0]![0]).toMatchObject({
      args: { action: "delete" },
      ctx: { actionName: "fixture-action" },
      attribution: { caller: "cli", approval: "cli-flag" },
      status: "success",
    });
  });

  it.each(["y", "yes", "Y", "n", "", "anything"])(
    "handles TTY answer %j",
    async (answer) => {
      setTty(true);
      question.mockResolvedValue(answer);
      const accepted = ["y", "yes", "Y"].includes(answer);
      await expect(invoke(true, [], true)).rejects.toThrow(
        accepted ? "exit:0" : "exit:1",
      );
      expect(question).toHaveBeenCalledWith("Run this action? [y/N] ");
      expect(log).toHaveBeenCalledWith('{\n  "action": "delete"\n}');
      expect(closePrompt).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledTimes(accepted ? 1 : 0);
      expect(approvalAudit).toHaveBeenCalledTimes(accepted ? 1 : 0);
      if (accepted)
        expect(approvalAudit.mock.calls[0]![0]).toMatchObject({
          attribution: { caller: "cli", approval: "cli-prompt" },
          status: "success",
        });
    },
  );

  it.each([{ args: [] }, { args: ["--approved"] }])(
    "leaves ungated calls unchanged with flags %j",
    async ({ args }) => {
      await expect(invoke(false, args)).rejects.toThrow("exit:0");
      expect(run).toHaveBeenCalledWith({ action: "delete" }, expect.anything());
      expect(question).not.toHaveBeenCalled();
      expect(approvalAudit).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the approval predicate throws", async () => {
    await expect(
      invoke(() => {
        throw new Error("predicate failed");
      }),
    ).rejects.toThrow("exit:1");
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps invalid-input auditing for an ungated action", async () => {
    await expect(invoke(false, ['{"action":42}'], true)).rejects.toThrow(
      "exit:1",
    );
    expect(run).not.toHaveBeenCalled();
    expect(approvalAudit).toHaveBeenCalledTimes(1);
    expect(approvalAudit.mock.calls[0]![0]).toMatchObject({
      ctx: { actionName: "fixture-action" },
      attribution: { caller: "cli" },
      status: "error",
    });
  });

  it.each(["/bin/bash", ""])(
    "quotes apostrophes for the invoking shell (%j)",
    async (shell) => {
      vi.stubEnv("SHELL", shell);
      await expect(invoke(true, ["--action", "O'Brien"])).rejects.toThrow(
        "exit:1",
      );
      const unknownWindowsShell = process.platform === "win32" && shell === "";
      const rerun = unknownWindowsShell
        ? `pnpm action fixture-action --action 'O''Brien' --approved\nIn cmd.exe: pnpm action fixture-action --action "O'Brien" --approved`
        : `pnpm action fixture-action --action 'O'"'"'Brien' --approved`;
      expect(error).toHaveBeenCalledWith(
        'Action "fixture-action" failed:',
        `Action "fixture-action" requires human approval. Ask the person to approve this call, then rerun:\n${rerun}`,
      );
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("preserves leading @ values instead of PowerShell variable splatting", async () => {
    vi.stubEnv("SHELL", "");
    await expect(
      invoke(true, ["--action", "@reviewQuoteArgs"]),
    ).rejects.toThrow("exit:1");
    // cmd.exe has no splatting, so its form leaves the value bare.
    const rerun =
      process.platform === "win32"
        ? "pnpm action fixture-action --action '@reviewQuoteArgs' --approved\nIn cmd.exe: pnpm action fixture-action --action @reviewQuoteArgs --approved"
        : "pnpm action fixture-action --action @reviewQuoteArgs --approved";
    expect(error).toHaveBeenCalledWith(
      'Action "fixture-action" failed:',
      `Action "fixture-action" requires human approval. Ask the person to approve this call, then rerun:\n${rerun}`,
    );
    expect(run).not.toHaveBeenCalled();
  });
});

describe("runScript package actions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-runner-"));
    fs.mkdirSync(path.join(tmpDir, "actions"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "actions", "_cli-bootstrap.ts"),
      `
        import { registerFileUploadProvider } from ${JSON.stringify(pathToFileURL(fileUploadIndex).href)};

        if (process.env.FIXTURE_APP_UPLOAD_PROVIDER) {
          registerFileUploadProvider({
            id: "s3",
            name: "Fixture app storage",
            isConfigured: () => true,
            upload: async () => ({ url: "https://app.example/a", provider: "s3" }),
          });
        }
      `,
    );
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
                    appId: ctx?.appId ?? null,
                  }),
                );
                return "context-ok";
              },
            },
            "package-upload": {
              tool: {
                description: "Fixture package action upload",
                parameters: { type: "object", properties: {} },
              },
              run: async () => {
                const { getActiveFileUploadProviderForRequest } = await import(
                  ${JSON.stringify(pathToFileURL(fileUploadIndex).href)}
                );
                const provider = await getActiveFileUploadProviderForRequest();
                writeFileSync(
                  "package-upload.json",
                  JSON.stringify({
                    name: provider?.name ?? null,
                    provider: provider?.id ?? null,
                  }),
                );
                return "upload-ok";
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

  it.each([false, true])(
    "enforces approval for a local defineAction (approved=%j)",
    (approved) => {
      fs.writeFileSync(
        path.join(tmpDir, "actions", "gated-local.ts"),
        `
      import { writeFileSync } from "node:fs";
      import { defineAction } from ${JSON.stringify(pathToFileURL(path.resolve(__dirname, "../action.ts")).href)};
      export default defineAction({
        needsApproval: true,
        audit: { enabled: false },
        run: async (args) => { writeFileSync("local-output.json", JSON.stringify(args)); return "local-ok"; },
      });
    `,
      );
      const result = spawnSync(
        tsxCommand,
        [
          ...tsxLeadingArgs,
          "actions/run.ts",
          "gated-local",
          "--label",
          "test value",
          ...(approved ? ["--approved"] : []),
        ],
        {
          cwd: tmpDir,
          encoding: "utf8",
          env: {
            ...process.env,
            AGENT_USER_EMAIL: "owner@example.test",
            AGENT_NATIVE_AUDIT_ENABLED: "false",
          },
          timeout: spawnTimeoutMs,
        },
      );
      expect(result.status).toBe(approved ? 0 : 1);
      if (approved)
        expect(
          JSON.parse(
            fs.readFileSync(path.join(tmpDir, "local-output.json"), "utf8"),
          ),
        ).toEqual({ label: "test value" });
      else {
        expect(result.stderr).toContain(
          "pnpm action gated-local --label 'test value' --approved",
        );
        expect(fs.existsSync(path.join(tmpDir, "local-output.json"))).toBe(
          false,
        );
      }
    },
    40_000,
  );

  it("exits non-zero when a local script rejects during dispatch", () => {
    fs.writeFileSync(
      path.join(tmpDir, "actions", "failing-script.ts"),
      `export default async function () { throw new Error("No image variations were generated successfully."); }`,
    );

    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "failing-script"],
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
    expect(result.stderr).toContain(
      'Action "failing-script" failed: No image variations were generated successfully.',
    );
  }, 40_000);

  it("short-circuits named action help before dev dispatch or imports", () => {
    const databaseUrl = `pglite:${path.join(tmpDir, "session-db")}`;
    const marker = (name: string) => path.join(tmpDir, name);
    const writeMarker = (name: string, content: string) =>
      `writeFileSync(${JSON.stringify(marker(name))}, ${JSON.stringify(content)});`;

    fs.mkdirSync(path.join(tmpDir, "server", "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "server", "plugins", "db.ts"),
      `
        import { writeFileSync } from "node:fs";
        ${writeMarker("plugin-import.marker", "imported")}
        export default async function () {
          ${writeMarker("plugin-run.marker", "ran")}
        }
      `,
    );
    fs.writeFileSync(
      path.join(tmpDir, "actions", "mutating-action.ts"),
      `
        import { writeFileSync } from "node:fs";
        ${writeMarker("action-import.marker", "imported")}
        export default async function () {
          ${writeMarker("action-run.marker", "ran")}
        }
      `,
    );
    fs.mkdirSync(path.join(tmpDir, ".agent-native"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".agent-native", "dev-server.json"),
      JSON.stringify({
        origin: "http://127.0.0.1:9488",
        pid: process.pid,
        token: "fixture-token",
        databaseKey: createHash("sha256").update(databaseUrl).digest("hex"),
      }),
    );
    fs.writeFileSync(
      path.join(tmpDir, "actions", "run.ts"),
      `
        import { writeFileSync } from "node:fs";
        import { runScript } from ${JSON.stringify(pathToFileURL(runnerSource).href)};

        globalThis.fetch = async () => {
          ${writeMarker("forward.marker", "called")}
          return {
            status: 200,
            json: async () => ({ ok: true, result: "forwarded fixture" }),
          } as Response;
        };
        runScript();
      `,
    );

    const env = { ...process.env };
    for (const key of [
      "AGENT_USER_EMAIL",
      "AGENT_ORG_ID",
      "APP_NAME",
      "AUTH_MODE",
      "DATABASE_URL_UNPOOLED",
      "NETLIFY_DATABASE_URL",
      "NETLIFY_DATABASE_URL_UNPOOLED",
      "NODE_ENV",
    ]) {
      delete env[key];
    }
    env.DATABASE_URL = databaseUrl;
    env.NODE_ENV = "development";

    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "mutating-action", "--help"],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env,
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: pnpm action");
    expect(result.stdout).not.toContain(
      "Run any action with --help for usage details.",
    );
    for (const name of [
      "forward.marker",
      "plugin-import.marker",
      "plugin-run.marker",
      "action-import.marker",
      "action-run.marker",
    ]) {
      expect(fs.existsSync(marker(name))).toBe(false);
    }
    expect(fs.existsSync(path.join(tmpDir, "session-db"))).toBe(false);

    const forwarded = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "mutating-action"],
      { cwd: tmpDir, encoding: "utf8", env, timeout: spawnTimeoutMs },
    );
    expect(forwarded.status).toBe(0);
    expect(forwarded.stdout).toContain("forwarded fixture");
    expect(fs.existsSync(marker("forward.marker"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "session-db"))).toBe(false);
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

  it("resolves the built-in S3 provider with no server plugins mounted", () => {
    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "package-upload"],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_USER_EMAIL: "owner@example.test",
          S3_ENDPOINT: "https://s3.example.com",
          S3_BUCKET: "uploads-example",
          S3_ACCESS_KEY_ID: "access-example",
          S3_SECRET_ACCESS_KEY: "secret-example",
          S3_REGION: "us-east-1",
          S3_PUBLIC_BASE_URL: "https://cdn.example.com/assets",
        },
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.stdout).toContain("upload-ok");
    expect(result.status).toBe(0);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(tmpDir, "package-upload.json"), "utf8"),
      ),
    ).toEqual({ name: "S3-compatible object storage", provider: "s3" });
  }, 40_000);

  it("loads the app's CLI bootstrap and keeps its provider", () => {
    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "package-upload"],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env: {
          ...process.env,
          AGENT_USER_EMAIL: "owner@example.test",
          FIXTURE_APP_UPLOAD_PROVIDER: "1",
        },
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.stdout).toContain("upload-ok");
    expect(result.status).toBe(0);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(tmpDir, "package-upload.json"), "utf8"),
      ),
    ).toEqual({ name: "Fixture app storage", provider: "s3" });
  }, 40_000);

  it("marks a signed-out local action invocation as CLI without inventing an account user", () => {
    const env = { ...process.env };
    delete env.AGENT_USER_EMAIL;
    delete env.AGENT_ORG_ID;
    env.AGENT_NATIVE_APP_ID = "fixture-app";
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
      appId: "fixture-app",
    });
  }, 40_000);

  it("registers action authorization before dispatching a CLI action", () => {
    fs.writeFileSync(
      path.join(tmpDir, "actions", "guarded-action.ts"),
      `
        import { defineAction } from ${JSON.stringify(pathToFileURL(path.resolve(__dirname, "../action.ts")).href)};

        export default defineAction({
          description: "Fixture action with an app access policy",
          parameters: {},
          access: { scope: "app" },
          run: async () => "should-not-run",
        });
      `,
    );

    const env = { ...process.env };
    delete env.AGENT_USER_EMAIL;
    delete env.AGENT_ORG_ID;
    env.AGENT_NATIVE_APP_ID = "fixture-app";
    env.NODE_ENV = "production";

    const result = spawnSync(
      tsxCommand,
      [...tsxLeadingArgs, "actions/run.ts", "guarded-action"],
      {
        cwd: tmpDir,
        encoding: "utf8",
        env,
        timeout: spawnTimeoutMs,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("An authenticated user is required.");
    expect(result.stderr).not.toContain(
      "Action authorization runtime is not available.",
    );
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

  it("passes Windows handoff URLs to Explorer as data", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = openCliHandoff(
      "/_agent-native/embed/start?ticket=trusted-only&state=example",
      {
        env: { APP_URL: "http://localhost:8140" },
        platform: "win32",
        spawn: (command, args) => {
          calls.push({ command, args });
          return { status: 0 };
        },
      },
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        command: "explorer.exe",
        args: [
          "http://localhost:8140/_agent-native/embed/start?ticket=trusted-only&state=example",
        ],
      },
    ]);
  });

  it("uses a verified discovery origin for a relative handoff", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = openCliHandoff(
      "/_agent-native/embed/start?ticket=discovered",
      {
        env: {},
        baseUrl: "http://127.0.0.1:8141",
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
          "http://127.0.0.1:8141/_agent-native/embed/start?ticket=discovered",
        ],
      },
    ]);
  });

  it("uses the supported gateway fallback for relative handoffs", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = openCliHandoff(
      "/_agent-native/embed/start?ticket=gateway-fallback",
      {
        env: { WORKSPACE_GATEWAY_URL: "http://127.0.0.1:8140" },
        platform: "linux",
        spawn: (command, args) => {
          calls.push({ command, args });
          return { status: 0 };
        },
      },
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        command: "xdg-open",
        args: [
          "http://127.0.0.1:8140/_agent-native/embed/start?ticket=gateway-fallback",
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
