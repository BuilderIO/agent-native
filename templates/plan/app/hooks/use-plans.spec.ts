import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  useActionMutation: vi.fn(),
  useActionQuery: vi.fn(),
}));

vi.mock("@agent-native/core/client", () => ({
  useActionMutation: mocks.useActionMutation,
  useActionQuery: mocks.useActionQuery,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

import { usePlan } from "./use-plans";

describe("usePlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useActionQuery.mockReturnValue({ data: undefined });
  });

  it("keeps legacy HTML in detail reads while skipping MDX export", () => {
    usePlan("plan_123");

    expect(mocks.useActionQuery).toHaveBeenCalledWith(
      "get-visual-plan",
      { id: "plan_123", includeMdx: false, includeHtml: true },
      expect.objectContaining({
        enabled: true,
        placeholderData: expect.any(Function),
      }),
    );
    expect(mocks.useActionQuery.mock.calls[0]?.[2]).not.toHaveProperty(
      "refetchInterval",
    );
  });
});
