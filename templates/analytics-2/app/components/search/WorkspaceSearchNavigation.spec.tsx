// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSearchNavigation } from "./WorkspaceSearchNavigation";

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("WorkspaceSearchNavigation", () => {
  it("opens from /home/search?q=, syncs edits without clobbering, restores history back, and closes cleanly", async () => {
    const onSearch = vi.fn(async ({ text }: { text: string }) =>
      text
        ? [
            {
              kind: "project" as const,
              id: text,
              title: `${text} result`,
              href: `/project/${text}`,
              updatedAt: "2026-11-20T10:00:00.000Z",
            },
          ]
        : [],
    );
    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: (
            <WorkspaceSearchNavigation
              open={false}
              onClose={() => {}}
              onSearch={onSearch}
            />
          ),
        },
      ],
      {
        initialEntries: ["/home/search?q=revenue"],
      },
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    const input = host.querySelector<HTMLInputElement>("input");
    expect(input?.value).toBe("revenue");
    expect(onSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "revenue" }),
      expect.any(Function),
    );
    expect(host.textContent).toContain("revenue result");

    // Rapid typing updates the URL without losing characters.
    await act(async () => {
      if (!input) return;
      setInputValue(input, "c");
      setInputValue(input, "ch");
      setInputValue(input, "churn");
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(input?.value).toBe("churn");
    expect(router.state.location.pathname).toBe("/home/search");
    expect(router.state.location.search).toBe("?q=churn");
    expect(onSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "churn" }),
      expect.any(Function),
    );
    expect(host.textContent).toContain("churn result");

    // External navigation pushes a new query and updates input/results immediately.
    await act(async () => {
      await router.navigate("/home/search?q=margin");
    });
    expect(input?.value).toBe("margin");
    expect(onSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "margin" }),
      expect.any(Function),
    );
    expect(host.textContent).toContain("margin result");

    // History back restores previous query and results immediately (no debounce lag).
    await act(async () => {
      await router.navigate(-1);
    });
    expect(input?.value).toBe("churn");
    expect(onSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "churn" }),
      expect.any(Function),
    );
    expect(host.textContent).toContain("churn result");

    // Enter navigates to the selected project without bouncing back to /home.
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(router.state.location.pathname).toBe("/project/churn");

    // Reopening via URL and pressing Escape closes cleanly to /home.
    await act(async () => {
      await router.navigate("/home/search?q=churn");
    });
    const reopenedInput = host.querySelector<HTMLInputElement>("input");
    expect(reopenedInput?.value).toBe("churn");
    await act(async () => {
      reopenedInput?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(router.state.location.pathname).toBe("/home");
    expect(host.querySelector("input")).toBeNull();

    await act(async () => root.unmount());
    router.dispose();
  });

  it("also opens from /home?search= and shows matching results", async () => {
    const onSearch = vi.fn(async ({ text }: { text: string }) => [
      {
        kind: "project" as const,
        id: "prj_rev",
        title: `${text} overview`,
        href: "/project/prj_rev/latest",
        updatedAt: "2026-11-20T10:00:00.000Z",
      },
    ]);
    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: (
            <WorkspaceSearchNavigation
              open={false}
              onClose={() => {}}
              onSearch={onSearch}
            />
          ),
        },
      ],
      {
        initialEntries: ["/home?search=revenue"],
      },
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    const input = host.querySelector<HTMLInputElement>("input");
    expect(input?.value).toBe("revenue");
    expect(onSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "revenue" }),
      expect.any(Function),
    );
    expect(host.textContent).toContain("revenue overview");

    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(router.state.location.pathname).toBe("/home");
    expect(router.state.location.search).toBe("");
    expect(host.querySelector("input")).toBeNull();

    await act(async () => root.unmount());
    router.dispose();
  });
});
