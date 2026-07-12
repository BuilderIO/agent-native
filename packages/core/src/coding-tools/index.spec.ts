import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { actionsToEngineTools } from "../agent/production-agent.js";
import { createDevScriptRegistry } from "../scripts/dev/index.js";
import { createDbScriptEntries } from "../server/agent-chat/script-entries.js";
import {
  BASH_OUTPUT_HEAD_CHARS,
  BASH_OUTPUT_TAIL_CHARS,
  createCodingToolRegistry,
  isReadOnlyShellCommand,
  spawnBackgroundCommand,
  truncateBashOutput,
  truncateCodingOutput,
} from "./index.js";

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

  it("omits bridge-only actions from engine tool lists", () => {
    const registry = createCodingToolRegistry({
      cwd: tempDir(),
      restrictToCwd: true,
    });

    expect(
      actionsToEngineTools({
        ...registry,
        bridgeOnly: {
          ...registry.read,
          agentTool: false,
        },
      }).map((tool) => tool.name),
    ).toEqual(["bash", "read", "edit", "write"]);
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

  it("defaults raw database tools to read-only in dev mode", async () => {
    const registry = await createDevScriptRegistry();

    expect(registry["db-schema"]).toBeDefined();
    expect(registry["db-query"]).toBeDefined();
    expect(registry["db-check-scoping"]).toBeDefined();
    expect(registry["db-exec"]).toBeUndefined();
    expect(registry["db-patch"]).toBeUndefined();
    await expect(
      registry.bash.run({
        command: 'pnpm action db-exec --sql "UPDATE forms SET status = 1"',
      }),
    ).resolves.toContain("raw database write tools are disabled");
  });

  it("uses an exclusive db-exec schema when write mode is explicit", async () => {
    const registry = await createDevScriptRegistry({ databaseTools: "write" });

    expect(registry["db-exec"]?.tool.parameters).toMatchObject({
      additionalProperties: false,
      oneOf: [{ required: ["sql"] }, { required: ["statements"] }],
    });
  });

  it("can disable raw database tools without removing coding tools", async () => {
    const registry = await createDevScriptRegistry({ databaseTools: false });

    expect(registry.bash).toBeDefined();
    expect(registry.read).toBeDefined();
    expect(registry.edit).toBeDefined();
    expect(registry.write).toBeDefined();
    expect(registry["db-query"]).toBeUndefined();
    expect(registry["db-exec"]).toBeUndefined();
    expect(registry["db-patch"]).toBeUndefined();
    expect(registry["db-schema"]).toBeUndefined();
    await expect(
      registry.bash.run({
        command: 'pnpm action db-query --sql "SELECT 1"',
      }),
    ).resolves.toContain("raw database tools are disabled");
  });

  it("can expose read-only database tools without raw SQL write tools", async () => {
    const registry = await createDevScriptRegistry({ databaseTools: "read" });

    expect(registry["db-schema"]).toBeDefined();
    expect(registry["db-query"]).toBeDefined();
    expect(registry["db-check-scoping"]).toBeDefined();
    expect(registry["db-exec"]).toBeUndefined();
    expect(registry["db-patch"]).toBeUndefined();
    await expect(
      registry.bash.run({
        command: 'pnpm action db-exec --sql "UPDATE forms SET status = 1"',
      }),
    ).resolves.toContain("raw database write tools are disabled");
  });

  it("keeps core read-only database tools out of automatic external exposure", async () => {
    const registry = await createDbScriptEntries("read", {
      extensionTools: false,
    });

    for (const name of ["db-schema", "db-query"]) {
      expect(registry[name]).toMatchObject({
        readOnly: true,
      });
      expect(registry[name].http).toBeUndefined();
      expect(registry[name].publicAgent).toBeUndefined();
    }
    expect(registry["db-exec"]).toBeUndefined();
    expect(registry["db-patch"]).toBeUndefined();
  });

  it("rejects CLI-only database flags from native DB read tools", async () => {
    const registry = await createDbScriptEntries("read", {
      extensionTools: false,
    });

    await expect(
      registry["db-query"].run({
        sql: "SELECT 1",
        db: "/tmp/other-app.db",
      }),
    ).rejects.toThrow("Unknown argument: db");
    await expect(
      registry["db-schema"].run({ db: "/tmp/other-app.db" }),
    ).rejects.toThrow("Unknown argument: db");
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

describe("truncateCodingOutput", () => {
  it("returns short strings unchanged", () => {
    expect(truncateCodingOutput("hello", 100)).toBe("hello");
  });

  it("truncates long strings with a marker", () => {
    const result = truncateCodingOutput("abcdef", 4);
    expect(result).toContain("abcd");
    expect(result).toContain("truncated 2 chars");
  });
});

describe("truncateBashOutput", () => {
  it("returns short strings unchanged", () => {
    expect(truncateBashOutput("hello world", 100, 100)).toBe("hello world");
  });

  it("keeps head and tail with an omission marker for long strings", () => {
    const head = "A".repeat(10);
    const middle = "B".repeat(20);
    const tail = "C".repeat(10);
    const input = head + middle + tail;
    const result = truncateBashOutput(input, 10, 10);

    expect(result.startsWith(head)).toBe(true);
    expect(result.endsWith(tail)).toBe(true);
    expect(result).toContain("20 chars omitted");
  });

  it("uses default head/tail constants when called without args", () => {
    const totalMax = BASH_OUTPUT_HEAD_CHARS + BASH_OUTPUT_TAIL_CHARS;
    const input = "x".repeat(totalMax + 1000);
    const result = truncateBashOutput(input);

    expect(result.length).toBeLessThan(input.length);
    expect(result).toContain("chars omitted");
    expect(result.slice(0, BASH_OUTPUT_HEAD_CHARS)).toBe(
      "x".repeat(BASH_OUTPUT_HEAD_CHARS),
    );
    expect(result.slice(result.length - BASH_OUTPUT_TAIL_CHARS)).toBe(
      "x".repeat(BASH_OUTPUT_TAIL_CHARS),
    );
  });

  it("handles empty string", () => {
    expect(truncateBashOutput("")).toBe("");
  });
});

describe("structuredMeta side-channel via onToolMetadata", () => {
  it("calls onToolMetadata for bash with command/cwd on start and exitCode on done", async () => {
    const cwd = tempDir();
    const calls: { phase: string; meta: Record<string, unknown> }[] = [];
    const registry = createCodingToolRegistry({
      cwd,
      onToolMetadata: (toolName, phase, meta) => {
        if (toolName === "bash") {
          calls.push({ phase, meta: meta as Record<string, unknown> });
        }
      },
    });

    await registry.bash.run({ command: "echo hi" });

    expect(calls.length).toBeGreaterThanOrEqual(2);
    const startCall = calls.find((c) => c.phase === "start");
    const doneCall = calls.find((c) => c.phase === "done");
    expect(startCall?.meta.toolKind).toBe("bash");
    expect(startCall?.meta.command).toBe("echo hi");
    expect(doneCall?.meta.exitCode).toBe(0);
    expect(typeof doneCall?.meta.durationMs).toBe("number");
  });

  it("calls onToolMetadata for edit with oldText/newText on done", async () => {
    const cwd = tempDir();
    fs.writeFileSync(path.join(cwd, "greet.txt"), "hello world\n", "utf8");
    const doneMetas: Record<string, unknown>[] = [];
    const registry = createCodingToolRegistry({
      cwd,
      onToolMetadata: (_toolName, phase, meta) => {
        if (phase === "done") doneMetas.push(meta as Record<string, unknown>);
      },
    });

    await registry.edit.run({
      path: "greet.txt",
      oldText: "hello world",
      newText: "hi world",
    });

    const editMeta = doneMetas[0];
    expect(editMeta?.toolKind).toBe("edit");
    expect(editMeta?.filePath).toBe("greet.txt");
    expect(editMeta?.oldText).toContain("hello world");
    expect(editMeta?.newText).toContain("hi world");
  });

  it("calls onToolMetadata for write with content/lineCount on done", async () => {
    const cwd = tempDir();
    const doneMetas: Record<string, unknown>[] = [];
    const registry = createCodingToolRegistry({
      cwd,
      onToolMetadata: (_toolName, phase, meta) => {
        if (phase === "done") doneMetas.push(meta as Record<string, unknown>);
      },
    });

    await registry.write.run({ path: "new.txt", content: "line1\nline2\n" });

    const writeMeta = doneMetas[0];
    expect(writeMeta?.toolKind).toBe("write");
    expect(writeMeta?.filePath).toBe("new.txt");
    expect(writeMeta?.lineCount).toBe(3);
    expect(writeMeta?.content).toContain("line1");
  });
});

describe("bash background execution", () => {
  it("returns immediately with pid and log file path", async () => {
    const cwd = tempDir();
    const registry = createCodingToolRegistry({ cwd });
    const result = await registry.bash.run({
      command: "echo background-hello",
      background: "true",
    });
    expect(typeof result).toBe("string");
    expect(result).toMatch(/Background process spawned/);
    expect(result).toMatch(/pid:/);
    expect(result).toMatch(/log:/);
  });

  it("spawnBackgroundCommand returns pid and log path in output", async () => {
    const cwd = tempDir();
    const result = spawnBackgroundCommand("echo direct-spawn", cwd);
    expect(result).toMatch(/Background process spawned/);
    expect(result).toMatch(/pid:\s*\d+/);
    expect(result).toMatch(/log:\s*\S+\.log/);
  });

  it("writes output to the log file", async () => {
    const cwd = tempDir();
    const result = spawnBackgroundCommand("echo logged-output", cwd);
    const logMatch = result.match(/log:\s*(\S+)/);
    expect(logMatch).not.toBeNull();
    const logFile = logMatch![1];
    // Give the process a moment to write its output.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(logFile, "utf8");
    expect(content).toContain("logged-output");
    fs.unlinkSync(logFile);
  });

  it("beforeBash policy still applies to background commands", async () => {
    const cwd = tempDir();
    const registry = createCodingToolRegistry({
      cwd,
      beforeBash: ({ command }) => {
        if (command.includes("blocked")) return "Error: blocked by policy";
        return null;
      },
    });
    const result = await registry.bash.run({
      command: "echo blocked",
      background: "true",
    });
    expect(result).toBe("Error: blocked by policy");
  });

  it("default timeout is 120000 ms", () => {
    // Verify the exported default via tool description which mentions 120000.
    const registry = createCodingToolRegistry({});
    const bashTool = registry.bash.tool;
    const timeoutParam = (
      bashTool.parameters as {
        properties: Record<string, { description: string }>;
      }
    ).properties.timeoutMs;
    expect(timeoutParam.description).toContain("120000");
  });
});
