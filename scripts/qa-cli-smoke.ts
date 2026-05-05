#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliEntry = path.join(repoRoot, "packages/core/src/cli/index.ts");
const tsxBin = path.join(repoRoot, "node_modules/.bin/tsx");
const coreDependencyVersion = resolveExpectedCoreDependencyVersion();

function run(
  cmd: string,
  args: string[],
  opts: ExecFileSyncOptions & { cwd: string },
): string {
  return execFileSync(cmd, args, {
    ...opts,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      ...opts.env,
    },
  }) as string;
}

function runCli(args: string[], cwd: string): string {
  return run(tsxBin, [cliEntry, ...args], { cwd });
}

function assertCliFails(args: string[], cwd: string, pattern: RegExp): void {
  try {
    runCli(args, cwd);
  } catch (error) {
    const err = error as {
      message?: string;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    const output = [err.stdout, err.stderr, err.message]
      .filter(Boolean)
      .map(String)
      .join("\n");
    assert.match(output, pattern);
    return;
  }
  assert.fail(`agent-native ${args.join(" ")} must fail with ${pattern}`);
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolveExpectedCoreDependencyVersion(): string {
  if (process.env.AGENT_NATIVE_CREATE_USE_LOCAL_CORE === "1") {
    const localCorePackage = path.join(repoRoot, "packages/core");
    if (fs.existsSync(path.join(localCorePackage, "package.json"))) {
      return pathToFileURL(localCorePackage).href;
    }
  }
  return "latest";
}

function assertNoUnresolvedPlaceholders(dir: string): void {
  const offenders: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === "data" ||
        entry.name === ".netlify" ||
        entry.name === "build" ||
        entry.name === ".output"
      ) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      let text: string;
      try {
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (/\{\{(APP_NAME|APP_TITLE|WORKSPACE_NAME)\}\}/.test(text)) {
        offenders.push(path.relative(dir, full));
      }
    }
  };
  walk(dir);
  assert.deepEqual(offenders, [], "scaffold must not leave placeholders");
}

function assertNoWorkspaceProtocolDeps(pkg: any): void {
  const bad: string[] = [];
  for (const depType of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
  ] as const) {
    for (const [name, value] of Object.entries(pkg[depType] ?? {})) {
      if (
        typeof value === "string" &&
        (value.startsWith("workspace:") || value === "catalog:")
      ) {
        bad.push(`${depType}.${name}=${value}`);
      }
    }
  }
  assert.deepEqual(bad, [], "standalone apps must be installable by users");
}

function assertAgentSymlinks(projectDir: string): void {
  const claudePath = path.join(projectDir, "CLAUDE.md");
  assert.equal(
    fs.existsSync(claudePath),
    true,
    "create must configure CLAUDE.md for agent tools",
  );
  const skillsPath = path.join(projectDir, ".claude", "skills");
  assert.equal(
    fs.existsSync(skillsPath),
    true,
    "create must configure .claude/skills for agent tools",
  );
}

function assertNoLocalArtifacts(projectDir: string): void {
  const forbidden = [
    ".env",
    ".env.local",
    ".netlify",
    ".generated",
    ".react-router",
    ".output",
    "build",
    "dist",
    "node_modules",
  ];
  const present = forbidden.filter((name) =>
    fs.existsSync(path.join(projectDir, name)),
  );
  assert.deepEqual(
    present,
    [],
    "scaffold must not copy local runtime/build artifacts",
  );
}

function assertScaffoldBasics(projectDir: string): void {
  assert.equal(
    fs.existsSync(path.join(projectDir, ".gitignore")),
    true,
    "create must rename _gitignore",
  );
  assert.equal(
    fs.existsSync(path.join(projectDir, "_gitignore")),
    false,
    "create must not leave _gitignore behind",
  );
  assertAgentSymlinks(projectDir);
  assertNoLocalArtifacts(projectDir);
  assertNoUnresolvedPlaceholders(projectDir);
}

function assertWorkspaceApp(
  workspaceDir: string,
  appName: string,
  workspaceCoreName: string,
): void {
  const appDir = path.join(workspaceDir, "apps", appName);
  assert.equal(fs.existsSync(appDir), true, `apps/${appName} must exist`);
  assertScaffoldBasics(appDir);
  const pkg = readJson(path.join(appDir, "package.json"));
  assert.equal(pkg.name, appName);
  assert.equal(pkg.dependencies["@agent-native/core"], coreDependencyVersion);
  assert.equal(pkg.dependencies[workspaceCoreName], "workspace:*");
}

function assertDispatchPackageDependency(pkg: any, context: string): void {
  assert.equal(
    pkg.dependencies["@agent-native/dispatch"],
    "latest",
    `${context} must resolve @agent-native/dispatch from npm`,
  );
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-cli-smoke-"));

try {
  const help = runCli(["--help"], repoRoot);
  assert.match(help, /agent-native v/);
  assert.match(help, /agent-native create \[name\]/);
  assert.match(help, /agent-native start/);

  assertCliFails(
    ["start"],
    tmpDir,
    /No production build found\. Run "agent-native build" first\./,
  );
  assertCliFails(
    ["add-app", "outside", "--template=blank"],
    tmpDir,
    /Not inside a workspace/,
  );

  const createOutput = runCli(
    ["create", "qa-cli-app", "--template=blank", "--standalone"],
    tmpDir,
  );
  assert.doesNotMatch(
    createOutput,
    /Which template would you like to use/,
    "create --template=blank must not open the interactive picker",
  );

  const appDir = path.join(tmpDir, "qa-cli-app");
  const pkg = readJson(path.join(appDir, "package.json"));
  assert.equal(pkg.name, "qa-cli-app");
  assert.equal(pkg.dependencies["@agent-native/core"], coreDependencyVersion);
  assertNoWorkspaceProtocolDeps(pkg);
  assertScaffoldBasics(appDir);

  const dispatchOutput = runCli(
    ["create", "qa-dispatch-app", "--template=dispatch", "--standalone"],
    tmpDir,
  );
  assert.doesNotMatch(
    dispatchOutput,
    /Which template would you like to use/,
    "create --template=dispatch --standalone must not open the picker",
  );
  const dispatchDir = path.join(tmpDir, "qa-dispatch-app");
  const dispatchPkg = readJson(path.join(dispatchDir, "package.json"));
  assert.equal(dispatchPkg.name, "qa-dispatch-app");
  assert.equal(
    dispatchPkg.dependencies["@agent-native/core"],
    coreDependencyVersion,
  );
  assertNoWorkspaceProtocolDeps(dispatchPkg);
  assertScaffoldBasics(dispatchDir);
  assertDispatchPackageDependency(dispatchPkg, "dispatch standalone scaffold");

  const workspaceOutput = runCli(
    ["create", "qa-workspace", "--template=starter,dispatch,calendar"],
    tmpDir,
  );
  assert.doesNotMatch(
    workspaceOutput,
    /Which apps would you like to include/,
    "create --template=a,b must use the non-interactive workspace path",
  );
  const workspaceDir = path.join(tmpDir, "qa-workspace");
  const workspacePkg = readJson(path.join(workspaceDir, "package.json"));
  const workspaceCoreName = "@qa-workspace/shared";
  assert.equal(workspacePkg.name, "qa-workspace");
  assert.equal(workspacePkg["agent-native"].workspaceCore, workspaceCoreName);
  assert.equal(
    workspacePkg.scripts.dev,
    "agent-native dev",
    "workspace dev script must use the framework gateway",
  );
  assert.match(
    workspacePkg.scripts.postinstall,
    /packages\/scheduling/,
    "calendar workspace scaffold must build required workspace packages",
  );
  assert.equal(
    fs.existsSync(path.join(workspaceDir, "packages", "scheduling")),
    true,
    "calendar workspace scaffold must copy @agent-native/scheduling",
  );
  assert.equal(
    fs.existsSync(path.join(workspaceDir, "packages", "shared")),
    true,
    "workspace scaffold must include the shared package",
  );
  assertScaffoldBasics(path.join(workspaceDir, "apps", "starter"));
  assertWorkspaceApp(workspaceDir, "starter", workspaceCoreName);
  assertWorkspaceApp(workspaceDir, "dispatch", workspaceCoreName);
  assertWorkspaceApp(workspaceDir, "calendar", workspaceCoreName);
  assertDispatchPackageDependency(
    readJson(path.join(workspaceDir, "apps", "dispatch", "package.json")),
    "dispatch workspace scaffold",
  );
  assert.equal(
    fs.existsSync(path.join(workspaceDir, "scripts", "workspace-dev.ts")),
    false,
    "workspace scaffold must not copy the dev gateway script",
  );
  assert.equal(
    fs.existsSync(
      path.join(workspaceDir, "apps", "starter", ".vercel", "output"),
    ),
    false,
    "workspace apps must not include Vercel build output",
  );
  assert.equal(
    fs.existsSync(
      path.join(workspaceDir, "apps", "starter", ".claude", "settings.json"),
    ),
    false,
    "workspace apps must not include legacy Claude settings",
  );

  const workspaceCatalog = fs.readFileSync(
    path.join(workspaceDir, "pnpm-workspace.yaml"),
    "utf8",
  );
  assert.match(
    workspaceCatalog,
    /catalog:/,
    "workspace scaffold must include dependency catalog for catalog: versions",
  );

  const addedOutput = runCli(
    ["add-app", "qa-forms-app", "--template=forms"],
    workspaceDir,
  );
  assert.match(addedOutput, /Scaffolded apps\/qa-forms-app/);
  assertWorkspaceApp(workspaceDir, "qa-forms-app", workspaceCoreName);

  const aliasOutput = runCli(
    ["create-workspace", "qa-workspace-alias", "--template=starter,dispatch"],
    tmpDir,
  );
  assert.match(aliasOutput, /Create a new agent-native workspace/);
  assert.equal(
    fs.existsSync(path.join(tmpDir, "qa-workspace-alias", "apps", "dispatch")),
    true,
    "create-workspace alias must still scaffold a workspace",
  );

  runCli(["setup-agents"], path.join(workspaceDir, "apps", "dispatch"));
  assertAgentSymlinks(path.join(workspaceDir, "apps", "dispatch"));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log("qa-cli-smoke: clean");
