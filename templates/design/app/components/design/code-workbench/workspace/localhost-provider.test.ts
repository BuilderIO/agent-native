import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
}));

import {
  createLocalhostProvider,
  LocalWorkspaceTimeoutError,
  withLocalReadTimeout,
} from "./localhost-provider";

describe("createLocalhostProvider", () => {
  beforeEach(() => {
    mockCallAction.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists connected local files and preserves editable metadata", async () => {
    mockCallAction.mockResolvedValueOnce({
      files: [{ path: "src/App.tsx", size: 42 }],
      truncated: false,
    });
    const provider = createLocalhostProvider({
      connectionId: "connection_1",
      label: "Local app",
      rootPath: "/workspace",
      canEdit: true,
      designId: "design_1",
    });

    await expect(provider.listFiles()).resolves.toEqual([
      { path: "src/App.tsx", size: 42, readonly: false },
    ]);
    expect(mockCallAction).toHaveBeenCalledWith(
      "list-local-files",
      { designId: "design_1", connectionId: "connection_1" },
      { method: "GET" },
    );
  });

  it("turns a stalled local listing into a retryable timeout error", async () => {
    vi.useFakeTimers();
    const request = withLocalReadTimeout(
      "list",
      new Promise<never>(() => {}),
      25,
    );
    const rejection = expect(request).rejects.toThrow(
      "Local files took too long to load",
    );

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    await expect(request).rejects.toBeInstanceOf(LocalWorkspaceTimeoutError);
  });

  it("does not leave a timeout behind after a successful read", async () => {
    vi.useFakeTimers();
    const request = withLocalReadTimeout("read", Promise.resolve("source"), 25);

    await expect(request).resolves.toBe("source");
    expect(vi.getTimerCount()).toBe(0);
  });
});
