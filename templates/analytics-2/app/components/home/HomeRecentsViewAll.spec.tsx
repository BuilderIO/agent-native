// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import { HomeRecentsSection } from "./recents";
import type { HomeRecents, HomeRecentsTab } from "./types";

/**
 * The Home sections carried the same dead control the Popular section did: a
 * "View all" button rendered `disabled` when the caller had no destination.
 */
describe("home recents section headings", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  const tab = (
    kind: HomeRecentsTab["kind"],
    viewAllHref?: string,
  ): HomeRecentsTab => ({
    kind,
    enabled: true,
    status: "ready",
    // One row, so the section renders its heading (and with it View all) rather
    // than the empty state.
    rows: [
      {
        id: `${kind}-1`,
        kind,
        title: "Revenue overview",
        href: `/recent/${kind}`,
      },
    ],
    ...(viewAllHref === undefined ? {} : { viewAllHref }),
  });

  const recents = (viewAllHref?: string): HomeRecents => ({
    projects: tab("project", viewAllHref),
    threads: tab("thread", viewAllHref),
    explorations: tab("exploration", viewAllHref),
    data: tab("data", viewAllHref),
  });

  const render = (viewAllHref?: string) =>
    act(() => {
      root.render(
        <MemoryRouter>
          <HomeRecentsSection
            recents={recents(viewAllHref)}
            callbacks={{} as never}
          />
        </MemoryRouter>,
      );
    });

  const viewAllControls = () =>
    [...host.querySelectorAll("button, a")].filter((node) =>
      /View all/i.test(node.textContent ?? ""),
    );

  it("renders no View all control without a destination", () => {
    render(undefined);
    expect(viewAllControls()).toEqual([]);
  });

  it("renders a link when the caller supplies one", () => {
    render("/home/all");
    expect(
      viewAllControls().filter((node) => node.tagName === "A").length,
    ).toBeGreaterThan(0);
  });

  it.each(["populated", "empty"])(
    "starts a new thread from the %s Threads tab",
    async (state) => {
      const onCreateThread = vi.fn();
      const tabs = recents();
      if (state === "empty") tabs.threads = { ...tabs.threads, rows: [] };
      await act(async () => {
        root.render(
          <MemoryRouter>
            <AgentNativeI18nProvider
              catalog={i18nCatalog}
              persistPreference={false}
            >
              <HomeRecentsSection
                recents={tabs}
                callbacks={{
                  onBrowseProjects: vi.fn(),
                  onOpenContextStudio: vi.fn(),
                  onCreateThread,
                }}
              />
            </AgentNativeI18nProvider>
          </MemoryRouter>,
        );
      });

      const newThreadButtons = () =>
        [...host.querySelectorAll("button")].filter(
          (button) => button.textContent === "New thread",
        );
      expect(newThreadButtons()).toHaveLength(0);
      const threadsTab = [
        ...host.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      ].find((tab) => tab.textContent === "Threads");
      expect(threadsTab).toBeDefined();
      act(() => threadsTab?.click());

      expect(newThreadButtons()).toHaveLength(1);
      act(() => newThreadButtons()[0]?.click());
      expect(onCreateThread).toHaveBeenCalledOnce();
    },
  );
});
