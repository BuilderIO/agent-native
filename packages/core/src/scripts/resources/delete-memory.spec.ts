import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resourcePut: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({})),
  resourceGetByPath: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => ({
      content: "# Memory Index\n- [style](style.md) — Style\n",
    }),
  ),
  resourceDeleteByPath: vi.fn(
    async (..._args: unknown[]): Promise<boolean> => true,
  ),
}));

vi.mock("../../resources/store.js", () => ({
  resourcePut: (...args: unknown[]) => mocks.resourcePut(...args),
  resourceGetByPath: (...args: unknown[]) => mocks.resourceGetByPath(...args),
  resourceDeleteByPath: (...args: unknown[]) =>
    mocks.resourceDeleteByPath(...args),
}));

import {
  MemoryMirrorStaleError,
  MemoryTombstoneError,
} from "../../resources/shared-memory.js";
import deleteMemoryScript from "./delete-memory.js";

const run = () => {
  vi.stubEnv("AGENT_USER_EMAIL", "alice@example.test");
  return deleteMemoryScript(["--name", "style"]);
};

describe("delete-memory", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("fails a delete that could not start and leaves the index alone", async () => {
    mocks.resourceDeleteByPath.mockRejectedValueOnce(
      new MemoryTombstoneError("disk full"),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run()).rejects.toThrow(/was not deleted.*disk full/);
    expect(mocks.resourcePut).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("not found"));
    log.mockRestore();
  });

  it("reports the memory as deleted when the index cleanup fails afterwards", async () => {
    mocks.resourcePut.mockRejectedValueOnce(new Error("conflict"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run()).rejects.toThrow(/cleanup was incomplete/);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/Deleted memory "style".*index.*conflict/),
    );
    log.mockRestore();
  });

  it("reports a leftover shared file after a delete that committed", async () => {
    mocks.resourceDeleteByPath.mockRejectedValueOnce(
      new MemoryMirrorStaleError("memory/style.md could not be unlinked", {
        path: "memory/style.md",
        content: "",
        updatedAt: 1,
      }),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run()).rejects.toThrow(/cleanup was incomplete/);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/Deleted memory "style".*leftover shared file/),
    );
    log.mockRestore();
  });

  it("reports both a leftover file and a failed index update", async () => {
    mocks.resourceDeleteByPath.mockRejectedValueOnce(
      new MemoryMirrorStaleError("memory/style.md could not be unlinked", {
        path: "memory/style.md",
        content: "",
        updatedAt: 1,
      }),
    );
    mocks.resourcePut.mockRejectedValueOnce(new Error("conflict"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run()).rejects.toThrow(/cleanup was incomplete/);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/leftover shared file.*index.*conflict/),
    );
    log.mockRestore();
  });

  it("prints a plain success line when nothing went wrong", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(run()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Deleted memory "style".');
    log.mockRestore();
  });

  it("says when there was nothing to delete", async () => {
    mocks.resourceDeleteByPath.mockResolvedValueOnce(false);
    mocks.resourceGetByPath.mockResolvedValueOnce(null);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(run()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('Memory "style" not found.');
    log.mockRestore();
  });

  it("does not swallow other delete errors", async () => {
    mocks.resourceDeleteByPath.mockRejectedValueOnce(new Error("db down"));
    await expect(run()).rejects.toThrow("db down");
  });

  it("reports the committed deletion and the stale index mirror before failing", async () => {
    mocks.resourcePut.mockRejectedValueOnce(
      new MemoryMirrorStaleError("stale", {
        path: "memory/MEMORY.md",
        content: "",
        updatedAt: 1,
      }),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(run()).rejects.toThrow(/cleanup was incomplete/);
    expect(mocks.resourcePut).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /Deleted memory "style".*index.*shared copy is stale: stale/,
      ),
    );
    log.mockRestore();
  });
});
