// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { VocabularyManager } from "./vocabulary-section";

const mockVocabulary = vi.hoisted(() => ({
  entries: [
    {
      id: "entry-1",
      term: "Agent-Native",
      replacement: "Agent-Native",
      confidence: 1,
      usesCount: 1,
    },
  ],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useActionQuery: () => ({
    data: { vocabulary: mockVocabulary.entries },
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("VocabularyManager behavior", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockVocabulary.entries = [
      {
        id: "entry-1",
        term: "Agent-Native",
        replacement: "Agent-Native",
        confidence: 1,
        usesCount: 1,
      },
    ];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient();
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    document.body.querySelectorAll('[role="dialog"]').forEach((dialog) => {
      dialog.remove();
    });
  });

  function render(disabled: boolean) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <VocabularyManager disabled={disabled} />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
  }

  it("can scroll the complete dictionary list to its last entry", async () => {
    const entries = Array.from({ length: 32 }, (_, index) => ({
      id: `entry-${index + 1}`,
      term: `Fixture term ${index + 1}`,
      replacement: `Fixture term ${index + 1}`,
      confidence: 1,
      usesCount: index + 1,
    }));
    mockVocabulary.entries = entries;
    render(false);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="dictateRoute.dictionaryTitle"]',
        )
        ?.click();
      await Promise.resolve();
    });

    const scrollRegion = document.body.querySelector<HTMLElement>(
      '[role="dialog"] .overflow-y-auto',
    );
    const entryList = document.body.querySelector<HTMLElement>(
      '[role="dialog"] [data-slot="item-group"]',
    );
    const rows = entryList?.querySelectorAll<HTMLElement>('[data-slot="item"]');
    const lastRow = rows?.item(rows.length - 1);
    const lastEntry = Array.from(
      entryList?.querySelectorAll<HTMLElement>(".truncate") ?? [],
    ).find((element) => element.textContent === "Fixture term 32");

    expect(scrollRegion).not.toBeNull();
    expect(entryList?.classList.contains("shrink-0")).toBe(true);
    expect(rows).toHaveLength(entries.length);
    expect(lastEntry?.textContent).toBe("Fixture term 32");
    expect(scrollRegion?.contains(lastEntry ?? null)).toBe(true);

    const rowHeight = 56;
    const scrollHeight = entries.length * rowHeight;
    const clientHeight = 224;
    Object.defineProperty(scrollRegion, "scrollHeight", {
      configurable: true,
      value: scrollHeight,
    });
    Object.defineProperty(scrollRegion, "clientHeight", {
      configurable: true,
      value: clientHeight,
    });
    Object.defineProperty(lastRow, "offsetTop", {
      configurable: true,
      value: scrollHeight - rowHeight,
    });
    Object.defineProperty(lastRow, "offsetHeight", {
      configurable: true,
      value: rowHeight,
    });

    scrollRegion!.scrollTop = scrollHeight - clientHeight;

    expect(scrollRegion!.scrollTop + scrollRegion!.clientHeight).toBe(
      scrollRegion!.scrollHeight,
    );
    expect(lastRow!.offsetTop + lastRow!.offsetHeight).toBeLessThanOrEqual(
      scrollRegion!.scrollTop + scrollRegion!.clientHeight,
    );
  });

  it("closes an open dictionary and disables its trigger during capture", async () => {
    render(false);

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="dictateRoute.dictionaryTitle"]',
    );
    expect(trigger?.disabled).toBe(false);

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    const scrollRegion = document.body.querySelector<HTMLElement>(
      '[role="dialog"] .overflow-y-auto',
    );
    const entryList = document.body.querySelector<HTMLElement>(
      '[role="dialog"] [data-slot="item-group"]',
    );
    expect(scrollRegion).not.toBeNull();
    expect(entryList?.classList.contains("shrink-0")).toBe(true);

    render(true);
    await act(async () => Promise.resolve());

    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="dictateRoute.dictionaryTitle"]',
      )?.disabled,
    ).toBe(true);
    expect(
      document.body.querySelector('[role="dialog"][data-state="open"]'),
    ).toBeNull();
  });
});
