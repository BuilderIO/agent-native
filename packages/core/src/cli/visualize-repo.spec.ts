import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseVisualizeRepoArgs,
  prepareVisualizeRepoWorkspace,
  runVisualizeRepo,
} from "./visualize-repo.js";

const tmpRoots: string[] = [];

function tmpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-visualize-repo-"));
  tmpRoots.push(root);
  return root;
}

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
    string,
    unknown
  >;
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("visualize-repo CLI", () => {
  it("parses default serve flags and repeated targets", () => {
    expect(
      parseVisualizeRepoArgs([
        "--target",
        "actions",
        "--target=server/db/schema.ts",
        "--no-open",
        "--port",
        "9090",
      ]),
    ).toMatchObject({
      command: "serve",
      targets: ["actions", "server/db/schema.ts"],
      open: false,
      port: 9090,
    });
  });

  it("bootstraps a manifest and local Plan folder from repo structure", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"demo"}\n');
    fs.mkdirSync(path.join(root, "actions"), { recursive: true });
    fs.mkdirSync(path.join(root, "app", "components"), { recursive: true });
    fs.mkdirSync(path.join(root, "server", "db"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "server", "db", "schema.ts"),
      "export {};\n",
    );

    const workspace = await prepareVisualizeRepoWorkspace({
      cwd: root,
      dryRun: false,
    });
    const manifest = readJson(path.join(root, "agent-native.json"));
    const app = (manifest.apps as Record<string, unknown>)["visualize-repo"] as
      | Record<string, unknown>
      | undefined;

    expect(workspace.created).toBe(true);
    expect(app).toMatchObject({
      mode: "local-files",
      root: ".agent-native/visual-docs",
      entry: ".agent-native/visual-docs/repo-overview",
    });
    expect(app?.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "actions", kind: "api" }),
        expect.objectContaining({ id: "app-components", kind: "component" }),
        expect.objectContaining({ id: "server-db-schema-ts", kind: "model" }),
      ]),
    );
    expect(fs.readFileSync(workspace.planPath, "utf8")).toContain("<FileTree");
    expect(fs.readFileSync(workspace.statePath, "utf8")).toContain(
      "visualDocs",
    );
  });

  it("merges explicit targets with existing visual docs config", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"demo"}\n');
    fs.writeFileSync(
      path.join(root, "agent-native.json"),
      JSON.stringify(
        {
          version: 1,
          apps: {
            "visualize-repo": {
              mode: "local-files",
              root: "docs/visual",
              entry: "docs/visual/current",
              targets: [
                {
                  id: "existing-api",
                  name: "Existing API",
                  kind: "api",
                  include: ["actions/existing.ts"],
                  blocks: ["api-endpoint"],
                  policy: "required-on-pr",
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );

    const workspace = await prepareVisualizeRepoWorkspace({
      cwd: root,
      targets: ["app/components/Button.tsx"],
      dryRun: false,
    });

    expect(workspace.targets.map((target) => target.id)).toEqual([
      "existing-api",
      "app-components-button-tsx",
    ]);
    expect(workspace.docsRoot).toBe(path.join(root, "docs", "visual"));
    expect(workspace.planDir).toBe(
      path.join(root, "docs", "visual", "current"),
    );
  });

  it("does not write files during dry-run setup", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"demo"}\n');
    fs.mkdirSync(path.join(root, "src"), { recursive: true });

    const workspace = await prepareVisualizeRepoWorkspace({
      cwd: root,
      dryRun: true,
    });

    expect(workspace.created).toBe(false);
    expect(fs.existsSync(path.join(root, "agent-native.json"))).toBe(false);
    expect(fs.existsSync(workspace.planPath)).toBe(false);
  });

  it("does not bootstrap files before check validates an existing visual docs folder", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"demo"}\n');
    const workspace = await prepareVisualizeRepoWorkspace({
      cwd: root,
      dir: "docs/repo-map",
      dryRun: false,
    });
    fs.rmSync(path.join(root, "agent-native.json"));

    const status = await withCwd(root, () =>
      runVisualizeRepo(["check", "--dir", "docs/repo-map"]),
    );

    expect(status).toBe(0);
    expect(fs.existsSync(path.join(root, "agent-native.json"))).toBe(false);
    expect(fs.existsSync(workspace.planPath)).toBe(true);
  });

  it("does not create a workspace when check fails before initialization", async () => {
    const root = tmpDir();
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"demo"}\n');

    await expect(
      withCwd(root, () => runVisualizeRepo(["check"])),
    ).rejects.toThrow();

    expect(fs.existsSync(path.join(root, "agent-native.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".agent-native"))).toBe(false);
  });
});
