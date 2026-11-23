// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { WORKSPACE_SEARCH_TEXT_MAX_LENGTH } from "../../../shared/search-limits";
import type { SearchQuery } from "./types";
import { WorkspaceSearch } from "./WorkspaceSearch";

vi.mock("@agent-native/core/client/i18n", () => ({
  useOptionalLocale: () => undefined,
  useT: () => (key: string) => key,
}));

async function mount(onClose = () => {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSearch = vi.fn(async (_query: SearchQuery) => []);
  await act(async () =>
    root.render(
      <WorkspaceSearch
        open
        onClose={onClose}
        onNavigate={() => {}}
        onSearch={onSearch}
      />,
    ),
  );
  const cleanup = () => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  };
  return { host, onSearch, cleanup };
}

it("sends the action only as many characters as it accepts when the query is longer", async () => {
  const { host, onSearch, cleanup } = await mount();
  try {
    const input = host.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("Missing search input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "a".repeat(WORKSPACE_SEARCH_TEXT_MAX_LENGTH + 100));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(250);
    });
    const lengths = onSearch.mock.calls.map(([query]) => query.text.length);
    expect(Math.max(...lengths)).toBe(WORKSPACE_SEARCH_TEXT_MAX_LENGTH);
  } finally {
    cleanup();
  }
});

it("closes on Escape when focus has fallen to the page body", async () => {
  const onClose = vi.fn();
  const { cleanup } = await mount(onClose);
  try {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
  }
});

it("closes only the open filter picker on the first Escape, then the dialog on the second", async () => {
  const onClose = vi.fn();
  const { host, cleanup } = await mount(onClose);
  try {
    const dateButton = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.trim().startsWith("Date"),
    );
    if (!dateButton) throw new Error("Missing Date filter");
    await act(async () => dateButton.click());
    expect(host.querySelector(".ws-calendar")).not.toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    const escape = () =>
      act(async () => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
    await escape();
    expect(host.querySelector(".ws-calendar")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    cleanup();
  }
});
