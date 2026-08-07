import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  importAgentPlugin,
  loadAgentPlugin,
  parseAgentPluginArgs,
} from "./agent-plugin.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-agent-plugin-"));
  tmpRoots.push(root);
  return root;
}

function writePlugin(root: string): string {
  fs.mkdirSync(path.join(root, "skills", "meeting-helper", "references"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    JSON.stringify(
      {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "calendar-tools",
        version: "1.2.3",
        description: "Calendar workflow instructions.",
        author: { name: "Example Author", url: "https://example.com" },
        keywords: ["calendar", "agent-plugin"],
        extensions: { "example.extension": { ignored: true } },
        ignoredField: "ignored",
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, "skills", "meeting-helper", "SKILL.md"),
    [
      "---",
      "name: meeting-helper",
      "description: Find and prepare calendar meetings.",
      "---",
      "",
      "# Meeting helper",
      "",
      "Read the relevant calendar context before proposing a time.",
      "",
    ].join("\n"),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, "skills", "meeting-helper", "references", "rules.md"),
    "Use the workspace calendar policy.\n",
    "utf-8",
  );
  fs.mkdirSync(path.join(root, "skills", "invalid-name"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "skills", "invalid-name", "SKILL.md"),
    "---\nname: different-name\ndescription: Invalid fixture.\n---\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(root, "mcp.json"),
    JSON.stringify(
      {
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          calendar: {
            type: "streamable-http",
            url: "https://calendar.example.com/mcp",
            headers: { "X-Plugin-Header": "package-placeholder" },
          },
          local: {
            type: "stdio",
            command: "calendar-server",
            args: ["--stdio"],
          },
          events: {
            type: "sse",
            url: "https://events.example.com/sse",
          },
          unsafe: {
            type: "streamable-http",
            url: "https://127.0.0.1/private-mcp",
          },
        },
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );
  return root;
}

describe("Agent Plugin parsing", () => {
  it("parses the import target and validates independent components", () => {
    const root = tmpDir();
    const pluginRoot = writePlugin(path.join(root, "plugin"));

    expect(
      parseAgentPluginArgs([
        "import",
        pluginRoot,
        "--into=./workspace",
        "--dry-run",
        "--json",
      ]),
    ).toEqual({
      command: "import",
      source: pluginRoot,
      into: "./workspace",
      force: false,
      dryRun: true,
      printJson: true,
      yes: false,
    });

    const loaded = loadAgentPlugin(pluginRoot);
    expect(loaded.manifest.name).toBe("calendar-tools");
    expect(loaded.skills.map((skill) => skill.name)).toEqual([
      "meeting-helper",
    ]);
    expect(loaded.mcpServers).toMatchObject([
      {
        name: "calendar",
        type: "streamable-http",
        url: "https://calendar.example.com/mcp",
        headerCount: 1,
      },
    ]);
    expect(loaded.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component: "skill",
          name: "invalid-name",
        }),
        expect.objectContaining({ component: "mcp", name: "local" }),
        expect.objectContaining({ component: "mcp", name: "events" }),
        expect.objectContaining({ component: "mcp", name: "unsafe" }),
      ]),
    );
    expect(loaded.warnings.join("\n")).not.toContain("package-placeholder");
    expect(loaded.pluginHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Agent Plugin import", () => {
  it("supports a dry run without creating workspace files", () => {
    const root = tmpDir();
    const pluginRoot = writePlugin(path.join(root, "plugin"));
    const workspace = path.join(root, "workspace");

    const result = importAgentPlugin(pluginRoot, {
      targetDir: workspace,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.skills[0].status).toBe("would-import");
    expect(result.mcpServers[0].status).toBe("would-import");
    expect(fs.existsSync(workspace)).toBe(false);
  });

  it("imports Skills and remote MCP without package credentials", () => {
    const root = tmpDir();
    const pluginRoot = writePlugin(path.join(root, "plugin"));
    const workspace = path.join(root, "workspace");

    const result = importAgentPlugin(pluginRoot, { targetDir: workspace });
    const skillPath = path.join(
      workspace,
      "skills",
      "calendar-tools",
      "meeting-helper",
    );
    const config = JSON.parse(
      fs.readFileSync(path.join(workspace, "mcp.config.json"), "utf-8"),
    );
    const metadata = JSON.parse(fs.readFileSync(result.metadataPath, "utf-8"));
    const server = result.mcpServers[0];

    expect(result.skills[0].status).toBe("imported");
    expect(
      fs.readFileSync(path.join(skillPath, "SKILL.md"), "utf-8"),
    ).toContain("name: meeting-helper");
    expect(
      fs.readFileSync(path.join(skillPath, "references", "rules.md"), "utf-8"),
    ).toContain("calendar policy");
    expect(config.servers[server.id]).toEqual({
      type: "http",
      url: "https://calendar.example.com/mcp",
      description: "Imported Agent Plugin: calendar-tools/calendar",
    });
    expect(config.servers[server.id].headers).toBeUndefined();
    expect(metadata.pluginHash).toBe(result.plugin.hash);
    expect(metadata.mcpServers[0].headersIgnored).toBe(1);
    expect(JSON.stringify(metadata)).not.toContain("package-placeholder");
  });

  it("is idempotent and refuses a conflicting Skill without --force", () => {
    const root = tmpDir();
    const pluginRoot = writePlugin(path.join(root, "plugin"));
    const workspace = path.join(root, "workspace");

    const first = importAgentPlugin(pluginRoot, { targetDir: workspace });
    const second = importAgentPlugin(pluginRoot, { targetDir: workspace });
    expect(second.skills[0].status).toBe("unchanged");
    expect(second.mcpServers[0].status).toBe("unchanged");
    expect(
      JSON.parse(fs.readFileSync(first.metadataPath, "utf-8")).importedAt,
    ).toBe(
      JSON.parse(fs.readFileSync(second.metadataPath, "utf-8")).importedAt,
    );

    const skillPath = path.join(
      workspace,
      "skills",
      "calendar-tools",
      "meeting-helper",
      "SKILL.md",
    );
    fs.writeFileSync(skillPath, "local edit\n", "utf-8");
    expect(() =>
      importAgentPlugin(pluginRoot, { targetDir: workspace }),
    ).toThrow(/destination differs.*--force/i);
    const forced = importAgentPlugin(pluginRoot, {
      targetDir: workspace,
      force: true,
    });
    expect(forced.skills[0].status).toBe("overwritten");
    expect(fs.readFileSync(skillPath, "utf-8")).toContain(
      "name: meeting-helper",
    );
  });

  it("rejects a target inside the plugin package", () => {
    const root = tmpDir();
    const pluginRoot = writePlugin(path.join(root, "plugin"));

    expect(() =>
      importAgentPlugin(pluginRoot, {
        targetDir: path.join(pluginRoot, "workspace"),
        dryRun: true,
      }),
    ).toThrow(/must not be the plugin directory or one of its children/);
  });
});
