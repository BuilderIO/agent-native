#!/usr/bin/env node
/**
 * Generates the committed plugin-marketplace bundle that turns this repository
 * itself into installable Agent-Native app marketplaces for both Claude Code and
 * Codex.
 *
 * The canonical skill content lives at the repo's top-level `skills/`
 * directory. This script copies each exported app skill into one shared plugin
 * directory per app and writes the Claude + Codex marketplace catalogs and
 * per-host plugin manifests. It mirrors `sync-workspace-core-skills.ts`: it
 * generates by default and validates with `--check`, failing with a clear "run
 * pnpm sync:plan-marketplace" message when the committed tree drifts from
 * source.
 *
 * Version strategy (shared with the generic app-skill packer):
 *  - Claude Code uses commit-SHA versioning, so plugin.json OMITS `version` and
 *    `autoUpdate: true` in the marketplace entry delivers updates on every push.
 *  - Codex keys its plugin cache on the version string, so the Codex plugin.json
 *    embeds a deterministic content hash of the exported SKILL.md bodies + MCP
 *    URL via `resolvePluginVersion`, so a changed skill yields a new version.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import prettier from "prettier";

import {
  type AppSkillManifest,
  type AppSkillManifestSkill,
  resolvePluginVersion,
} from "../packages/core/src/cli/app-skill.js";
import { BUILT_IN_APP_SKILLS } from "../packages/core/src/cli/skills.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, "..");
const sourceSkillsDir = join(rootDir, "skills");

type MarketplaceAppId = "visual-plans" | "design";

type MarketplaceApp = {
  appSkillId: MarketplaceAppId;
  skillSources: { sourceDir: string; exportAs: string }[];
  brandColor: string;
};

const APP_BUNDLES: MarketplaceApp[] = [
  {
    appSkillId: "visual-plans",
    // Source skill dir name -> exported skill name. The source dir name does not
    // always equal the exported skill name (skills/visual-plans -> visual-plan).
    skillSources: [
      { sourceDir: "visual-plans", exportAs: "visual-plan" },
      { sourceDir: "visual-recap", exportAs: "visual-recap" },
    ],
    brandColor: "#2563EB",
  },
  {
    appSkillId: "design",
    skillSources: [
      { sourceDir: "design-exploration", exportAs: "design-exploration" },
      { sourceDir: "visual-edit", exportAs: "visual-edit" },
    ],
    brandColor: "#0F766E",
  },
];

const CLAUDE_MARKETPLACE_NAME = "agent-native-apps";

const check = process.argv.includes("--check");

/** A virtual file the generator wants committed: repo-relative path -> contents. */
type GeneratedFile = { rel: string; content: string };

function manifestFor(app: MarketplaceApp): AppSkillManifest {
  return BUILT_IN_APP_SKILLS[app.appSkillId].manifest;
}

function pluginName(app: MarketplaceApp): string {
  return `agent-native-${manifestFor(app).id}`;
}

function bundleRoot(app: MarketplaceApp): string {
  return join(rootDir, ".agents", "plugins", pluginName(app));
}

function keywords(app: MarketplaceApp): string[] {
  return [
    "agent-native",
    manifestFor(app).id,
    "mcp",
    "skills",
    "app-backed-skill",
  ];
}

function readSkillSource(sourceDir: string): string {
  const file = join(sourceSkillsDir, sourceDir, "SKILL.md");
  if (!existsSync(file)) {
    throw new Error(`Canonical app skill source not found: ${file}`);
  }
  return readFileSync(file, "utf-8");
}

/**
 * Sibling files inside a source skill dir (everything except SKILL.md), as
 * sorted posix-relative paths. These are the progressive-disclosure reference
 * files (e.g. references/wireframe.md) that ship next to SKILL.md.
 */
function listSkillSiblingFiles(sourceDir: string): string[] {
  const root = join(sourceSkillsDir, sourceDir);
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (entry.isFile() && rel !== "SKILL.md") out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

/**
 * Rewrite the SKILL.md frontmatter `name:` field to the exported skill name,
 * matching the generic app-skill packer's `rewriteSkillFrontmatterName`. The
 * committed copy uses the exportAs name even when the source dir differs.
 */
function rewriteSkillFrontmatterName(source: string, name: string): string {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") return source;
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (end <= 0) return source;
  const nameIndex = lines.findIndex(
    (line, index) => index > 0 && index < end && /^name\s*:/.test(line),
  );
  if (nameIndex === -1) {
    lines.splice(1, 0, `name: ${name}`);
  } else {
    lines[nameIndex] = `name: ${name}`;
  }
  return lines.join("\n");
}

/**
 * Format JSON through Prettier so the committed bundle stays deterministic;
 * `pnpm fmt` now verifies the result through oxfmt, and the marketplace guard
 * should not be the first place drift appears.
 */
async function jsonFile(rel: string, value: unknown): Promise<GeneratedFile> {
  const content = await prettier.format(JSON.stringify(value), {
    parser: "json",
  });
  return { rel, content };
}

/**
 * Build a manifest-shaped object whose skill `path` values point at the real
 * on-disk source dirs (relative to repo root) so the content hash and the
 * resolved Codex version are computed over the exact canonical bytes we commit.
 */
function hashManifestSkills(app: MarketplaceApp): AppSkillManifestSkill[] {
  return app.skillSources.map(({ sourceDir, exportAs }) => ({
    path: join("skills", sourceDir),
    visibility: "exported" as const,
    exportAs,
  }));
}

function codexPluginVersion(app: MarketplaceApp): string {
  return resolvePluginVersion(
    manifestFor(app),
    rootDir,
    hashManifestSkills(app),
  );
}

async function expectedFiles(): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];

  for (const app of APP_BUNDLES) {
    const manifest = manifestFor(app);
    const name = pluginName(app);

    // Generated copies of the canonical skills under the shared plugin dir,
    // including any sibling reference files (e.g. references/wireframe.md) so
    // the packaged plugin ships the same progressive-disclosure files as
    // `skills/`.
    for (const { sourceDir, exportAs } of app.skillSources) {
      const body = rewriteSkillFrontmatterName(
        readSkillSource(sourceDir),
        exportAs,
      );
      files.push({
        rel: join(".agents", "plugins", name, "skills", exportAs, "SKILL.md"),
        content: body,
      });
      for (const rel of listSkillSiblingFiles(sourceDir)) {
        files.push({
          rel: join(".agents", "plugins", name, "skills", exportAs, rel),
          content: readFileSync(join(sourceSkillsDir, sourceDir, rel), "utf-8"),
        });
      }
    }

    // Only the canonical serverName goes into the plugin .mcp.json. Aliases are
    // handled as a cleanup list by ensureAppSkill / connect — writing them here
    // would create duplicate OAuth sessions in the host agent.
    const mcpServers = {
      mcpServers: {
        [manifest.mcp.serverName]: {
          type: "http" as const,
          url: manifest.hosted.mcpUrl,
        },
      },
    };

    // Shared .mcp.json for both hosts.
    files.push(
      await jsonFile(join(".agents", "plugins", name, ".mcp.json"), mcpServers),
    );

    // Claude manifest — OMIT version (commit-SHA versioning).
    files.push(
      await jsonFile(
        join(".agents", "plugins", name, ".claude-plugin", "plugin.json"),
        {
          name,
          displayName: manifest.displayName,
          description: manifest.description,
          author: {
            name: "Agent-Native",
            url: "https://agent-native.com",
          },
          homepage: manifest.hosted.url,
          repository: "https://github.com/BuilderIO/agent-native",
          license: "MIT",
          keywords: keywords(app),
          skills: "./skills/",
          mcpServers: "./.mcp.json",
        },
      ),
    );

    // Codex manifest — version = content-hash version.
    files.push(
      await jsonFile(
        join(".agents", "plugins", name, ".codex-plugin", "plugin.json"),
        {
          name,
          version: codexPluginVersion(app),
          description: manifest.description,
          author: {
            name: "Agent-Native",
            url: "https://agent-native.com",
          },
          homepage: manifest.hosted.url,
          license: "MIT",
          keywords: keywords(app),
          skills: "./skills/",
          mcpServers: "./.mcp.json",
          interface: {
            displayName: manifest.displayName,
            shortDescription: manifest.description,
            longDescription:
              `${manifest.displayName} packages agent instructions, app actions, ` +
              "an MCP connector, and inline UI surfaces as an installable skill. " +
              `The plugin connects to hosted ${manifest.displayName} by default; ` +
              "use the Agent-Native CLI when you need a custom/self-hosted app URL.",
            developerName: "Agent-Native",
            category: "Productivity",
            capabilities: ["Interactive", "Read", "Write"],
            websiteURL: manifest.hosted.url,
            defaultPrompt: [
              `Open ${manifest.displayName} where useful`,
              `Use ${manifest.displayName} for app-backed workflows`,
              `Search ${manifest.displayName} and return usable context`,
            ],
            brandColor: app.brandColor,
          },
        },
      ),
    );
  }

  // Claude catalog at repo root.
  files.push(
    await jsonFile(join(".claude-plugin", "marketplace.json"), {
      name: CLAUDE_MARKETPLACE_NAME,
      description:
        "Agent-Native app-backed skills that bundle instructions, MCP connectors, and UI surfaces.",
      owner: {
        name: "Agent-Native",
      },
      plugins: APP_BUNDLES.map((app) => {
        const manifest = manifestFor(app);
        const name = pluginName(app);
        return {
          name,
          displayName: manifest.displayName,
          description: manifest.description,
          source: `./.agents/plugins/${name}`,
          autoUpdate: true,
          homepage: manifest.hosted.url,
          keywords: keywords(app),
        };
      }),
    }),
  );

  // Codex catalog under .agents/plugins. `source` is a sibling local path with
  // no `..` segments, matching MarketplacePluginSourceObject::Local.
  files.push(
    await jsonFile(join(".agents", "plugins", "marketplace.json"), {
      name: CLAUDE_MARKETPLACE_NAME,
      interface: {
        displayName:
          "Agent-Native app-backed skills that bundle instructions, MCP connectors, and UI surfaces.",
      },
      plugins: APP_BUNDLES.map((app) => {
        const name = pluginName(app);
        return {
          name,
          source: {
            source: "local",
            path: `./${name}`,
          },
        };
      }),
    }),
  );

  return files;
}

function generate(files: GeneratedFile[]): void {
  // Replace each generated bundle dir wholesale so removed skills don't linger,
  // but keep the catalog files (written individually below).
  for (const app of APP_BUNDLES) {
    rmSync(bundleRoot(app), { recursive: true, force: true });
  }
  for (const file of files) {
    const abs = join(rootDir, file.rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content, "utf-8");
  }
}

function listGeneratedOnDisk(): string[] {
  // Everything the generator owns lives under the bundle dirs plus the two
  // catalog files.
  const owned: string[] = [];
  const catalogs = [
    join(".claude-plugin", "marketplace.json"),
    join(".agents", "plugins", "marketplace.json"),
  ];
  for (const rel of catalogs) {
    if (existsSync(join(rootDir, rel))) owned.push(rel);
  }
  for (const app of APP_BUNDLES) {
    const root = bundleRoot(app);
    if (existsSync(root)) {
      walk(root, (abs) => {
        owned.push(relative(rootDir, abs));
      });
    }
  }
  return owned.sort();
}

function walk(dir: string, onFile: (abs: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, onFile);
    else if (entry.isFile()) onFile(abs);
  }
}

function checkInSync(files: GeneratedFile[]): void {
  const expectedSet = new Set(files.map((file) => file.rel));
  const actual = listGeneratedOnDisk();
  const actualSet = new Set(actual);

  const missing = files
    .filter((file) => !actualSet.has(file.rel))
    .map((file) => file.rel);
  const extra = actual.filter((rel) => !expectedSet.has(rel));
  const changed = files
    .filter((file) => actualSet.has(file.rel))
    .filter(
      (file) => readFileSync(join(rootDir, file.rel), "utf-8") !== file.content,
    )
    .map((file) => file.rel);

  if (missing.length === 0 && extra.length === 0 && changed.length === 0) {
    return;
  }

  const sections: string[] = [];
  if (missing.length > 0) sections.push(`Missing:\n${missing.join("\n")}`);
  if (extra.length > 0) sections.push(`Extra:\n${extra.join("\n")}`);
  if (changed.length > 0) sections.push(`Changed:\n${changed.join("\n")}`);
  throw new Error(
    `App marketplace bundles are out of sync with skills/ source.\n\n${sections.join(
      "\n\n",
    )}\n\nRun: pnpm sync:plan-marketplace`,
  );
}

function versionSummary(): string {
  return APP_BUNDLES.map(
    (app) => `${pluginName(app)} ${codexPluginVersion(app)}`,
  ).join(", ");
}

async function main(): Promise<void> {
  const files = await expectedFiles();
  if (check) {
    checkInSync(files);
    console.log(`App marketplace bundles are in sync (${versionSummary()}).`);
  } else {
    generate(files);
    checkInSync(files);
    console.log(
      `Synced app marketplace bundles from skills/ (${versionSummary()}).`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
