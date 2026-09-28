import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as pty from "node-pty";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const cliEntry = path.join(repoRoot, "packages/core/bin/agent-native.js");
const runningProcesses: pty.IPty[] = [];

function temporaryDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-native-create-tui-"));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function startTty(
  args: string[],
  cwd: string,
  cols = 84,
  environment: NodeJS.ProcessEnv = {},
) {
  const env = { ...process.env, ...environment, NO_COLOR: "1" };
  delete env.FORCE_COLOR;
  delete env.CLICOLOR_FORCE;
  const child = pty.spawn(process.execPath, [cliEntry, ...args], {
    name: "xterm-256color",
    cols,
    rows: 26,
    cwd,
    env,
  });
  runningProcesses.push(child);

  let output = "";
  child.onData((chunk) => {
    output += chunk;
  });
  const exited = new Promise<{ exitCode: number; signal?: number }>(
    (resolve) => {
      child.onExit(resolve);
    },
  );

  return {
    child,
    get output() {
      return output;
    },
    async waitFor(
      needle: string,
      after = 0,
      timeoutMs = 15_000,
    ): Promise<number> {
      const existing = output.indexOf(needle, after);
      if (existing >= 0) return existing;
      return new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
          subscription.dispose();
          reject(
            new Error(
              `Timed out waiting for ${JSON.stringify(needle)} after ${after}. Output: ${output.slice(-1200)}`,
            ),
          );
        }, timeoutMs);
        const subscription = child.onData(() => {
          const found = output.indexOf(needle, after);
          if (found < 0) return;
          clearTimeout(timer);
          subscription.dispose();
          resolve(found);
        });
      });
    },
    exited,
  };
}

afterEach(() => {
  for (const child of runningProcesses.splice(0)) {
    child.kill();
  }
});

describe("agent-native create TUI", () => {
  it("keeps live redraws in an interactive TTY when CI is set", async () => {
    const cwd = temporaryDirectory();
    const cli = startTty(["create"], cwd, 84, { CI: "true" });

    const firstScreen = await cli.waitFor("Esc cancel");
    await wait(50);
    cli.child.write("\x1b[B");
    await cli.waitFor("Step 1 of 4", firstScreen + 1, 3_000);
    cli.child.write("\x1b");

    const { exitCode } = await cli.exited;
    expect(exitCode).toBe(0);
    expect(fs.readdirSync(cwd)).toEqual([]);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 10_000);

  it("shows help in a TTY without starting the interactive menu", async () => {
    const cwd = temporaryDirectory();
    const cli = startTty(["create", "--help"], cwd);
    const { exitCode } = await cli.exited;

    expect(exitCode).toBe(0);
    expect(cli.output).toContain("Usage:");
    expect(cli.output).not.toContain("Choose a starting point");
    expect(fs.readdirSync(cwd)).toEqual([]);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 20_000);

  it("preserves selections when going back and restores the terminal on cancel", async () => {
    const cwd = temporaryDirectory();
    const cli = startTty(["create"], cwd);

    await cli.waitFor("Esc cancel");
    const initialProgress = await cli.waitFor("Step 1 of 4");
    expect(cli.output).toContain("Step 1 of 4");
    for (const choice of [
      "Chat workspace",
      "Standalone app",
      "Headless",
      "First-party template",
      "Community template",
    ]) {
      expect(cli.output).toContain(choice);
    }
    expect(cli.output).toContain("chat/");
    expect(cli.output).toContain("dispatch/");
    await wait(50);
    cli.child.write("\x1b[B\x1b[B");
    const headlessProgress = await cli.waitFor(
      "Step 1 of 3",
      initialProgress + 1,
    );
    cli.child.write("\x1b[A\x1b[A");
    await cli.waitFor("Step 1 of 4", headlessProgress + 1);
    await wait(50);
    cli.child.write("\r");
    const firstAppsStep = await cli.waitFor("Shape your app lineup");
    expect(cli.output).toContain("Step 2 of 4");
    await cli.waitFor("2 selected", firstAppsStep + 1);
    expect(cli.output).toContain("[x] Chat");
    expect(cli.output).toContain("[x] Dispatch");
    expect(cli.output).toContain("required · default");
    await wait(50);
    for (let index = 0; index < 8; index++) cli.child.write("\x1b[B");
    await cli.waitFor("Forms");
    cli.child.write(" ");
    await cli.waitFor("3 selected");
    cli.child.write("\x02");
    const startAgain = await cli.waitFor(
      "Choose a starting point",
      firstAppsStep + 1,
    );
    cli.child.write("\r");
    const secondAppsStep = await cli.waitFor(
      "Shape your app lineup",
      startAgain + 1,
    );
    await cli.waitFor("3 selected", secondAppsStep + 1);
    cli.child.write("\x1b");

    const { exitCode } = await cli.exited;
    expect(exitCode).toBe(0);
    expect(cli.output).toContain("Cancelled. No files were created.");
    expect(cli.output).toContain("\u001b[?25h");
    expect(cli.output).not.toMatch(/\u001b\[[0-9;]*m/);
    expect(fs.readdirSync(cwd)).toEqual([]);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 30_000);

  it("keeps explicitly selected apps when a workspace has no Dispatch app yet", async () => {
    const cwd = temporaryDirectory();
    fs.mkdirSync(path.join(cwd, "apps"));
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ "agent-native": { workspaceCore: "@test/shared" } }),
    );
    const cli = startTty(["create", "--template", "dispatch,chat"], cwd);

    await cli.waitFor("2 selected");
    expect(cli.output).toContain("Step 1 of 2");
    expect(cli.output).toContain("[x] Chat");
    expect(cli.output).toContain("[x] Dispatch");
    cli.child.write("\x1b");

    const { exitCode } = await cli.exited;
    expect(exitCode).toBe(0);
    expect(fs.readdirSync(path.join(cwd, "apps"))).toEqual([]);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 30_000);

  it("keeps missing app selections when another requested app is installed", async () => {
    const cwd = temporaryDirectory();
    fs.mkdirSync(path.join(cwd, "apps", "chat"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ "agent-native": { workspaceCore: "@test/shared" } }),
    );
    const cli = startTty(["create", "--template", "chat,dispatch"], cwd);

    await cli.waitFor("Choose apps to add");
    await cli.waitFor("1 selected");
    expect(cli.output).toContain("[x] Dispatch");
    expect(cli.output).not.toContain("[x] Chat");
    cli.child.write("\x1b");

    const { exitCode } = await cli.exited;
    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(cwd, "apps", "dispatch"))).toBe(false);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 30_000);

  it("creates the selected workspace and prints a usable next step", async () => {
    const cwd = temporaryDirectory();
    const projectPath = path.join(fs.realpathSync(cwd), "wizard-app");
    const cli = startTty(["create"], cwd, 120);

    await cli.waitFor("Esc cancel");
    await wait(50);
    cli.child.write("\r");
    const appsStep = await cli.waitFor("Shape your app lineup");
    await cli.waitFor("2 selected", appsStep + 1);
    await wait(50);
    cli.child.write("\r");
    await cli.waitFor("Name your project");
    expect(cli.output).toContain("Step 3 of 4");
    await wait(50);
    cli.child.write("wizard-app");
    await cli.waitFor("wizard-app");
    await wait(50);
    cli.child.write("\r");
    await cli.waitFor("Ready to create");
    expect(cli.output).toContain("Step 4 of 4");
    await wait(50);
    cli.child.write("\r");
    await cli.waitFor("Workspace ready");

    const { exitCode } = await cli.exited;
    expect(exitCode).toBe(0);
    expect(cli.output).toContain(`Path: ${projectPath}`);
    expect(cli.output).toContain("Apps: Dispatch, Chat");
    expect(cli.output).toContain("\u001b[?25h");
    expect(cli.output).toContain("pnpm install");
    expect(cli.output).toContain("pnpm dev");
    expect(
      fs.existsSync(path.join(projectPath, "apps/chat/package.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectPath, "apps/dispatch/package.json")),
    ).toBe(true);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 60_000);

  it("keeps the flagged standalone path scriptable without a TTY", () => {
    const cwd = temporaryDirectory();
    const result = spawnSync(
      process.execPath,
      [cliEntry, "create", "sample-app", "--standalone", "--template", "chat"],
      {
        cwd,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, NO_COLOR: "1" },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Standalone app ready");
    expect(result.stdout).toContain(path.join(cwd, "sample-app"));
    expect(fs.existsSync(path.join(cwd, "sample-app/package.json"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, "sample-app/apps"))).toBe(false);
    expect(result.stdout).not.toMatch(/\u001b\[[0-9;]*m/);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 70_000);

  it("explains how to use create when no TTY and no choices are provided", () => {
    const cwd = temporaryDirectory();
    const result = spawnSync(process.execPath, [cliEntry, "create"], {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, NO_COLOR: "1" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("An interactive terminal is needed");
    expect(result.stdout).not.toMatch(/\u001b\[[0-9;]*m/);
    expect(fs.readdirSync(cwd)).toEqual([]);
    fs.rmSync(cwd, { recursive: true, force: true });
  }, 40_000);
});
