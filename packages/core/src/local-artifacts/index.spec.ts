import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
const RUNTIME_ENV_NAMES = [
  "AGENT_NATIVE_MODE",
  "AGENT_NATIVE_DATA_MODE",
  "AGENT_NATIVE_MANIFEST",
  "AGENT_NATIVE_MANIFEST_PATH",
  "AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION",
  "AGENT_NATIVE_DESKTOP_CHILD",
  "NODE_ENV",
  "DATABASE_URL",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "NETLIFY",
  "DEPLOY_ID",
  "NETLIFY_IMAGES_CDN_DOMAIN",
  "CF_PAGES",
  "CF_WORKER",
  "CLOUDFLARE_WORKERS",
  "WORKERS_CI",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "LAMBDA_TASK_ROOT",
  "FUNCTIONS_WORKER_RUNTIME",
  "WEBSITE_INSTANCE_ID",
  "K_SERVICE",
  "K_REVISION",
  "DENO_DEPLOYMENT_ID",
  "FLY_APP_NAME",
  "RENDER",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "SERVERLESS",
  "SERVERLESS_STAGE",
  "NITRO_PRESET",
] as const;
const OLD_ENV = Object.fromEntries(
  RUNTIME_ENV_NAMES.map((name) => [name, process.env[name]]),
) as Record<(typeof RUNTIME_ENV_NAMES)[number], string | undefined>;

beforeEach(() => {
  for (const name of RUNTIME_ENV_NAMES) delete process.env[name];
});

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

  it("refuses the legacy production override but allows a local desktop child", async () => {
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
    ).rejects.toThrow("no longer accepted as a production bypass");

    process.env.AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION = "true";
    await expect(
      resolveAgentNativeDataMode({ cwd: root, appId: "content", manifestPath }),
    ).rejects.toThrow("no longer accepted as a production bypass");

    process.env.AGENT_NATIVE_DESKTOP_CHILD = "1";
    await expect(
      resolveAgentNativeDataMode({ cwd: root, appId: "content", manifestPath }),
    ).resolves.toBe("local-files");
  });

  it.each([
    ["Vercel", "VERCEL", "1"],
    ["Netlify", "NETLIFY", "true"],
    ["Cloudflare", "CF_PAGES", "1"],
    ["generic serverless", "SERVERLESS", "1"],
    ["Nitro serverless preset", "NITRO_PRESET", "aws-lambda"],
  ])(
    "rejects local file mode on %s even with every local override",
    async (_runtime, envName, envValue) => {
      const root = tmpDir();
      const manifestPath = path.join(root, "agent-native.json");
      writeJson(manifestPath, { mode: "local-files" });
      process.env[envName] = envValue;
      process.env.AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION = "true";
      process.env.AGENT_NATIVE_DESKTOP_CHILD = "1";

      await expect(
        resolveAgentNativeDataMode({ manifestPath }),
      ).rejects.toThrow("hosted or serverless runtimes");
    },
  );

  it("rejects a remote database-backed runtime even outside production", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, { mode: "local-files" });
    process.env.DATABASE_URL = "postgresql://example.invalid/app";
    process.env.AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION = "true";
    process.env.AGENT_NATIVE_DESKTOP_CHILD = "1";

    await expect(resolveAgentNativeDataMode({ manifestPath })).rejects.toThrow(
      "remote database-backed runtimes",
    );
  });

  it("keeps database mode available in hosted runtimes", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, { mode: "database" });
    process.env.VERCEL = "1";
    process.env.DATABASE_URL = "postgresql://example.invalid/app";

    await expect(resolveAgentNativeDataMode({ manifestPath })).resolves.toBe(
      "database",
    );
  });

  it("keeps local development and local SQLite usable", async () => {
    const root = tmpDir();
    const manifestPath = path.join(root, "agent-native.json");
    writeJson(manifestPath, { mode: "local-files" });
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = `file:${path.join(root, "app.db")}`;

    await expect(resolveAgentNativeDataMode({ manifestPath })).resolves.toBe(
      "local-files",
    );
  });

  it("keeps concurrent workspace roots and write locks isolated", async () => {
    const firstRoot = tmpDir();
    const secondRoot = tmpDir();
    const firstManifest = path.join(firstRoot, "agent-native.json");
    const secondManifest = path.join(secondRoot, "agent-native.json");
    for (const [manifestPath, label] of [
      [firstManifest, "first"],
      [secondManifest, "second"],
    ]) {
      writeJson(manifestPath, {
        mode: "local-files",
        apps: { content: { roots: [{ path: "docs" }] } },
      });
      fs.mkdirSync(path.join(path.dirname(manifestPath), "docs"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(path.dirname(manifestPath), "docs", "same.md"),
        label,
      );
    }

    await Promise.all([
      writeLocalArtifactFile({
        appId: "content",
        manifestPath: firstManifest,
        path: "docs/same.md",
        content: "first updated",
      }),
      writeLocalArtifactFile({
        appId: "content",
        manifestPath: secondManifest,
        path: "docs/same.md",
        content: "second updated",
      }),
    ]);

    const [first, second] = await Promise.all([
      readLocalArtifactFile({
        appId: "content",
        manifestPath: firstManifest,
        path: "docs/same.md",
      }),
      readLocalArtifactFile({
        appId: "content",
        manifestPath: secondManifest,
        path: "docs/same.md",
      }),
    ]);
    expect(first?.content).toBe("first updated");
    expect(second?.content).toBe("second updated");
    expect(first?.absolutePath.startsWith(firstRoot)).toBe(true);
    expect(second?.absolutePath.startsWith(secondRoot)).toBe(true);
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
