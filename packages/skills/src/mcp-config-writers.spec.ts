import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildCodexHttpBlock, writeCodexBlock } from "./mcp-config-writers.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-skills-mcp-writers-"));
  tmpRoots.push(root);
  return root;
}

describe("writeCodexBlock", () => {
  it("treats table headers with trailing comments as table boundaries", () => {
    const dir = tmpDir();
    const file = path.join(dir, "config.toml");
    const planUrl = "https://plan.agent-native.com/_agent-native/mcp";
    fs.writeFileSync(
      file,
      [
        '[mcp_servers."plan"] # installed by hand',
        `url = "${planUrl}"`,
        "",
        "[mcp_servers.other] # keep this neighbor",
        'url = "https://other.example.com/mcp"',
        "",
      ].join("\n"),
      "utf-8",
    );

    writeCodexBlock(
      file,
      "plan",
      buildCodexHttpBlock("plan", planUrl, "NEW-token"),
    );

    const content = fs.readFileSync(file, "utf-8");
    expect(content.match(/\[mcp_servers\."plan"\]/g)).toHaveLength(1);
    expect(content).toContain("NEW-token");
    expect(content).not.toContain("installed by hand");
    expect(content).toContain("[mcp_servers.other] # keep this neighbor");
    expect(content).toContain('url = "https://other.example.com/mcp"');
  });
});
