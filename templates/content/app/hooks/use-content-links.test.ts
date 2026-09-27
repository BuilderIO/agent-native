import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => api.callAction(...args),
  useActionQuery: vi.fn(),
}));

import { loadPageLinkTarget } from "./use-content-links";

afterEach(() => {
  api.callAction.mockReset();
});

describe("page-link target lookup", () => {
  it("resolves the blocks of one render pass with one request", async () => {
    api.callAction.mockResolvedValue({
      links: [
        {
          id: "doc-a",
          documentId: "doc-a",
          title: "Page A",
          icon: null,
        },
        {
          id: "0123456789abcdef0123456789abcdef",
          documentId: "doc-notion",
          title: "Linked page",
          icon: "📄",
        },
      ],
      sources: [],
    });

    const results = await Promise.all([
      loadPageLinkTarget("doc-a"),
      loadPageLinkTarget("0123456789abcdef0123456789abcdef"),
      loadPageLinkTarget("doc-a"),
      loadPageLinkTarget("doc-missing"),
    ]);

    expect(api.callAction).toHaveBeenCalledTimes(1);
    expect(api.callAction).toHaveBeenCalledWith(
      "resolve-content-links",
      {
        ids: ["doc-a", "0123456789abcdef0123456789abcdef", "doc-missing"],
      },
      { method: "GET" },
    );
    expect(results).toEqual([
      { documentId: "doc-a", title: "Page A", icon: null },
      { documentId: "doc-notion", title: "Linked page", icon: "📄" },
      { documentId: "doc-a", title: "Page A", icon: null },
      null,
    ]);
  });

  it("fails every waiting block when the lookup fails instead of reporting absent", async () => {
    api.callAction.mockRejectedValue(new Error("lookup unavailable"));

    const results = await Promise.allSettled([
      loadPageLinkTarget("doc-a"),
      loadPageLinkTarget("doc-b"),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
  });

  it("splits more than one request's worth of ids into bounded batches", async () => {
    api.callAction.mockImplementation(
      async (_name: string, params: { ids: string[] }) => ({
        links: params.ids.map((id) => ({
          id,
          documentId: id,
          title: id,
          icon: null,
        })),
        sources: [],
      }),
    );

    await Promise.all(
      Array.from({ length: 150 }, (_, index) =>
        loadPageLinkTarget(`doc-${index}`),
      ),
    );

    expect(api.callAction).toHaveBeenCalledTimes(2);
    expect(
      api.callAction.mock.calls.map(
        ([, params]) => (params as { ids: string[] }).ids.length,
      ),
    ).toEqual([100, 50]);
  });
});
