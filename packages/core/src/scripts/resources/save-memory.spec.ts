import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resourceGetByPath: vi.fn(),
  resourcePut: vi.fn(),
}));

vi.mock("../../resources/store.js", () => ({
  resourceGetByPath: (...args: unknown[]) => mocks.resourceGetByPath(...args),
  resourcePut: (...args: unknown[]) => mocks.resourcePut(...args),
}));

import {
  ensureRequestRunContext,
  runWithRequestContext,
} from "../../server/request-context.js";
import saveMemoryScript from "./save-memory.js";

const args = [
  "--name",
  "coding-style",
  "--type",
  "feedback",
  "--description",
  "Use concise updates",
  "--content",
  "Remember this.",
];

describe("save-memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_USER_EMAIL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes and verifies memory under the active agent run owner", async () => {
    const stored = new Map<string, string>();
    mocks.resourcePut.mockImplementation(
      async (owner: string, path: string, content: string) => {
        stored.set(`${owner}:${path}`, content);
        return { content };
      },
    );
    mocks.resourceGetByPath.mockImplementation(
      async (owner: string, path: string) => {
        const content = stored.get(`${owner}:${path}`);
        return content === undefined ? null : { content };
      },
    );

    await runWithRequestContext({}, async () => {
      ensureRequestRunContext()!.owner = "run-owner@example.com";
      await saveMemoryScript(args);
    });

    expect(mocks.resourcePut).toHaveBeenNthCalledWith(
      1,
      "run-owner@example.com",
      "memory/coding-style.md",
      expect.stringContaining("Remember this."),
      "text/markdown",
    );
    expect(mocks.resourcePut).toHaveBeenNthCalledWith(
      2,
      "run-owner@example.com",
      "memory/MEMORY.md",
      expect.stringContaining("- [coding-style](coding-style.md)"),
      "text/markdown",
    );
    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
      "run-owner@example.com",
      "memory/coding-style.md",
    );
    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
      "run-owner@example.com",
      "memory/MEMORY.md",
    );
  });

  it("does not claim success when the memory write cannot be read back", async () => {
    mocks.resourcePut.mockResolvedValue({ content: "" });
    mocks.resourceGetByPath.mockResolvedValue(null);

    await expect(
      runWithRequestContext({}, async () => {
        ensureRequestRunContext()!.owner = "run-owner@example.com";
        await saveMemoryScript(args);
      }),
    ).rejects.toThrow('could not verify persisted memory "coding-style"');
  });
});
