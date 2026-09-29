import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseQuery = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => mockUseQuery(options),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("../api-path.js", () => ({
  agentNativePath: (path: string) => path,
}));

import { useExperiments } from "./useObservability.js";

describe("useExperiments", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockUseQuery.mockImplementation((options: { queryFn: () => unknown }) =>
      options.queryFn(),
    );
  });

  it("follows response cursors until the last page", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ id: "experiment-a", createdAt: 20 }],
          nextCursor: { createdAt: 20, id: "experiment-a" },
          hasMore: true,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ id: "experiment-b", createdAt: 10 }],
          nextCursor: null,
          hasMore: false,
        }),
      } as Response);

    await expect(useExperiments()).resolves.toEqual([
      { id: "experiment-a", createdAt: 20 },
      { id: "experiment-b", createdAt: 10 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "beforeCreatedAt=20&beforeId=experiment-a",
    );
  });
});
