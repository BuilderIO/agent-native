import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClientForks, runForkCommand } from "./client-forks.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("personal source fork lifecycle", () => {
  it("preserves a working artifact through restart, failed build, and upstream update", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "source-fork-"));
    directories.push(root);
    const source = path.join(root, "upstream");
    await fs.mkdir(path.join(source, "templates", "example"), {
      recursive: true,
    });
    const git = (args: string[], cwd = source) =>
      runForkCommand("git", args, cwd);
    await git(["init", "-b", "main"]);
    await git(["config", "user.name", "Test User"]);
    await git(["config", "user.email", "user@example.invalid"]);
    await fs.writeFile(
      path.join(source, ".gitignore"),
      "node_modules\nbuild\n",
    );
    await fs.writeFile(path.join(source, "package.json"), "{}");
    await fs.writeFile(
      path.join(source, "pnpm-lock.yaml"),
      "lockfileVersion: 9\n",
    );
    await fs.writeFile(
      path.join(source, "templates/example/package.json"),
      '{"name":"example"}',
    );
    await fs.writeFile(
      path.join(source, "templates/example/view.txt"),
      "original",
    );
    await git(["add", "."]);
    await git(["commit", "-m", "Base app"]);
    const baseSha = await git(["rev-parse", "HEAD"]);
    const pnpm = path.join(root, "fixture-builder");
    await fs.writeFile(
      pnpm,
      `#!/bin/sh\nset -eu\ncase "$*" in\n  *--client-only*)\n    if test -f broken; then exit 1; fi\n    mkdir -p build/client\n    cp view.txt build/client/index.html\n    ;;\nesac\n`,
      { mode: 0o700 },
    );
    const options = { root: path.join(root, "profile"), source, baseSha, pnpm };
    const manager = new ClientForks(options);
    const state = await manager.prepare("example", null);
    await git(["config", "user.name", "Test User"], state.sourcePath);
    await git(
      ["config", "user.email", "user@example.invalid"],
      state.sourcePath,
    );
    await fs.writeFile(
      path.join(state.sourcePath, "templates/example/view.txt"),
      "my version",
    );
    await manager.build("example");
    state.enabled = true;
    await manager.save(state);
    const restarted = new ClientForks(options);
    const restored = await restarted.load("example");
    expect(restored.enabled).toBe(true);
    const lastGood = restored.buildPath;
    expect(
      await fs.readFile(path.join(lastGood ?? "", "index.html"), "utf8"),
    ).toBe("my version");
    await fs.writeFile(
      path.join(restored.sourcePath, "templates/example/broken"),
      "broken",
    );
    await expect(restarted.build("example")).rejects.toThrow("failed");
    expect(restored.buildPath).toBe(lastGood);
    expect(restored.enabled).toBe(false);
    await fs.unlink(path.join(restored.sourcePath, "templates/example/broken"));
    await restarted.build("example");
    await fs.writeFile(path.join(source, "upstream-fix.txt"), "bug fixed");
    await git(["add", "."]);
    await git(["commit", "-m", "Fix shared behavior"]);
    const next = await git(["rev-parse", "HEAD"]);
    await restarted.update("example", next);
    expect(restored.baseSha).toBe(next);
    expect(
      await fs.readFile(
        path.join(restored.sourcePath, "upstream-fix.txt"),
        "utf8",
      ),
    ).toBe("bug fixed");
    expect(
      await fs.readFile(
        path.join(restored.buildPath ?? "", "index.html"),
        "utf8",
      ),
    ).toBe("my version");
  }, 30_000);
});
