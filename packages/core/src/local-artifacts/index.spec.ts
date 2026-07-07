import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  deleteLocalArtifactFile,
  deleteLocalWorkspaceResource,
  findAgentNativeManifest,
  getLocalArtifactApp,
  listLocalWorkspaceResources,
  listLocalArtifactFiles,
  readLocalArtifactFile,
  readLocalWorkspaceResource,
  resolveAgentNativeDataMode,
  writeLocalArtifactFile,
  writeLocalWorkspaceResource,
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

  it("treats an explicit empty roots array as no local roots", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      mode: "local-files",
      apps: {
        content: {
          roots: [],
        },
      },
    });
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "intro.mdx"), "# Intro", "utf8");

    const files = await listLocalArtifactFiles({
      appId: "content",
      manifestPath,
      defaults: {
        roots: [{ path: "docs", extensions: [".mdx"] }],
      },
    });

    expect(files).toEqual([]);
  });

  it("loads configured local component and extension roots", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      mode: "local-files",
      apps: {
        content: {
          roots: [{ path: "docs", extensions: [".mdx"] }],
          components: "components",
          extensions: ["extensions", "widgets"],
        },
      },
    });

    const app = await getLocalArtifactApp({
      appId: "content",
      manifestPath,
    });

    expect(app.components).toEqual(["components"]);
    expect(app.extensions).toEqual(["extensions", "widgets"]);
  });

  it("propagates local file profiles from app and root config", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      mode: "local-files",
      apps: {
        content: {
          profile: "docs/no-bookkeeping",
          roots: [
            { path: "docs", extensions: [".mdx"] },
            {
              path: "blog",
              profile: "content/default-bookkeeping",
              extensions: [".mdx"],
            },
          ],
        },
      },
    });
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.mkdirSync(path.join(root, "blog"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "intro.mdx"), "# Intro", "utf8");
    fs.writeFileSync(path.join(root, "blog", "launch.mdx"), "# Launch", "utf8");

    const app = await getLocalArtifactApp({ appId: "content", manifestPath });
    const files = await listLocalArtifactFiles({
      appId: "content",
      manifestPath,
    });

    expect(app.profile).toBe("docs/no-bookkeeping");
    expect(app.roots.map((entry) => [entry.path, entry.profile])).toEqual([
      ["docs", "docs/no-bookkeeping"],
      ["blog", "content/default-bookkeeping"],
    ]);
    expect(files.map((entry) => [entry.path, entry.profile])).toEqual([
      ["blog/launch.mdx", "content/default-bookkeeping"],
      ["docs/intro.mdx", "docs/no-bookkeeping"],
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

  it("lists local workspace AGENTS, skills, manifest, and MCP config as resources", async () => {
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
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Repo Agents", "utf8");
    fs.writeFileSync(
      path.join(root, "mcp.config.json"),
      '{"servers":{"docs":{"type":"http","url":"https://example.test/mcp"}}}',
      "utf8",
    );
    fs.mkdirSync(path.join(root, ".agents", "skills", "review", "references"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, ".agents", "skills", "review", "SKILL.md"),
      "---\nname: review\n---\n# Review",
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, ".agents", "skills", "review", "references", "rubric.md"),
      "# Rubric",
      "utf8",
    );

    const resources = await listLocalWorkspaceResources({ manifestPath });

    expect(resources.map((resource) => resource.path)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "agent-native.json",
        "mcp.config.json",
        "skills/review/SKILL.md",
        "skills/review/references/rubric.md",
      ]),
    );
    expect(resources).toHaveLength(5);
  });

  it("reads and writes local workspace resources through resource paths", async () => {
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

    const written = await writeLocalWorkspaceResource({
      manifestPath,
      path: "skills/local-review/SKILL.md",
      content: "---\nname: local-review\n---\n# Local Review",
    });
    const read = await readLocalWorkspaceResource({
      manifestPath,
      path: "skills/local-review/SKILL.md",
    });

    expect(written.path).toBe("skills/local-review/SKILL.md");
    expect(read?.content).toContain("# Local Review");
    expect(
      fs.readFileSync(
        path.join(root, ".agents", "skills", "local-review", "SKILL.md"),
        "utf8",
      ),
    ).toContain("# Local Review");
  });

  it("updates legacy .agent skills in place", async () => {
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
    const legacySkillPath = path.join(
      root,
      ".agent",
      "skills",
      "legacy-review",
      "SKILL.md",
    );
    fs.mkdirSync(path.dirname(legacySkillPath), { recursive: true });
    fs.writeFileSync(legacySkillPath, "# Legacy Review", "utf8");

    const resources = await listLocalWorkspaceResources({ manifestPath });
    expect(resources.map((resource) => resource.path)).toContain(
      "skills/legacy-review/SKILL.md",
    );

    const read = await readLocalWorkspaceResource({
      manifestPath,
      path: "skills/legacy-review/SKILL.md",
    });
    expect(read?.absolutePath).toBe(legacySkillPath);
    expect(read?.content).toBe("# Legacy Review");

    await writeLocalWorkspaceResource({
      manifestPath,
      path: "skills/legacy-review/SKILL.md",
      content: "# Updated Legacy Review",
    });

    expect(fs.readFileSync(legacySkillPath, "utf8")).toBe(
      "# Updated Legacy Review",
    );
    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "legacy-review", "SKILL.md"),
      ),
    ).toBe(false);
  });

  it("deletes duplicate skills from both current and legacy skill roots", async () => {
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
    const currentSkillPath = path.join(
      root,
      ".agents",
      "skills",
      "dual-review",
      "SKILL.md",
    );
    const legacySkillPath = path.join(
      root,
      ".agent",
      "skills",
      "dual-review",
      "SKILL.md",
    );
    fs.mkdirSync(path.dirname(currentSkillPath), { recursive: true });
    fs.mkdirSync(path.dirname(legacySkillPath), { recursive: true });
    fs.writeFileSync(currentSkillPath, "# Current Review", "utf8");
    fs.writeFileSync(legacySkillPath, "# Legacy Review", "utf8");

    await expect(
      deleteLocalWorkspaceResource({
        manifestPath,
        path: "skills/dual-review/SKILL.md",
      }),
    ).resolves.toBe(true);

    expect(fs.existsSync(currentSkillPath)).toBe(false);
    expect(fs.existsSync(legacySkillPath)).toBe(false);
  });

  it("does not expose local workspace resources outside local file mode", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      mode: "database",
      apps: {
        content: {
          roots: [{ path: "docs", extensions: [".mdx"] }],
        },
      },
    });
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Repo Agents", "utf8");

    await expect(
      listLocalWorkspaceResources({ manifestPath }),
    ).resolves.toEqual([]);
    await expect(
      readLocalWorkspaceResource({ manifestPath, path: "AGENTS.md" }),
    ).resolves.toBeNull();
  });

  it("does not expose local workspace resources for app-scoped local file mode", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, {
      mode: "database",
      apps: {
        content: {
          mode: "local-files",
          roots: [{ path: "docs", extensions: [".mdx"] }],
        },
      },
    });
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Repo Agents", "utf8");

    await expect(
      listLocalWorkspaceResources({ manifestPath }),
    ).resolves.toEqual([]);
    await expect(
      readLocalWorkspaceResource({ manifestPath, path: "AGENTS.md" }),
    ).resolves.toBeNull();
  });
});
