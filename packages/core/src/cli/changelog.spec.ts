import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runChangelog } from "./changelog.js";

describe("changelog generation policy", () => {
  const originalCwd = process.cwd();
  let root: string;

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("is disabled unless the app opts in", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-changelog-"));
    process.chdir(root);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runChangelog(["add", "A hidden entry"])).resolves.toBe(1);
    expect(fs.existsSync(path.join(root, "changelog"))).toBe(false);
  });

  it("generates entries when the app enables changelogs", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-changelog-"));
    process.chdir(root);
    fs.writeFileSync(
      path.join(root, "agent-native.mts"),
      "export default { changelog: { enabled: true } };\n",
    );

    await expect(runChangelog(["add", "A visible entry"])).resolves.toBe(0);
    const entries = fs.readdirSync(path.join(root, "changelog"));
    expect(entries).toHaveLength(1);
    expect(
      fs.readFileSync(path.join(root, "changelog", entries[0]), "utf8"),
    ).toContain("A visible entry");
  });
});
