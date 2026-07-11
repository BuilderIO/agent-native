import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  useLocation: vi.fn(),
  useNavigate: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: vi.fn(),
    useRef: <T>(value: T) => ({ current: value }),
  };
});

vi.mock("react-router", () => ({
  useLocation: mocks.useLocation,
  useNavigate: mocks.useNavigate,
}));

vi.mock("@/lib/route-prewarm", () => ({
  prewarmPlanRoutePath: vi.fn(),
}));

vi.mock("@/lib/tab-id", () => ({ TAB_ID: "test-tab" }));

import { useNavigationState } from "./use-navigation-state";

describe("useNavigationState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useLocation.mockReturnValue({ pathname: "/plans", search: "" });
    mocks.useNavigate.mockReturnValue(vi.fn());
    mocks.useQueryClient.mockReturnValue({ setQueryData: vi.fn() });
    mocks.useQuery.mockReturnValue({ data: null });
  });

  it("waits for sync invalidation instead of polling navigate state", () => {
    useNavigationState();

    expect(mocks.useQuery).toHaveBeenCalledOnce();
    expect(mocks.useQuery.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        queryKey: ["navigate-command"],
        retry: false,
        structuralSharing: false,
      }),
    );
    expect(mocks.useQuery.mock.calls[0]?.[0]).not.toHaveProperty(
      "refetchInterval",
    );
  });
});
