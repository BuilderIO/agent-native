import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  deleteLocalArtifactFile,
  findAgentNativeManifest,
  listLocalArtifactFiles,
  readLocalArtifactFile,
  resolveAgentNativeDataMode,
  writeLocalArtifactFile,
} from "./index.js";

const tmpRoots: string[] = [];
const OLD_ENV = {
  AGENT_NATIVE_MODE: process.env.AGENT_NATIVE_MODE,
  AGENT_NATIVE_DATA_MODE: process.env.AGENT_NATIVE_DATA_MODE,
  AGENT_NATIVE_MANIFEST: process.env.AGENT_NATIVE_MANIFEST,
  AGENT_NATIVE_MANIFEST_PATH: process.env.AGENT_NATIVE_MANIFEST_PATH,
  AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION:
    process.env.AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION,
  NODE_ENV: process.env.NODE_ENV,
};

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  for (const [key, value] of Object.entries(OLD_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-local-artifacts-"));
  tmpRoots.push(root);
  return root;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("local artifact helpers", () => {
  it("discovers manifests and resolves explicit local file mode", async () => {
    const root = tmpDir();
    const nested = path.join(root, "apps", "content");
    fs.mkdirSync(nested, { recursive: true });
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      version: 1,
      mode: "local-files",
      apps: {
        content: {
          roots: [{ path: "docs", extensions: [".mdx"] }],
        },
      },
    });

    expect(findAgentNativeManifest(nested)).toBe(manifestPath);
    await expect(
      resolveAgentNativeDataMode({ cwd: nested, appId: "content" }),
    ).resolves.toBe("local-files");
  });

  it("defaults to database mode without a manifest or env override", async () => {
    const root = tmpDir();

    await expect(
      resolveAgentNativeDataMode({ cwd: root, appId: "content" }),
    ).resolves.toBe("database");
  });

  it("requires an explicit production override for local file mode", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      mode: "local-files",
      apps: {
        content: {
          roots: [{ path: "docs", extensions: [".mdx"] }],
        },
      },
    });
    process.env.NODE_ENV = "production";

    await expect(
      resolveAgentNativeDataMode({ cwd: root, appId: "content" }),
    ).rejects.toThrow("trusted single-tenant local file bridge");

    process.env.AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION = "true";
    await expect(
      resolveAgentNativeDataMode({ cwd: root, appId: "content", manifestPath }),
    ).resolves.toBe("local-files");
  });

  it("lists only configured files inside local roots", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      mode: "local-files",
      apps: {
        content: {
          roots: [
            {
              name: "Docs",
              path: "docs",
              extensions: [".md", ".mdx"],
              hide: ["**/_*.mdx"],
            },
            { name: "Blog", path: "blog", extensions: [".md"] },
          ],
        },
      },
    });
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.mkdirSync(path.join(root, "blog"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "intro.mdx"), "# Intro", "utf8");
    fs.writeFileSync(path.join(root, "docs", "_draft.mdx"), "# Draft", "utf8");
    fs.writeFileSync(path.join(root, "docs", "data.json"), "{}", "utf8");
    fs.writeFileSync(path.join(root, "blog", "launch.md"), "# Launch", "utf8");

    const files = await listLocalArtifactFiles({
      appId: "content",
      manifestPath,
    });

    expect(files.map((file) => file.path)).toEqual([
      "blog/launch.md",
      "docs/intro.mdx",
    ]);
  });

  it("writes atomically and rejects stale expected hashes", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      mode: "local-files",
      apps: {
        content: {
          roots: [{ path: "docs", extensions: [".mdx"] }],
        },
      },
    });

    const first = await writeLocalArtifactFile({
      appId: "content",
      manifestPath,
      path: "docs/intro.mdx",
      content: "# Intro",
    });
    const read = await readLocalArtifactFile({
      appId: "content",
      manifestPath,
      path: "docs/intro.mdx",
    });

    expect(read?.content).toBe("# Intro");
    await expect(
      writeLocalArtifactFile({
        appId: "content",
        manifestPath,
        path: "docs/intro.mdx",
        content: "# New",
        expectedHash: "stale",
      }),
    ).rejects.toThrow("changed on disk");

    const second = await writeLocalArtifactFile({
      appId: "content",
      manifestPath,
      path: "docs/intro.mdx",
      content: "# New",
      expectedHash: first.hash,
    });
    expect(second.hash).not.toBe(first.hash);
    expect(second.hash).toBe(
      crypto.createHash("sha256").update("# New").digest("hex"),
    );
  });

  it("rejects concurrent writes that race with the same expected hash", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      mode: "local-files",
      apps: {
        content: {
          roots: [{ path: "docs", extensions: [".mdx"] }],
        },
      },
    });

    const first = await writeLocalArtifactFile({
      appId: "content",
      manifestPath,
      path: "docs/intro.mdx",
      content: "# Intro",
    });

    const results = await Promise.allSettled([
      writeLocalArtifactFile({
        appId: "content",
        manifestPath,
        path: "docs/intro.mdx",
        content: "# One",
        expectedHash: first.hash,
      }),
      writeLocalArtifactFile({
        appId: "content",
        manifestPath,
        path: "docs/intro.mdx",
        content: "# Two",
        expectedHash: first.hash,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const read = await readLocalArtifactFile({
      appId: "content",
      manifestPath,
      path: "docs/intro.mdx",
    });
    expect(["# One", "# Two"]).toContain(read?.content);
  });

  it("blocks traversal outside configured roots", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      mode: "local-files",
      apps: {
        content: {
          roots: [{ path: "docs", extensions: [".mdx"] }],
        },
      },
    });

    await expect(
      readLocalArtifactFile({
        appId: "content",
        manifestPath,
        path: "../secret.mdx",
      }),
    ).rejects.toThrow("safe relative path");
    await expect(
      deleteLocalArtifactFile({
        appId: "content",
        manifestPath,
        path: "blog/post.mdx",
      }),
    ).rejects.toThrow("not in a configured local root");
  });

  it("blocks symlink escapes inside configured roots", async () => {
    const root = tmpDir();
    const outside = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      mode: "local-files",
      apps: {
        content: {
          roots: [{ path: "docs", extensions: [".mdx"] }],
        },
      },
    });
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(outside, "secret.mdx"), "# Secret", "utf8");
    fs.symlinkSync(
      path.join(outside, "secret.mdx"),
      path.join(root, "docs", "secret.mdx"),
    );

    await expect(
      readLocalArtifactFile({
        appId: "content",
        manifestPath,
        path: "docs/secret.mdx",
      }),
    ).rejects.toThrow("must not traverse a symlink");
  });
});
