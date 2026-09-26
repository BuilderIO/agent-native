import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resourceGetByPath: vi.fn(),
  resourcePut: vi.fn(),
  resourcePutIfSnapshot: vi.fn(async (_input: any) => null),
}));

vi.mock("../../resources/store.js", () => ({
  resourceGetByPath: (...args: unknown[]) => mocks.resourceGetByPath(...args),
  resourcePut: (...args: unknown[]) => mocks.resourcePut(...args),
  resourcePutIfSnapshot: (...args: unknown[]) =>
    mocks.resourcePutIfSnapshot(...args),
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
    vi.restoreAllMocks();
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
    mocks.resourcePutIfSnapshot.mockImplementation(
      async ({ owner, path, content }: any) => {
        stored.set(`${owner}:${path}`, content);
        return { before: null, resource: { owner, path, content } };
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
    expect(mocks.resourcePutIfSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "run-owner@example.com",
        path: "memory/MEMORY.md",
        content: expect.stringContaining("- [coding-style](coding-style.md)"),
        previous: null,
      }),
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
    mocks.resourcePutIfSnapshot.mockResolvedValue({
      before: null,
      resource: { content: "" },
    });

    await expect(
      runWithRequestContext({}, async () => {
        ensureRequestRunContext()!.owner = "run-owner@example.com";
        await saveMemoryScript(args);
      }),
    ).rejects.toThrow('could not verify persisted memory "coding-style"');
  });

  it("does not write either resource when the memory index cannot be read", async () => {
    mocks.resourceGetByPath.mockRejectedValue(new Error("storage unavailable"));

    await expect(
      runWithRequestContext({}, async () => {
        ensureRequestRunContext()!.owner = "run-owner@example.com";
        await saveMemoryScript(args);
      }),
    ).rejects.toThrow("storage unavailable");

    expect(mocks.resourceGetByPath).toHaveBeenCalledWith(
      "run-owner@example.com",
      "memory/MEMORY.md",
    );
    expect(mocks.resourcePut).not.toHaveBeenCalled();
    expect(mocks.resourcePutIfSnapshot).not.toHaveBeenCalled();
  });

  it("can save a memory without logging its user-authored description", async () => {
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
    mocks.resourcePutIfSnapshot.mockImplementation(
      async ({ owner, path, content }: any) => {
        stored.set(`${owner}:${path}`, content);
        return { before: null, resource: { owner, path, content } };
      },
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runWithRequestContext({}, async () => {
      ensureRequestRunContext()!.owner = "run-owner@example.com";
      await saveMemoryScript([...args, "--quiet", "true"]);
    });

    expect(log).not.toHaveBeenCalled();
  });

  it("re-reads and merges the index after a concurrent update", async () => {
    let index = "# Memory Index\n";
    let savedMemory = "";
    let indexReadCount = 0;
    const initialIndex = { content: "# Memory Index\n", updatedAt: 1 };
    mocks.resourcePut.mockImplementation(
      async (_owner: string, _path: string, content: string) => {
        savedMemory = content;
        return { content };
      },
    );
    mocks.resourceGetByPath.mockImplementation(
      async (_owner: string, path: string) => {
        if (path === "memory/coding-style.md") {
          return { content: savedMemory };
        }
        indexReadCount += 1;
        if (indexReadCount === 1) return initialIndex;
        return { content: index, updatedAt: 2 };
      },
    );
    mocks.resourcePutIfSnapshot
      .mockImplementationOnce(async () => {
        index = "# Memory Index\n- [other](other.md) — Other guidance\n";
        return null;
      })
      .mockImplementationOnce(async ({ owner, path, content }: any) => {
        index = content;
        return { before: null, resource: { owner, path, content } };
      });

    await runWithRequestContext({}, async () => {
      ensureRequestRunContext()!.owner = "run-owner@example.com";
      await saveMemoryScript(args);
    });

    expect(mocks.resourcePut).toHaveBeenCalledWith(
      "run-owner@example.com",
      "memory/coding-style.md",
      expect.any(String),
      "text/markdown",
    );
    expect(mocks.resourcePutIfSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        owner: "run-owner@example.com",
        path: "memory/MEMORY.md",
        content: expect.stringContaining("- [coding-style](coding-style.md)"),
        previous: expect.objectContaining({
          content: "# Memory Index\n- [other](other.md) — Other guidance\n",
        }),
      }),
    );
    expect(index).toContain("- [other](other.md) — Other guidance");
    expect(index).toContain("- [coding-style](coding-style.md)");
  });
});
