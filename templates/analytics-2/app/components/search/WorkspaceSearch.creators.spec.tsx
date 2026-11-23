// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { useSearchFilterOptions } from "./useSearchFilterOptions";
import { WorkspaceSearch } from "./WorkspaceSearch";

const queries = vi.hoisted(() => ({
  calls: vi.fn(),
  fail: false,
  loading: false,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    name: string,
    input: { search?: string; offset?: number },
  ) => {
    queries.calls(name, input);
    if (name !== "list-organization-members")
      return { data: {}, isPending: false, isError: false };
    if (queries.fail)
      return { data: undefined, isError: true, isPending: false };
    if (queries.loading)
      return { data: undefined, isError: false, isPending: true };
    const lastPage = input.search === "zara" || input.offset === 50;
    return {
      isError: false,
      isPending: false,
      data: {
        members:
          input.search === "zara"
            ? [{ email: "zara@example.test" }]
            : input.offset === 50
              ? [{ email: "ana@example.test" }, { email: "zara@example.test" }]
              : [
                  { email: "ana@example.test" },
                  ...Array.from({ length: 49 }, (_, index) => ({
                    email: `member-${index}@example.test`,
                  })),
                ],
        hasMore: !lastPage,
        nextOffset: lastPage ? null : 50,
      },
    };
  },
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useOptionalLocale: () => undefined,
  useT: () => (key: string) =>
    ({
      "analytics.shell.searchFilters.creatorSearchPlaceholder":
        "Search by creator...",
      "analytics.shell.searchFilters.creatorSearching": "Searching...",
      "analytics.shell.searchFilters.creatorSearchFailed": "Search failed",
      "analytics.shell.more": "More",
      "analytics.shell.searchFilters.creatorEmpty":
        "No workspace members available",
    })[key] || key,
}));

let root: Root | undefined;
let host: HTMLDivElement;
const search = vi.fn().mockResolvedValue([]);
function Harness({ open = true }: { open?: boolean }) {
  const filterOptions = useSearchFilterOptions(open);
  return (
    <WorkspaceSearch
      open={open}
      onClose={() => {}}
      onNavigate={() => {}}
      onSearch={search}
      filterOptions={filterOptions}
    />
  );
}
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Harness />));
  const creator = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "Creator",
  );
  if (!creator) throw Error("Missing creator filter");
  await act(async () => creator.click());
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
  queries.fail = false;
  queries.loading = false;
});
it("searches the server after 200ms and reaches members beyond the first page", async () => {
  vi.useFakeTimers();
  await mount();
  const input = host.querySelector<HTMLInputElement>(
    'input[placeholder="Search by creator..."]',
  );
  expect(input).not.toBeNull();
  if (!input) throw Error("Missing creator search input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "zara");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.textContent).toContain("Searching...");
  expect(queries.calls).not.toHaveBeenCalledWith(
    "list-organization-members",
    expect.objectContaining({ search: "zara" }),
  );
  await act(async () => vi.advanceTimersByTime(200));
  expect(queries.calls).toHaveBeenCalledWith("list-organization-members", {
    search: "zara",
    limit: 50,
    offset: 0,
  });
  expect(host.textContent).toContain("zara@example.test");
});
it("offers the next bounded page and keeps email selections across pages", async () => {
  vi.useFakeTimers();
  await mount();
  const first = [
    ...host.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitemcheckbox"]',
    ),
  ].find((b) => b.textContent === "ana@example.test");
  if (!first) throw Error("Missing first creator");
  await act(async () => first.click());
  const more = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "More",
  );
  expect(more).toBeDefined();
  await act(async () => more?.click());
  expect(queries.calls).toHaveBeenCalledWith("list-organization-members", {
    search: "",
    limit: 50,
    offset: 50,
  });
  expect(host.textContent).toContain("zara@example.test");
  expect(host.textContent).toContain("Creator: ana@example.test");
  expect(host.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(51);
  expect(
    [...host.querySelectorAll('[role="menuitemcheckbox"]')].filter(
      (item) => item.textContent === "ana@example.test",
    ),
  ).toHaveLength(1);
  const input = host.querySelector<HTMLInputElement>(
    'input[placeholder="Search by creator..."]',
  );
  if (!input) throw Error("Missing creator search input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "zara");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTime(200));
  expect(host.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(1);
  expect(host.textContent).toContain("Creator: ana@example.test");
  await act(async () => vi.advanceTimersByTime(250));
  expect(search).toHaveBeenLastCalledWith(
    expect.objectContaining({ creatorIds: ["ana@example.test"] }),
    expect.any(Function),
  );
});
it.each(["loading", "error"])(
  "distinguishes a %s member read from an empty roster",
  async (state) => {
    queries.loading = state === "loading";
    queries.fail = state === "error";
    await mount();
    expect(host.textContent).toContain(
      state === "loading" ? "Searching..." : "Search failed",
    );
    expect(host.textContent).not.toContain("No workspace members available");
  },
);

it("starts a fresh creator search when the workspace panel reopens", async () => {
  vi.useFakeTimers();
  await mount();
  const input = host.querySelector<HTMLInputElement>(
    'input[placeholder="Search by creator..."]',
  );
  if (!input) throw Error("Missing creator search input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "zara");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTime(200));
  expect(host.textContent).toContain("zara@example.test");
  await act(async () => root?.render(<Harness open={false} />));
  await act(async () => root?.render(<Harness />));
  const creator = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "Creator",
  );
  if (!creator) throw Error("Missing creator filter after reopen");
  await act(async () => creator.click());
  expect(
    host.querySelector<HTMLInputElement>(
      'input[placeholder="Search by creator..."]',
    )?.value,
  ).toBe("");
  expect(host.textContent).toContain("ana@example.test");
  expect(host.textContent).not.toContain("zara@example.test");
});
