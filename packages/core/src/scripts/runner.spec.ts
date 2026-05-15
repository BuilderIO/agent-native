import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
const runnerSource = path.resolve(__dirname, "runner.ts");

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
    const result = spawnSync(tsxBin, ["actions/run.ts", "--help"], {
      cwd: tmpDir,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_USER_EMAIL: "owner@example.test",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Fixture package actions:");
    expect(result.stdout).toContain("package-action");
  });

  it("runs a package action when no local action exists", () => {
    const result = spawnSync(
      tsxBin,
      [
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
  });
});
