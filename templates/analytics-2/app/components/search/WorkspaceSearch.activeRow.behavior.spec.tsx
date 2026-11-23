// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchResult } from "./types";
import { WorkspaceSearch } from "./WorkspaceSearch";

import searchStyles from "./search.css?raw";

const askState = vi.hoisted(() => ({ enabled: false, action: vi.fn() }));

vi.mock("@/components/workspace/WorkspaceDataContext", () => ({
  useWorkspaceData: () =>
    askState.enabled
      ? {
          shell: {
            workspace: { id: "org-search" },
            features: { isAdmin: true },
          },
        }
      : undefined,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: askState.action,
}));

/**
 * Tester row sprint-crm-2#185: typing a query and pressing Enter ran nothing,
 * because every query change cleared the active row. The list keeps an active
 * row, and a changed query re-seats it on the first match.
 */

const project = (id: string, title: string): SearchResult =>
  ({
    id,
    title,
    href: `/project/${id}/latest`,
    updatedAt: "2026-11-12T10:00:00.000Z",
    kind: "project",
  }) as SearchResult;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let host: HTMLDivElement;
let root: Root | null = null;
let onNavigate: ReturnType<typeof vi.fn<(href: string) => void>>;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
  onNavigate = vi.fn<(href: string) => void>();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  vi.useRealTimers();
  root = null;
  askState.enabled = false;
  askState.action.mockReset();
  document.body.innerHTML = "";
});

async function mount(
  results: SearchResult[],
  onCreateThread?: (query: string, options: { newTab: boolean }) => void,
): Promise<void> {
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <WorkspaceSearch
        open
        filterOptions={{}}
        onClose={() => undefined}
        onNavigate={onNavigate}
        {...(onCreateThread ? { onCreateThread } : {})}
        onSearch={async () => results}
      />,
    );
    await wait(0);
  });
}

async function type(value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("input");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await wait(400);
  });
}

async function press(key: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("input");
  await act(async () => {
    input?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await wait(20);
  });
}

describe("workspace search keeps an active row", () => {
  it("starts a thread with the current text before the debounce", async () => {
    const create = vi.fn();
    await mount([project("old", "Old project")], create);
    const input = host.querySelector("input");
    if (!input) throw new Error("Search input is missing");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "new question");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("Enter");
    expect(create).toHaveBeenCalledExactlyOnceWith("new question", {
      newTab: false,
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("keeps the Search question and opens the setup affordance when Ask admission reports no provider", async () => {
    askState.enabled = true;
    askState.action.mockRejectedValueOnce(
      Object.assign(new Error("Provider unavailable"), {
        errorCode: "ai_provider_unavailable",
      }),
    );
    const legacyCreate = vi.fn();
    await mount([], legacyCreate);
    await type("Which channels grew?");
    await press("Enter");
    expect(askState.action).toHaveBeenCalledExactlyOnceWith(
      "start-analytics-thread",
      expect.objectContaining({
        trigger: {
          kind: "submit",
          prompt: {
            text: "Which channels grew?",
            attachmentIds: [],
            mentions: [],
            sourceIds: [],
            approval: "ask",
          },
        },
      }),
    );
    expect(host.querySelector("input")?.value).toBe("Which channels grew?");
    expect(host.querySelector('a[href$="/settings/model"]')).not.toBeNull();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("report A2-SEARCH-STALE-QUERY-ACTIVATION: does not open a previous query's result before the new search finishes", async () => {
    let resolveNext: (results: SearchResult[]) => void = () => undefined;
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <WorkspaceSearch
          open
          filterOptions={{}}
          onClose={() => undefined}
          onNavigate={onNavigate}
          onSearch={({ text }) =>
            text === "old"
              ? Promise.resolve([project("old", "Old project")])
              : new Promise((resolve) => {
                  resolveNext = resolve;
                })
          }
        />,
      );
    });
    await type("old");
    expect(host.textContent).toContain("Old project");
    vi.useFakeTimers();
    const input = host.querySelector("input");
    if (!input) throw new Error("Search input is missing");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "new");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Old project");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(host.textContent).not.toContain("Old project");
    await act(async () => {
      resolveNext([project("new", "New project")]);
    });
    vi.useRealTimers();
    await press("Enter");
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/project/new/latest");
  });

  it("hides previous results when a filter changes until its search finishes", async () => {
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <WorkspaceSearch
          open
          filterOptions={{}}
          onClose={() => undefined}
          onNavigate={onNavigate}
          onSearch={({ includeArchived }) =>
            includeArchived
              ? new Promise(() => undefined)
              : Promise.resolve([project("old", "Old project")])
          }
        />,
      );
    });
    await type("old");
    expect(host.textContent).toContain("Old project");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[role="switch"]')?.click();
    });
    expect(host.textContent).not.toContain("Old project");
    await press("Enter");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("runs the first match on Enter right after typing", async () => {
    await mount([
      project("p1", "Signup funnel"),
      project("p2", "Signup cohort"),
    ]);
    await type("signup");
    await press("Enter");
    expect(onNavigate).toHaveBeenCalledWith("/project/p1/latest");
  });

  it("keeps a matching project above a thread that matched only its contents", async () => {
    await mount([
      project("p1", "Signup"),
      {
        kind: "thread",
        id: "t1",
        title: "Monthly review",
        href: "/thread/t1",
        updatedAt: "2026-11-18T09:00:00.000Z",
      },
    ]);
    await type("signup");
    const rows = host.querySelectorAll('[role="menuitem"]');
    expect(rows[0]?.textContent).toContain("Signup");
    await press("Enter");
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/project/p1/latest");
  });

  it("highlights text within a word without spacing its fragments apart", async () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = searchStyles;
    document.head.append(stylesheet);
    try {
      await mount([project("p1", "Signup funnel")]);
      await type("sign");
      const mark = host.querySelector("mark");
      expect(mark?.textContent).toBe("Sign");
      const title = mark?.parentElement;
      if (!mark || !title) throw new Error("Missing title highlight");
      expect(title.textContent).toBe("Signup funnel");
      expect(getComputedStyle(title).display).toBe("block");
      expect(Number.parseFloat(getComputedStyle(mark).paddingLeft || "0")).toBe(
        0,
      );
    } finally {
      stylesheet.remove();
    }
  });

  it("re-seats the active row on the first match when the query changes", async () => {
    await mount([
      project("p1", "Signup funnel"),
      project("p2", "Signup cohort"),
    ]);
    await type("sign");
    await press("ArrowDown");
    await type("signup");
    await press("Enter");
    expect(onNavigate).toHaveBeenCalledWith("/project/p1/latest");
  });
});

it("M5-T2-F-26: previews long queries while submitting the full query with Ctrl", async () => {
  const create = vi.fn();
  await mount([], create);
  const query = "x".repeat(101);
  await type(query);
  expect(host.textContent).toContain(`Ask “${"x".repeat(97)}...”`);
  const button = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("Start a new thread"),
  );
  if (!button) throw new Error("Start a new thread control is missing");
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, ctrlKey: true }),
    );
  });
  expect(create).toHaveBeenCalledWith(query, { newTab: true });
});
