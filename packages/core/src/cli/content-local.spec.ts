import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseContentLocalArgs,
  prepareContentLocalLaunch,
} from "./content-local.js";

const tmpRoots: string[] = [];

function tmpDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-content-cli-"));
  tmpRoots.push(root);
  return root;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("content local CLI", () => {
  it("treats explicit help as a successful command", async () => {
    const { runContentLocal } = await import("./content-local.js");
    await expect(runContentLocal(["--help"])).resolves.toBe(0);
  });

  it("parses local file launch flags", () => {
    expect(
      parseContentLocalArgs([
        "local-files",
        "docs",
        "--no-open",
        "--port",
        "9090",
        "--profile",
        "docs/no-bookkeeping",
      ]),
    ).toMatchObject({
      target: "docs",
      open: false,
      port: 9090,
      profile: "docs/no-bookkeeping",
    });
  });

  it("writes a database-backed local folder source manifest", async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });

    const plan = await prepareContentLocalLaunch({
      cwd: root,
      target: "docs",
      profile: "docs/no-bookkeeping",
      dryRun: false,
    });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "agent-native.json"), "utf8"),
    );

    expect(plan.rootPath).toBe("docs");
    expect(plan.env).not.toHaveProperty("AGENT_NATIVE_MODE");
    expect(plan.url).toContain("/local-files?connectionId=local-folder%3A");
    expect(manifest.apps.content).toMatchObject({
      roots: [
        {
          path: "docs",
          profile: "docs/no-bookkeeping",
          extensions: [".md", ".mdx"],
          source: {
            type: "local-folder",
            connectionId: plan.connectionId,
            truthPolicy: "source_primary",
          },
        },
      ],
    });
    expect(manifest.apps.content).not.toHaveProperty("mode");
  });

  it("deep-links to a file without narrowing an existing broad root", async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "guide.mdx"), "# Guide", "utf8");
    writeJson(path.join(root, "agent-native.json"), {
      version: 1,
      apps: {
        content: {
          mode: "local-files",
          roots: [{ name: "Docs", path: "docs", extensions: [".mdx"] }],
        },
      },
    });

    const plan = await prepareContentLocalLaunch({
      cwd: root,
      target: "docs/guide.mdx",
      dryRun: false,
      port: 9091,
    });
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "agent-native.json"), "utf8"),
    );

    expect(plan.filePath).toBe("docs/guide.mdx");
    expect(plan.url).toBe(
      `http://127.0.0.1:9091/local-files?connectionId=${encodeURIComponent(
        plan.connectionId,
      )}&file=docs%2Fguide.mdx`,
    );
    expect(manifest.apps.content.roots[0].name).toBe("Docs");
    expect(manifest.apps.content.roots[0]).not.toHaveProperty("include");
    expect(manifest.apps.content.roots[0].source).toMatchObject({
      type: "local-folder",
      connectionId: plan.connectionId,
      truthPolicy: "source_primary",
    });
    expect(manifest.apps.content).not.toHaveProperty("mode");
  });

  it("migrates every legacy local-files root before removing the app mode", async () => {
    const root = tmpDir();
    for (const directory of ["docs", "blog", "resources"]) {
      fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    writeJson(path.join(root, "agent-native.json"), {
      version: 1,
      apps: {
        content: {
          mode: "local-files",
          roots: [
            { name: "Docs", path: "docs" },
            { name: "Blog", path: "blog" },
            { name: "Resources", path: "resources" },
          ],
        },
      },
    });

    await prepareContentLocalLaunch({
      cwd: root,
      target: "docs",
      dryRun: false,
    });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "agent-native.json"), "utf8"),
    );
    expect(manifest.apps.content).not.toHaveProperty("mode");
    expect(manifest.apps.content.roots).toHaveLength(3);
    for (const manifestRoot of manifest.apps.content.roots) {
      expect(manifestRoot.source).toMatchObject({
        type: "local-folder",
        truthPolicy: "source_primary",
      });
      expect(manifestRoot.source.connectionId).toMatch(/^local-folder:/);
    }
  });

  it("accumulates repeated file targets under a CLI-created root", async () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "one.md"), "# One", "utf8");
    fs.writeFileSync(path.join(root, "docs", "two.md"), "# Two", "utf8");

    await prepareContentLocalLaunch({
      cwd: root,
      target: "docs/one.md",
      dryRun: false,
    });
    await prepareContentLocalLaunch({
      cwd: root,
      target: "docs/two.md",
      dryRun: false,
    });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "agent-native.json"), "utf8"),
    );
    expect(manifest.apps.content.roots).toHaveLength(1);
    expect(manifest.apps.content.roots[0].include).toEqual([
      "docs/one.md",
      "docs/two.md",
    ]);
  });
});
