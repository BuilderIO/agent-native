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

  it("writes a local file mode manifest for a target folder", async () => {
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
    expect(manifest.apps.content).toMatchObject({
      mode: "local-files",
      roots: [
        {
          path: "docs",
          profile: "docs/no-bookkeeping",
          extensions: [".md", ".mdx"],
        },
      ],
    });
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
      `http://127.0.0.1:9091/page/local-file:${Buffer.from(
        "docs/guide.mdx",
        "utf8",
      ).toString("base64url")}`,
    );
    expect(manifest.apps.content.roots[0].name).toBe("Docs");
    expect(manifest.apps.content.roots[0]).not.toHaveProperty("include");
  });
});
