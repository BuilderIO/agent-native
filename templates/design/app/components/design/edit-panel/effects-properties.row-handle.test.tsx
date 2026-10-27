// @vitest-environment happy-dom

/**
 * An effect row's reorder handle sits in its own leading cell, outside the
 * field pill, like a fill row's: the pill starts at the same edge as every
 * other inspector control and the handle takes the section gutter.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: unknown }) => children as never,
  TooltipTrigger: ({ children }: { children?: unknown }) => children as never,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children?: unknown }) => children as never,
}));

vi.mock("./field-primitives", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./field-primitives")>();
  return {
    ...actual,
    FieldTrailer: () => null,
  };
});

import type { ElementInfo } from "../types";
import { EffectsProperties } from "./effects-properties";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function shadowElement(boxShadow: string): ElementInfo {
  return {
    tagName: "div",
    classes: [],
    computedStyles: { boxShadow },
    boundingRect: { x: 0, y: 0, width: 0, height: 0 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
  } as ElementInfo;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("EffectsProperties shadow row", () => {
  it("keeps the reorder handle in its own cell, outside the field pill", () => {
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <EffectsProperties
            element={shadowElement(
              "0px 4px 8px 0px rgba(0, 0, 0, 0.25), 0px 1px 2px 0px rgba(0, 0, 0, 0.5)",
            )}
            onStyleChange={vi.fn()}
          />
        </QueryClientProvider>,
      ),
    );

    const rows = container.querySelectorAll<HTMLElement>(
      '[data-inspector-layout="drag-paint-row"]',
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const handle = row.querySelector<HTMLElement>(
        '[aria-label="editPanel.labels.reorderLayer"]',
      );
      const field = row.querySelector<HTMLButtonElement>("button");
      expect(handle).not.toBeNull();
      expect(field).not.toBeNull();
      expect(field!.contains(handle)).toBe(false);
      expect(handle!.closest("button")).toBeNull();
      expect(row.children[0]!.contains(handle)).toBe(true);
      expect(row.children[1]!.contains(field)).toBe(true);
    }
  });
});
