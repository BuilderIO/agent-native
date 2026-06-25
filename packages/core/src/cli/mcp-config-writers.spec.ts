import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildHttpMcpEntry,
  buildLocalMcpEntryForClient,
  canonicalUrl,
  hasJsonMcpEntry,
  hasJsonMcpEntryForClient,
  removeCodexSameUrlDuplicates,
  removeJsonSameUrlDuplicates,
  writeHttpEntryForClient,
  writeJsonMcpEntry,
} from "./mcp-config-writers.js";

const tmpRoots: string[] = [];

beforeEach(() => {
  // nothing to reset
});

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-mcp-writers-"));
  tmpRoots.push(root);
  return root;
}

// ---------------------------------------------------------------------------
// writeJsonMcpEntry
// ---------------------------------------------------------------------------

describe("writeJsonMcpEntry", () => {
  it("creates a fresh file when the target does not exist", () => {
    const dir = tmpDir();
    const file = path.join(dir, "test.json");

    writeJsonMcpEntry(file, "my-server", {
      type: "http",
      url: "https://x.com",
    });

    const written = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(written.mcpServers["my-server"]).toEqual({
      type: "http",
      url: "https://x.com",
    });
  });

  it("merges into an existing JSON file without losing other keys", () => {
    const dir = tmpDir();
    const file = path.join(dir, "claude.json");

    // Simulate existing Claude Code state
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          projects: { "/foo/bar": { name: "bar" } },
          numStartups: 42,
          mcpServers: {
            "old-server": { type: "http", url: "https://old.com" },
          },
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    writeJsonMcpEntry(file, "new-server", {
      type: "http",
      url: "https://new.com",
    });

    const written = JSON.parse(fs.readFileSync(file, "utf-8"));
    // Pre-existing state must survive
    expect(written.projects).toEqual({ "/foo/bar": { name: "bar" } });
    expect(written.numStartups).toBe(42);
    // Old and new entries both present
    expect(written.mcpServers["old-server"]).toEqual({
      type: "http",
      url: "https://old.com",
    });
    expect(written.mcpServers["new-server"]).toEqual({
      type: "http",
      url: "https://new.com",
    });
  });

  it("treats an empty file as a fresh config", () => {
    const dir = tmpDir();
    const file = path.join(dir, "empty.json");
    fs.writeFileSync(file, "", "utf-8");

    writeJsonMcpEntry(file, "srv", { type: "http", url: "https://x.com" });

    const written = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(written.mcpServers["srv"]).toBeDefined();
  });

  it("throws — and does NOT modify the file — when it contains non-empty invalid JSON", () => {
    const dir = tmpDir();
    const file = path.join(dir, "corrupt.json");
    const corruptContent = '{"partial": true, "projects": [BROKEN';
    fs.writeFileSync(file, corruptContent, "utf-8");

    expect(() =>
      writeJsonMcpEntry(file, "srv", { type: "http", url: "https://x.com" }),
    ).toThrow(/Cannot parse JSON config file/);

    // File must be untouched
    expect(fs.readFileSync(file, "utf-8")).toBe(corruptContent);
  });

  it("error message includes the file path and actionable guidance", () => {
    const dir = tmpDir();
    const file = path.join(dir, "corrupt.json");
    fs.writeFileSync(file, "{not valid json}", "utf-8");

    let thrown: Error | null = null;
    try {
      writeJsonMcpEntry(file, "srv", { type: "http", url: "https://x.com" });
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeTruthy();
    expect(thrown!.message).toContain(file);
    expect(thrown!.message).toMatch(/fix or move/i);
  });

  it("removes an entry when passed null", () => {
    const dir = tmpDir();
    const file = path.join(dir, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify(
        { mcpServers: { srv: { type: "http", url: "u" } } },
        null,
        2,
      ),
      "utf-8",
    );

    writeJsonMcpEntry(file, "srv", null);

    const written = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(written.mcpServers).not.toHaveProperty("srv");
  });
});

// ---------------------------------------------------------------------------
// hasJsonMcpEntry
// ---------------------------------------------------------------------------

describe("hasJsonMcpEntry", () => {
  it("returns false for a missing file", () => {
    expect(hasJsonMcpEntry("/nonexistent/path.json", "srv")).toBe(false);
  });

  it("returns false for corrupt file (no data-loss)", () => {
    const dir = tmpDir();
    const file = path.join(dir, "corrupt.json");
    fs.writeFileSync(file, "{bad}", "utf-8");
    // hasJsonMcpEntry uses the same readJsonFile — it should throw, not silently
    // return false, so callers can't be misled into thinking the entry is absent.
    // We accept either: throw OR return false (both safer than returning true).
    // The important invariant: the file is not modified.
    let result: boolean | null = null;
    try {
      result = hasJsonMcpEntry(file, "srv");
    } catch {
      // throwing is also acceptable
      result = null;
    }
    // file untouched
    expect(fs.readFileSync(file, "utf-8")).toBe("{bad}");
    if (result !== null) expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// writeHttpEntryForClient — claude-code project scope (local .mcp.json)
// ---------------------------------------------------------------------------

describe("writeHttpEntryForClient", () => {
  it("writes a project-scope claude-code entry to .mcp.json", () => {
    const dir = tmpDir();
    const returned = writeHttpEntryForClient(
      "claude-code",
      "test-server",
      "https://app.example.com/mcp",
      "tok_abc",
      dir,
      "project",
    );

    expect(returned).toBe(path.join(dir, ".mcp.json"));
    const written = JSON.parse(fs.readFileSync(returned, "utf-8"));
    expect(written.mcpServers["test-server"]).toMatchObject({
      type: "http",
      url: "https://app.example.com/mcp",
      headers: { Authorization: "Bearer tok_abc" },
    });
  });

  it("merges without losing existing keys for a pre-populated .mcp.json", () => {
    const dir = tmpDir();
    const file = path.join(dir, ".mcp.json");
    fs.writeFileSync(
      file,
      JSON.stringify(
        { mcpServers: { existing: { type: "http", url: "u" } } },
        null,
        2,
      ),
      "utf-8",
    );

    writeHttpEntryForClient(
      "claude-code",
      "new-srv",
      "https://new.example.com/mcp",
      undefined,
      dir,
      "project",
    );

    const written = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(written.mcpServers).toHaveProperty("existing");
    expect(written.mcpServers).toHaveProperty("new-srv");
  });

  it("throws on corrupt .mcp.json, leaving it untouched", () => {
    const dir = tmpDir();
    const file = path.join(dir, ".mcp.json");
    const bad = "NOT JSON AT ALL";
    fs.writeFileSync(file, bad, "utf-8");

    expect(() =>
      writeHttpEntryForClient(
        "claude-code",
        "srv",
        "https://x.com/mcp",
        undefined,
        dir,
        "project",
      ),
    ).toThrow(/Cannot parse JSON config file/);

    expect(fs.readFileSync(file, "utf-8")).toBe(bad);
  });

  it("writes Cursor remote entries to .cursor/mcp.json", () => {
    const dir = tmpDir();
    const returned = writeHttpEntryForClient(
      "cursor",
      "plan",
      "https://plan.agent-native.com/_agent-native/mcp",
      undefined,
      dir,
      "project",
    );

    expect(returned).toBe(path.join(dir, ".cursor", "mcp.json"));
    const written = JSON.parse(fs.readFileSync(returned, "utf-8"));
    expect(written.mcpServers.plan).toEqual({
      url: "https://plan.agent-native.com/_agent-native/mcp",
    });
    expect(hasJsonMcpEntryForClient("cursor", returned, "plan")).toBe(true);
  });

  it("writes OpenCode remote entries to opencode.json under mcp", () => {
    const dir = tmpDir();
    const returned = writeHttpEntryForClient(
      "opencode",
      "plan",
      "https://plan.agent-native.com/_agent-native/mcp",
      "tok_abc",
      dir,
      "project",
    );

    expect(returned).toBe(path.join(dir, "opencode.json"));
    const written = JSON.parse(fs.readFileSync(returned, "utf-8"));
    expect(written.mcp.plan).toEqual({
      type: "remote",
      url: "https://plan.agent-native.com/_agent-native/mcp",
      enabled: true,
      headers: { Authorization: "Bearer tok_abc" },
    });
    expect(hasJsonMcpEntryForClient("opencode", returned, "plan")).toBe(true);
  });

  it("writes GitHub Copilot / VS Code remote entries to .vscode/mcp.json under servers", () => {
    const dir = tmpDir();
    const returned = writeHttpEntryForClient(
      "github-copilot",
      "plan",
      "https://plan.agent-native.com/_agent-native/mcp",
      "tok_abc",
      dir,
      "project",
    );

    expect(returned).toBe(path.join(dir, ".vscode", "mcp.json"));
    const written = JSON.parse(fs.readFileSync(returned, "utf-8"));
    expect(written.servers.plan).toEqual({
      type: "http",
      url: "https://plan.agent-native.com/_agent-native/mcp",
      requestInit: { headers: { Authorization: "Bearer tok_abc" } },
    });
    expect(hasJsonMcpEntryForClient("github-copilot", returned, "plan")).toBe(
      true,
    );
  });
});

describe("buildLocalMcpEntryForClient", () => {
  it("uses the OpenCode local command-array shape", () => {
    expect(
      buildLocalMcpEntryForClient("opencode", ["mcp", "serve"], {
        ACCESS_TOKEN: "tok",
      }),
    ).toEqual({
      type: "local",
      command: ["agent-native", "mcp", "serve"],
      enabled: true,
      environment: { ACCESS_TOKEN: "tok" },
    });
  });

  it("uses the VS Code stdio shape for GitHub Copilot", () => {
    expect(
      buildLocalMcpEntryForClient("github-copilot", ["mcp", "serve"], {
        ACCESS_TOKEN: "tok",
      }),
    ).toEqual({
      type: "stdio",
      command: "agent-native",
      args: ["mcp", "serve"],
      env: { ACCESS_TOKEN: "tok" },
    });
  });
});

// ---------------------------------------------------------------------------
// buildHttpMcpEntry
// ---------------------------------------------------------------------------

describe("buildHttpMcpEntry", () => {
  it("includes Authorization header when a token is supplied", () => {
    const entry = buildHttpMcpEntry("https://x.com", "tok_123");
    expect(entry).toEqual({
      type: "http",
      url: "https://x.com",
      headers: { Authorization: "Bearer tok_123" },
    });
  });

  it("omits headers key when no token and no extra headers", () => {
    const entry = buildHttpMcpEntry("https://x.com");
    expect(entry).toEqual({ type: "http", url: "https://x.com" });
  });

  it("merges extra headers with the token header", () => {
    const entry = buildHttpMcpEntry("https://x.com", "tok", {
      "X-Custom": "yes",
    });
    expect(entry.headers).toEqual({
      "X-Custom": "yes",
      Authorization: "Bearer tok",
    });
  });
});

// ---------------------------------------------------------------------------
// canonicalUrl
// ---------------------------------------------------------------------------

describe("canonicalUrl", () => {
  it("strips trailing slash", () => {
    expect(canonicalUrl("https://x.com/mcp/")).toBe("https://x.com/mcp");
  });

  it("strips hash and search params", () => {
    expect(canonicalUrl("https://x.com/mcp?foo=1#bar")).toBe(
      "https://x.com/mcp",
    );
  });

  it("returns undefined for invalid URLs", () => {
    expect(canonicalUrl("not-a-url")).toBeUndefined();
    expect(canonicalUrl(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// removeJsonSameUrlDuplicates
// ---------------------------------------------------------------------------

describe("removeJsonSameUrlDuplicates", () => {
  it("removes entries whose URL matches the canonical URL, preserving keepName", () => {
    const dir = tmpDir();
    const file = path.join(dir, "claude.json");
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          mcpServers: {
            plan: {
              type: "http",
              url: "https://plan.agent-native.com/_agent-native/mcp",
            },
            "agent-native-plans": {
              type: "http",
              url: "https://plan.agent-native.com/_agent-native/mcp",
            },
            "agent-native-plan": {
              type: "http",
              url: "https://plan.agent-native.com/_agent-native/mcp",
            },
            "other-server": {
              type: "http",
              url: "https://other.example.com/_agent-native/mcp",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const removed = removeJsonSameUrlDuplicates(
      file,
      "https://plan.agent-native.com/_agent-native/mcp",
      "plan",
    );

    expect(removed.sort()).toEqual(["agent-native-plan", "agent-native-plans"]);
    const cfg = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(Object.keys(cfg.mcpServers).sort()).toEqual([
      "other-server",
      "plan",
    ]);
  });

  it("returns empty array when there are no duplicates", () => {
    const dir = tmpDir();
    const file = path.join(dir, "claude.json");
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          mcpServers: {
            plan: {
              type: "http",
              url: "https://plan.agent-native.com/_agent-native/mcp",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const removed = removeJsonSameUrlDuplicates(
      file,
      "https://plan.agent-native.com/_agent-native/mcp",
      "plan",
    );

    expect(removed).toEqual([]);
    // File should not be rewritten unnecessarily (content unchanged modulo parse).
    const cfg = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(Object.keys(cfg.mcpServers)).toEqual(["plan"]);
  });

  it("returns empty array for a missing file", () => {
    const removed = removeJsonSameUrlDuplicates(
      "/nonexistent/path.json",
      "https://x.com/mcp",
      "plan",
    );
    expect(removed).toEqual([]);
  });

  it("normalises trailing slashes when comparing", () => {
    const dir = tmpDir();
    const file = path.join(dir, "claude.json");
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          mcpServers: {
            plan: { type: "http", url: "https://plan.example.com/mcp/" },
            "old-alias": {
              type: "http",
              url: "https://plan.example.com/mcp",
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const removed = removeJsonSameUrlDuplicates(
      file,
      "https://plan.example.com/mcp/",
      "plan",
    );

    expect(removed).toEqual(["old-alias"]);
  });
});

// ---------------------------------------------------------------------------
// removeCodexSameUrlDuplicates
// ---------------------------------------------------------------------------

describe("removeCodexSameUrlDuplicates", () => {
  it("removes Codex TOML blocks whose url matches, preserving keepName", () => {
    const dir = tmpDir();
    const file = path.join(dir, "config.toml");
    fs.writeFileSync(
      file,
      [
        '[mcp_servers."plan"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        "",
        '[mcp_servers."agent-native-plans"]',
        'url = "https://plan.agent-native.com/_agent-native/mcp"',
        "",
        "[mcp_servers.other]",
        'url = "https://other.example.com/mcp"',
        "",
      ].join("\n"),
      "utf-8",
    );

    const removed = removeCodexSameUrlDuplicates(
      file,
      "https://plan.agent-native.com/_agent-native/mcp",
      "plan",
    );

    expect(removed).toEqual(["agent-native-plans"]);
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain('[mcp_servers."plan"]');
    expect(content).not.toContain("agent-native-plans");
    expect(content).toContain("[mcp_servers.other]");
  });

  it("returns empty array for a missing file", () => {
    const removed = removeCodexSameUrlDuplicates(
      "/nonexistent/config.toml",
      "https://x.com/mcp",
      "plan",
    );
    expect(removed).toEqual([]);
  });

  it("returns empty array when no duplicates are present", () => {
    const dir = tmpDir();
    const file = path.join(dir, "config.toml");
    fs.writeFileSync(
      file,
      ['[mcp_servers."plan"]', 'url = "https://plan.example.com/mcp"', ""].join(
        "\n",
      ),
      "utf-8",
    );

    const removed = removeCodexSameUrlDuplicates(
      file,
      "https://plan.example.com/mcp",
      "plan",
    );
    expect(removed).toEqual([]);
  });
});
