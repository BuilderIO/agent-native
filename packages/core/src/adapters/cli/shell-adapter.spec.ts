import { describe, it, expect } from "vitest";
import { ShellCliAdapter } from "./shell-adapter.js";

describe("ShellCliAdapter", () => {
  it("sets name from command by default", () => {
    const adapter = new ShellCliAdapter({
      command: "echo",
      description: "Echo text",
    });
    expect(adapter.name).toBe("echo");
    expect(adapter.description).toBe("Echo text");
  });

  it("allows custom name", () => {
    const adapter = new ShellCliAdapter({
      command: "python3",
      name: "python",
      description: "Python interpreter",
    });
    expect(adapter.name).toBe("python");
  });

  it("execute captures stdout", async () => {
    const adapter = new ShellCliAdapter({
      command: "echo",
      description: "Echo",
    });
    const result = await adapter.execute(["hello world"]);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.exitCode).toBe(0);
  });

  it("execute captures stderr and exit code for failing command", async () => {
    const adapter = new ShellCliAdapter({
      command: "node",
      description: "Node",
    });
    const result = await adapter.execute(["-e", "process.exit(42)"]);
    expect(result.exitCode).toBe(42);
  });

  it("execute returns stderr output", async () => {
    const adapter = new ShellCliAdapter({
      command: "node",
      description: "Node",
    });
    const result = await adapter.execute([
      "-e",
      "process.stderr.write('oops')",
    ]);
    expect(result.stderr).toBe("oops");
    expect(result.exitCode).toBe(0);
  });

  it("isAvailable returns true for installed command", async () => {
    const adapter = new ShellCliAdapter({
      command: "node",
      description: "Node.js",
    });
    expect(await adapter.isAvailable()).toBe(true);
  });

  it("isAvailable returns false for non-existent command", async () => {
    const adapter = new ShellCliAdapter({
      command: "definitely-not-a-real-cli-tool-xyz",
      description: "Fake",
    });
    expect(await adapter.isAvailable()).toBe(false);
  });

  it("passes env variables to the process", async () => {
    const adapter = new ShellCliAdapter({
      command: "node",
      description: "Node",
      env: { MY_TEST_VAR: "test-value-123" },
    });
    const result = await adapter.execute([
      "-e",
      "process.stdout.write(process.env.MY_TEST_VAR || '')",
    ]);
    expect(result.stdout).toBe("test-value-123");
  });
});
