#!/usr/bin/env node
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
  AGENT_PLUGIN_MCP_SCHEMA,
  AGENT_PLUGIN_SCHEMA,
} from "../packages/core/src/cli/agent-plugin.js";
import {
  type AppSkillManifest,
  type AppSkillManifestSkill,
  resolvePluginVersion,
} from "../packages/core/src/cli/app-skill.js";
import { AN_COMMAND_MD } from "../packages/core/src/cli/skills-content/an-skill.js";
import { BUILT_IN_APP_SKILLS } from "../packages/core/src/cli/skills.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, "..");

type MarketplaceAppId =
  | "agent-native"
  | "visual-plans"
  | "design"
  | "turn-into-app";

type MarketplaceApp = {
  appSkillId?: MarketplaceAppId;
  manifest?: AppSkillManifest;
  skillSources: { sourcePath: string; exportAs: string }[];
  brandColor: string;
  chatgptConnector?: boolean;
};

const APP_BUNDLES: MarketplaceApp[] = [
  {
    appSkillId: "agent-native",
    skillSources: [{ sourcePath: "skills/an", exportAs: "an" }],
    brandColor: "#0F766E",
    chatgptConnector: true,
  },
  {
    appSkillId: "visual-plans",
    skillSources: [
      { sourcePath: "skills/visual-plans", exportAs: "visual-plan" },
      { sourcePath: "skills/visual-recap", exportAs: "visual-recap" },
      { sourcePath: "skills/visualize-repo", exportAs: "visualize-repo" },
    ],
    brandColor: "#2563EB",
  },
  {
    appSkillId: "design",
    skillSources: [
      {
        sourcePath: "skills/design-exploration",
        exportAs: "design-exploration",
      },
      { sourcePath: "skills/visual-edit", exportAs: "visual-edit" },
    ],
    brandColor: "#0F766E",
  },
  {
    appSkillId: "turn-into-app",
    skillSources: [
      { sourcePath: "skills/turn-into-app", exportAs: "turn-into-app" },
    ],
    brandColor: "#2563EB",
    chatgptConnector: true,
  },
];

const CLAUDE_MARKETPLACE_NAME = "agent-native-apps";

const check = process.argv.includes("--check");

type GeneratedFile = { rel: string; content: string };

function manifestFor(app: MarketplaceApp): AppSkillManifest {
  if (app.manifest) return app.manifest;
  if (!app.appSkillId)
    throw new Error("Marketplace app is missing a manifest.");
  return BUILT_IN_APP_SKILLS[app.appSkillId].manifest;
}

function pluginName(app: MarketplaceApp): string {
  const id = manifestFor(app).id;
  return id === "agent-native" ? id : `agent-native-${id}`;
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

function readSkillSource(sourcePath: string): string {
  const file = join(rootDir, sourcePath, "SKILL.md");
  if (!existsSync(file)) {
    throw new Error(`Canonical app skill source not found: ${file}`);
  }
  return readFileSync(file, "utf-8");
}

function listSkillSiblingFiles(sourcePath: string): string[] {
  const root = join(rootDir, sourcePath);
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

async function jsonFile(rel: string, value: unknown): Promise<GeneratedFile> {
  const content = await prettier.format(JSON.stringify(value), {
    parser: "json",
  });
  return { rel, content };
}

function hashManifestSkills(app: MarketplaceApp): AppSkillManifestSkill[] {
  return app.skillSources.map(({ sourcePath, exportAs }) => ({
    path: sourcePath,
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

    for (const { sourcePath, exportAs } of app.skillSources) {
      const body = rewriteSkillFrontmatterName(
        readSkillSource(sourcePath),
        exportAs,
      );
      files.push({
        rel: join(".agents", "plugins", name, "skills", exportAs, "SKILL.md"),
        content: body,
      });
      for (const rel of listSkillSiblingFiles(sourcePath)) {
        files.push({
          rel: join(".agents", "plugins", name, "skills", exportAs, rel),
          content: readFileSync(join(rootDir, sourcePath, rel), "utf-8"),
        });
      }
    }
    if (app.appSkillId === "agent-native") {
      files.push({
        rel: join(".agents", "plugins", name, "commands", "an.md"),
        content: AN_COMMAND_MD,
      });
    }

    const mcpServers = {
      mcpServers: {
        [manifest.mcp.serverName]: {
          type: "http" as const,
          url: manifest.hosted.mcpUrl,
        },
      },
    };

    files.push(
      await jsonFile(join(".agents", "plugins", name, "plugin.json"), {
        $schema: AGENT_PLUGIN_SCHEMA,
        name,
        version: codexPluginVersion(app),
        description: manifest.description,
        author: {
          name: "Agent-Native",
          url: "https://agent-native.com",
        },
        homepage: manifest.hosted.url,
        repository: "https://github.com/BuilderIO/agent-native",
        license: "MIT",
        keywords: keywords(app),
      }),
    );
    files.push(
      await jsonFile(join(".agents", "plugins", name, "mcp.json"), {
        $schema: AGENT_PLUGIN_MCP_SCHEMA,
        mcpServers: {
          [manifest.mcp.serverName]: {
            type: "streamable-http",
            url: manifest.hosted.mcpUrl,
          },
        },
      }),
    );

    files.push(
      await jsonFile(join(".agents", "plugins", name, ".mcp.json"), mcpServers),
    );

    if (app.chatgptConnector) {
      files.push(
        await jsonFile(
          join(
            ".agents",
            "plugins",
            name,
            "adapters",
            "chatgpt-mcp",
            "connector.json",
          ),
          {
            name: manifest.mcp.serverName,
            title: manifest.displayName,
            url: manifest.hosted.mcpUrl,
            auth: manifest.auth?.mode ?? "oauth",
            surfaces: manifest.surfaces,
          },
        ),
      );
    }

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
            path: `./.agents/plugins/${name}`,
          },
        };
      }),
    }),
  );

  return files;
}

function generate(files: GeneratedFile[]): void {
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
