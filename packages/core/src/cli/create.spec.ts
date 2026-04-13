import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createApp } from "./create.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-create-test-"));
  // createApp resolves relative to cwd
  process.chdir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createApp", { timeout: 15000 }, () => {
  it("scaffolds a directory with the app name", async () => {
    await createApp("my-app", { template: "blank" });
    expect(fs.existsSync(path.join(tmpDir, "my-app"))).toBe(true);
  });

  it("replaces {{APP_NAME}} in package.json", async () => {
    await createApp("hello-world", { template: "blank" });
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, "hello-world", "package.json"),
        "utf-8",
      ),
    );
    expect(pkg.name).toBe("hello-world");
    expect(pkg.name).not.toContain("{{");
  });

  it("replaces {{APP_TITLE}} in route index file so it is not left as a bare identifier", async () => {
    await createApp("my-app", { template: "blank" });
    // The _index.tsx (or equivalent) must not contain the unreplaced placeholder
    const indexPath = path.join(
      tmpDir,
      "my-app",
      "app",
      "routes",
      "_index.tsx",
    );
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, "utf-8");
      expect(content).not.toContain("{{APP_TITLE}}");
      // The replaced value should use title-cased words
      expect(content).toContain("My App");
    }
  });

  it("replaces {{APP_NAME}} in AGENTS.md", async () => {
    await createApp("my-cool-app", { template: "blank" });
    const agentsPath = path.join(tmpDir, "my-cool-app", "AGENTS.md");
    if (fs.existsSync(agentsPath)) {
      const content = fs.readFileSync(agentsPath, "utf-8");
      expect(content).not.toContain("{{APP_NAME}}");
      expect(content).toContain("my-cool-app");
    }
  });

  it("does not create a circular symlink inside .agents/skills", async () => {
    await createApp("my-app", { template: "blank" });
    const skillsDir = path.join(tmpDir, "my-app", ".agents", "skills");
    if (fs.existsSync(skillsDir)) {
      // There must be no entry named 'skills' inside the skills directory
      // as that would create a circular reference that crashes Vite's watcher.
      const entries = fs.readdirSync(skillsDir);
      expect(entries).not.toContain("skills");
    }
  });

  it("creates .gitignore from _gitignore", async () => {
    await createApp("my-app", { template: "blank" });
    const gitignore = path.join(tmpDir, "my-app", ".gitignore");
    expect(fs.existsSync(gitignore)).toBe(true);
  });

  it("exits with error for invalid app name", async () => {
    let exited = false;
    const origExit = process.exit.bind(process);
    // @ts-ignore
    process.exit = () => {
      exited = true;
      throw new Error("process.exit called");
    };
    try {
      await createApp("My_Invalid App!");
    } catch {
      // expected
    }
    process.exit = origExit;
    expect(exited).toBe(true);
  });
});
