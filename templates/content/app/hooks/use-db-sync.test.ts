import { beforeEach, describe, expect, it, vi } from "vitest";

const useCoreDbSync = vi.hoisted(() => vi.fn());
const useQueryClient = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client", () => ({
  getBrowserTabId: () => "content-tab-1",
  useDbSync: useCoreDbSync,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient,
}));

import { useDbSync } from "./use-db-sync";

describe("Content useDbSync", () => {
  beforeEach(() => {
    useCoreDbSync.mockReset();
    useQueryClient.mockReset();
  });

  it("ignores only action events tagged by the current Content tab", () => {
    const queryClient = { invalidateQueries: vi.fn() };
    useQueryClient.mockReturnValue(queryClient);

    useDbSync();

    expect(useCoreDbSync).toHaveBeenCalledWith(
      expect.objectContaining({
        queryClient,
        ignoreSource: "content-tab-1",
      }),
    );
  });
});
