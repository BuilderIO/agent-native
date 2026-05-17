import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { actionsToEngineTools } from "../agent/production-agent.js";
import { createDevScriptRegistry } from "../scripts/dev/index.js";
import { createCodingToolRegistry, isReadOnlyShellCommand } from "./index.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("shared coding tools", () => {
  it("exposes the minimal bash/read/edit/write tool surface", async () => {
    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, "hello.txt"), "hello\nworld\n", "utf8");
    const registry = createCodingToolRegistry({ cwd, restrictToCwd: true });

    expect(Object.keys(registry)).toEqual(["bash", "read", "edit", "write"]);
    expect(actionsToEngineTools(registry).map((tool) => tool.name)).toEqual([
      "bash",
      "read",
      "edit",
      "write",
    ]);
    await expect(registry.read.run({ path: "hello.txt" })).resolves.toContain(
      "1 | hello",
    );
    await expect(
      registry.edit.run({
        path: "hello.txt",
        oldText: "hello",
        newText: "hi",
      }),
    ).resolves.toContain("Edited hello.txt");
    expect(fs.readFileSync(path.join(cwd, "hello.txt"), "utf8")).toBe(
      "hi\nworld\n",
    );
    await expect(registry.bash.run({ command: "ls -a" })).resolves.toContain(
      "hello.txt",
    );
  });

  it("keeps sidebar dev mode on the shared tools and hides legacy aliases by default", async () => {
    const registry = await createDevScriptRegistry();

    expect(registry.bash).toBeDefined();
    expect(registry.read).toBeDefined();
    expect(registry.edit).toBeDefined();
    expect(registry.write).toBeDefined();
    expect(registry.shell).toBeUndefined();
    expect(registry["read-file"]).toBeUndefined();
    expect(registry["write-file"]).toBeUndefined();
    expect(registry["list-files"]).toBeUndefined();
    expect(registry["search-files"]).toBeUndefined();
  });

  it("can expose legacy aliases explicitly for compatibility callers", async () => {
    const registry = await createDevScriptRegistry({ legacyAliases: true });

    expect(registry.shell).toBeDefined();
    expect(registry["read-file"]).toBeDefined();
    expect(registry["write-file"]).toBeDefined();
    expect(registry["list-files"]).toBeDefined();
    expect(registry["search-files"]).toBeDefined();
  });

  it("accepts only a single simple read-only shell command", () => {
    expect(isReadOnlyShellCommand("rg button src")).toBe(true);
    expect(isReadOnlyShellCommand("git diff -- packages/core")).toBe(true);
    expect(isReadOnlyShellCommand("rg button > out.txt")).toBe(false);
    expect(isReadOnlyShellCommand("rg button; node -e '1'")).toBe(false);
    expect(isReadOnlyShellCommand("rg button | tee out.txt")).toBe(false);
    expect(isReadOnlyShellCommand("rg $(node -e '1')")).toBe(false);
    // sed: prints are read-only; w/W/-i can write and must be rejected.
    expect(isReadOnlyShellCommand("sed -n '1,10p' README.md")).toBe(true);
    expect(isReadOnlyShellCommand("sed -n '/window/p' README.md")).toBe(true);
    expect(isReadOnlyShellCommand("sed -n '1w notes.txt' README.md")).toBe(
      false,
    );
    expect(isReadOnlyShellCommand("sed -n 's/a/b/w out' README.md")).toBe(
      false,
    );
    expect(isReadOnlyShellCommand("sed -i 's/a/b/' README.md")).toBe(false);
  });
});

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-coding-tools-"));
  tmpRoots.push(root);
  return root;
}
