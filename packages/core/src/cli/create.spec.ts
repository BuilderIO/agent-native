import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  createApp,
  _getCoreDependencyVersion,
  _workspaceAppNameForTemplateSelection,
} from "./create.js";

let tmpDir: string;

function allDeps(pkg: Record<string, any>): Record<string, string> {
  return {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-create-test-"));
  // createApp resolves relative to cwd
  process.chdir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("createApp", { timeout: 30000 }, () => {
  it("derives workspace app names from GitHub template repo names", () => {
    expect(
      _workspaceAppNameForTemplateSelection("github:acme/customer-portal"),
    ).toBe("customer-portal");
    expect(_workspaceAppNameForTemplateSelection("github:acme/123 CRM")).toBe(
      "app-123-crm",
    );
  });

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

  it("keeps the blank scaffold headless instead of generating UI files", async () => {
    await createApp("my-app", { template: "blank" });
    const root = path.join(tmpDir, "my-app");

    expect(fs.existsSync(path.join(root, "app"))).toBe(false);
    expect(fs.existsSync(path.join(root, "vite.config.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "react-router.config.ts"))).toBe(
      false,
    );
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
    expect(fs.readFileSync(gitignore, "utf-8")).toContain(
      "node-compile-cache/",
    );
  });

  it("normalizes @agent-native/core for blank standalone apps", async () => {
    await createApp("my-app", { template: "blank" });
    const pkg = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "my-app", "package.json"), "utf-8"),
    );

    expect(pkg.dependencies["@agent-native/core"]).toBe(
      _getCoreDependencyVersion(),
    );
  });

  it("scaffolds headless apps with one action primitive and no UI shell", async () => {
    await createApp("my-app", { template: "headless" });
    const root = path.join(tmpDir, "my-app");

    const hello = fs.readFileSync(
      path.join(root, "actions", "hello.ts"),
      "utf-8",
    );
    // Imports from the bare package root, which is server-safe so a headless
    // app loads it without React / @tanstack/react-query installed.
    expect(hello).toContain('from "@agent-native/core"');
    expect(hello).toContain("defineAction");
    expect(hello).toContain('http: { method: "GET" }');
    expect(hello).toContain("readOnly: true");

    const run = fs.readFileSync(path.join(root, "actions", "run.ts"), "utf-8");
    expect(run).toContain("CLI dispatcher");
    expect(run).toContain("not exposed as an agent tool");

    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf-8"),
    );
    const deps = allDeps(pkg);

    expect(fs.existsSync(path.join(root, "app"))).toBe(false);
    expect(fs.existsSync(path.join(root, "vite.config.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "react-router.config.ts"))).toBe(
      false,
    );
    expect(deps.react).toBeUndefined();
    expect(deps["react-router"]).toBeUndefined();
    expect(deps.vite).toBeUndefined();
    expect(deps["@react-router/dev"]).toBeUndefined();

    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(root, "tsconfig.json"), "utf-8"),
    );
    expect(tsconfig.compilerOptions?.types).toEqual(["node"]);

    const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf-8");
    expect(agents).toContain("This is a headless Agent Native app");
    expect(agents).toContain("This app is not stateless");
    expect(agents).toContain("Chat template");
    expect(agents).toContain("integration blueprints");

    expect(
      fs.existsSync(path.join(root, "server", "routes", "api", "hello.get.ts")),
    ).toBe(false);
  });

  it("keeps blank as a legacy alias for the headless scaffold", async () => {
    await createApp("legacy-blank", { template: "blank" });
    const root = path.join(tmpDir, "legacy-blank");

    expect(fs.existsSync(path.join(root, "actions", "hello.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "app"))).toBe(false);
    expect(fs.existsSync(path.join(root, "vite.config.ts"))).toBe(false);
  });

  it("rejects mixing headless with workspace app templates", async () => {
    let exited = false;
    const origExit = process.exit.bind(process);
    // @ts-ignore
    process.exit = () => {
      exited = true;
      throw new Error("process.exit called");
    };
    try {
      await createApp("my-ws", { template: "headless,chat" });
    } catch {
      // expected
    }
    process.exit = origExit;
    expect(exited).toBe(true);
  });

  it("rejects adding headless inside an existing workspace", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ "agent-native": { workspaceCore: "@test/shared" } }),
    );
    fs.mkdirSync(path.join(tmpDir, "apps"));

    let exited = false;
    const origExit = process.exit.bind(process);
    // @ts-ignore
    process.exit = () => {
      exited = true;
      throw new Error("process.exit called");
    };
    try {
      await createApp("api", { template: "headless" });
    } catch {
      // expected
    }
    process.exit = origExit;
    expect(exited).toBe(true);
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
