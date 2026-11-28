// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BacklinkList } from "@/hooks/use-backlinks";

const mocks = vi.hoisted(() => ({
  backlinks: {
    list: undefined as BacklinkList | undefined,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, params?: { count?: number }) =>
    params?.count === undefined ? key : `${key} ${params.count}`,
}));
vi.mock("@/hooks/use-backlinks", () => ({
  useBacklinks: () => ({
    list: mocks.backlinks.list,
    query: {
      isError: mocks.backlinks.isError,
      error: mocks.backlinks.error,
      refetch: mocks.backlinks.refetch,
    },
  }),
}));

const { BacklinkCount, DocumentBacklinks } =
  await import("./DocumentBacklinks");

function pages(total: number): BacklinkList["pages"] {
  return Array.from({ length: total }, (_, index) => ({
    id: `linking-${index}`,
    title: index === 2 ? "  " : `Linking page ${index}`,
    icon: null,
    url: `https://content.example.test/page/linking-${index}`,
    updatedAt: "2026-11-27T12:00:00.000Z",
  }));
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.backlinks.list = undefined;
  mocks.backlinks.isError = false;
  mocks.backlinks.error = null;
  mocks.backlinks.refetch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: ReactNode) {
  act(() => root.render(<MemoryRouter>{node}</MemoryRouter>));
}

function click(element: Element | null) {
  if (!element) throw new Error("Expected the element to be there");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const linkIds = () =>
  [...container.querySelectorAll("[data-document-backlink]")].map((link) =>
    link.getAttribute("data-document-backlink"),
  );

describe("DocumentBacklinks", () => {
  it("lists the first five linking pages as links and unfolds the rest", () => {
    mocks.backlinks.list = { pages: pages(7), count: 7, more: false };
    render(<DocumentBacklinks documentId="target" />);

    expect(container.querySelector("h3")?.textContent).toContain(
      "backlinks.title",
    );
    expect(
      container.querySelector("[data-document-backlinks-count]")?.textContent,
    ).toContain("7");
    expect(linkIds()).toEqual([
      "linking-0",
      "linking-1",
      "linking-2",
      "linking-3",
      "linking-4",
    ]);
    const first = container.querySelector(
      '[data-document-backlink="linking-0"]',
    );
    expect(first?.getAttribute("href")).toBe("/page/linking-0");
    expect(first?.textContent).toContain("Linking page 0");
    expect(
      container.querySelector('[data-document-backlink="linking-2"]')
        ?.textContent,
    ).toContain("sidebar.untitled");

    const toggle = container.querySelector("[data-document-backlinks-toggle]");
    expect(toggle?.textContent).toBe("backlinks.showMore 2");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    click(toggle);
    expect(linkIds()).toHaveLength(7);
    expect(toggle?.textContent).toBe("backlinks.showFewer");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  it("says when only the most recently edited pages are listed", () => {
    mocks.backlinks.list = { pages: pages(3), count: 200, more: true };
    render(<DocumentBacklinks documentId="target" />);

    expect(container.textContent).toContain("backlinks.notAllListed");
    expect(
      container.querySelector("[data-document-backlinks-count]")?.textContent,
    ).toContain("200+");
  });

  it("says the list stops short when it counted more than it lists", () => {
    mocks.backlinks.list = { pages: pages(3), count: 250, more: false };
    render(<DocumentBacklinks documentId="target" />);

    expect(container.textContent).toContain("backlinks.notAllListed");
    expect(
      container.querySelector("[data-document-backlinks-count]")?.textContent,
    ).not.toContain("+");
  });

  it("links each page by its encoded id", () => {
    mocks.backlinks.list = {
      pages: pages(1).map((linking) => ({ ...linking, id: "a b/c" })),
      count: 1,
      more: false,
    };
    render(<DocumentBacklinks documentId="target" />);

    expect(
      container.querySelector("[data-document-backlink]")?.getAttribute("href"),
    ).toBe("/page/a%20b%2Fc");
  });

  it("says it couldn't check every page when none of those it checked can be listed", () => {
    mocks.backlinks.list = { pages: [], count: 0, more: true };
    render(<DocumentBacklinks documentId="target" />);

    expect(
      container.querySelector("[data-document-backlinks-empty]")?.textContent,
    ).toBe("backlinks.tooManyToCheck");
  });

  it("says no pages link here yet", () => {
    mocks.backlinks.list = { pages: [], count: 0, more: false };
    render(<DocumentBacklinks documentId="target" />);

    expect(
      container.querySelector("[data-document-backlinks-empty]")?.textContent,
    ).toBe("backlinks.none");
    expect(
      container.querySelector("[data-document-backlinks-count]"),
    ).toBeNull();
  });

  it("shows that it's loading", () => {
    render(<DocumentBacklinks documentId="target" />);

    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe("backlinks.loading");
  });

  it("offers a retry when the list doesn't load", () => {
    mocks.backlinks.isError = true;
    mocks.backlinks.error = Object.assign(new Error("offline"), {
      status: 503,
    });
    render(<DocumentBacklinks documentId="target" />);

    expect(container.textContent).toContain("backlinks.loadFailed");
    click(container.querySelector("button"));
    expect(mocks.backlinks.refetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])(
    "shows nothing when the read is refused with %s",
    (status) => {
      mocks.backlinks.isError = true;
      mocks.backlinks.error = Object.assign(new Error("refused"), { status });
      render(<DocumentBacklinks documentId="target" />);

      expect(container.querySelector("[data-document-backlinks]")).toBeNull();
    },
  );
});

describe("BacklinkCount", () => {
  it("stays hidden until a page links here", () => {
    mocks.backlinks.list = { pages: [], count: 0, more: false };
    render(<BacklinkCount documentId="target" onOpen={vi.fn()} />);

    expect(
      container.querySelector("[data-document-backlink-count]"),
    ).toBeNull();
  });

  it("counts the linking pages and opens them", () => {
    const onOpen = vi.fn();
    mocks.backlinks.list = { pages: pages(3), count: 3, more: false };
    render(<BacklinkCount documentId="target" onOpen={onOpen} />);

    const count = container.querySelector("[data-document-backlink-count]");
    expect(count?.textContent).toBe("backlinks.linkedFrom 3");
    click(count);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])(
    "hides an earlier count once the read is refused with %s",
    (status) => {
      mocks.backlinks.list = { pages: pages(3), count: 3, more: false };
      mocks.backlinks.isError = true;
      mocks.backlinks.error = Object.assign(new Error("refused"), { status });
      render(<BacklinkCount documentId="target" onOpen={vi.fn()} />);

      expect(
        container.querySelector("[data-document-backlink-count]"),
      ).toBeNull();
    },
  );

  it("says there are more than it counted", () => {
    mocks.backlinks.list = { pages: pages(3), count: 1_000, more: true };
    render(<BacklinkCount documentId="target" onOpen={vi.fn()} />);

    expect(
      container.querySelector("[data-document-backlink-count]")?.textContent,
    ).toBe("backlinks.linkedFromMore 1000");
  });
});
