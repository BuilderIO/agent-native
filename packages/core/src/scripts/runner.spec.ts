import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const spawnTimeoutMs = 15_000;

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
  }, 20_000);

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
  }, 20_000);

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
  }, 20_000);
});
