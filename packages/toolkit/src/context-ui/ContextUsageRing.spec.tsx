// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import {
  ContextUsagePanelView,
  ContextUsageRingView,
  contextRingDashOffset,
  formatContextWindowTokens,
  type ContextCompactState,
} from "./ContextUsageRing.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const segments = [
  { kind: "System", label: "System", tokens: 80_000, colorClass: "bg-a" },
  {
    kind: "Tool results",
    label: "Tool results",
    tokens: 500_000,
    colorClass: "bg-b",
  },
  {
    kind: "Conversation",
    label: "Conversation",
    tokens: 199_800,
    colorClass: "bg-c",
  },
];

function ring(usedTokens: number, open = false) {
  return (
    <ContextUsageRingView
      usedTokens={usedTokens}
      windowTokens={1_000_000}
      open={open}
      onOpenChange={() => {}}
    >
      <span data-testid="panel" />
    </ContextUsageRingView>
  );
}

function panel(
  props: Partial<React.ComponentProps<typeof ContextUsagePanelView>> = {},
) {
  return (
    <TooltipProvider>
      <ContextUsagePanelView
        usedTokens={779_800}
        windowTokens={1_000_000}
        segments={segments}
        compact={{ state: "idle" }}
        onCompact={vi.fn()}
        {...props}
      />
    </TooltipProvider>
  );
}

describe("ContextUsageRingView", () => {
  it("names the share used and stays neutral below 80%", () => {
    act(() => root.render(ring(779_800)));
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="context-ring"]',
    )!;
    expect(button.getAttribute("aria-label")).toBe("Context 78% used");
    expect(button.dataset.warning).toBeUndefined();
    expect(button.querySelector("svg")?.getAttribute("class")).toContain(
      "size-5",
    );
  });

  it("turns amber at 80%", () => {
    act(() => root.render(ring(800_000)));
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="context-ring"]',
    )!;
    expect(button.dataset.warning).toBe("true");
    expect(
      button.querySelector("[data-context-ring-fill]")?.getAttribute("class"),
    ).toContain("--agent-kit-warning");
  });

  it("shows at any usage and fills the ring by the true share", () => {
    const fill = () => container.querySelector("[data-context-ring-fill]");
    act(() => root.render(ring(0)));
    expect(
      container.querySelector('[data-agent-composer-slot="context-ring"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-context-ring-track]")).not.toBeNull();
    expect(Number(fill()?.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      contextRingDashOffset(0),
    );
    act(() => root.render(ring(20_000)));
    expect(fill()?.getAttribute("stroke-linecap")).toBe("butt");
    expect(Number(fill()?.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      contextRingDashOffset(0.02),
    );
  });
});

describe("contextRingDashOffset", () => {
  it("leaves the ring empty at zero and full at the window, without padding", () => {
    expect(contextRingDashOffset(0)).toBeCloseTo(2 * Math.PI * 7);
    expect(contextRingDashOffset(-1)).toBeCloseTo(2 * Math.PI * 7);
    expect(contextRingDashOffset(1)).toBe(0);
    expect(contextRingDashOffset(2)).toBe(0);
    expect(contextRingDashOffset(0.02)).toBeCloseTo(2 * Math.PI * 7 * 0.98);
  });
});

describe("ContextUsagePanelView", () => {
  it("states usage against the window and segments the bar by kind", () => {
    act(() => root.render(panel()));
    const view = container.querySelector("[data-context-usage-panel]")!;
    const header = view.firstElementChild!;
    expect(header.children[0]?.textContent).toBe("Context window");
    expect(header.children[0]?.className).toContain("text-muted-foreground");
    expect(header.children[1]?.textContent).toBe("779.8k / 1M (78%)");
    expect(
      Array.from(view.querySelectorAll("[data-context-usage-segment]")).map(
        (segment) => [
          segment.getAttribute("data-context-usage-segment"),
          (segment as HTMLElement).style.width,
        ],
      ),
    ).toEqual([
      ["System", "8%"],
      ["Tool results", "50%"],
      ["Conversation", "19.98%"],
    ]);
    expect(
      view
        .querySelector("[data-context-usage-bar]")
        ?.getAttribute("aria-label"),
    ).toBe("System 80k, Tool results 500k, Conversation 199.8k");
    expect(view.textContent).not.toContain("auto-compact");
    expect(view.textContent).not.toContain("See detailed breakdown");
  });

  it("shows the auto-compact distance only when one is known", () => {
    act(() => root.render(panel({ tokensUntilAutoCompact: 12_400 })));
    expect(container.textContent).toContain("12.4k until auto-compact");
  });

  it("toggles a breakdown that matches the bar's segments and colors", () => {
    act(() => root.render(panel()));
    const view = container.querySelector("[data-context-usage-panel]")!;
    const toggle = view.querySelector<HTMLButtonElement>(
      'button[aria-label="Breakdown"]',
    )!;
    const list = view.querySelector<HTMLElement>(
      "[data-context-usage-breakdown]",
    )!;
    expect(toggle.getAttribute("aria-controls")).toBe(list.id);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(list.hidden).toBe(true);

    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);

    const rows = Array.from(
      list.querySelectorAll<HTMLElement>("[data-context-usage-row]"),
    ).map((row) => ({
      kind: row.dataset.contextUsageRow,
      swatch: row
        .querySelector("[data-context-usage-swatch]")
        ?.className.match(/bg-[\w-]+/)?.[0],
      cells: Array.from(row.querySelectorAll("td"))
        .slice(1)
        .map((cell) => cell.textContent),
    }));
    expect(rows).toEqual([
      { kind: "System", swatch: "bg-a", cells: ["System", "80k", "8.0%"] },
      {
        kind: "Tool results",
        swatch: "bg-b",
        cells: ["Tool results", "500k", "50.0%"],
      },
      {
        kind: "Conversation",
        swatch: "bg-c",
        cells: ["Conversation", "199.8k", "20.0%"],
      },
      {
        kind: "free-space",
        swatch: "bg-muted",
        cells: ["Free space", "220.2k", "22.0%"],
      },
    ]);
    const bar = view.querySelector<HTMLElement>("[data-context-usage-bar]")!;
    expect(bar.className).toContain("bg-muted");
    expect(
      Array.from(bar.children).map(
        (segment) => segment.className.match(/bg-[\w-]+/)?.[0],
      ),
    ).toEqual(rows.slice(0, -1).map((row) => row.swatch));

    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(list.hidden).toBe(true);
  });

  it.each<[ContextCompactState, (view: Element) => void]>([
    [
      { state: "running" },
      (view) => {
        const compact = Array.from(view.querySelectorAll("button")).find(
          (button) => button.textContent?.includes("Compact now"),
        )!;
        expect(compact.disabled).toBe(true);
        expect(compact.getAttribute("aria-busy")).toBe("true");
      },
    ],
    [
      { state: "error", message: "No model credentials" },
      (view) => {
        const alert = view.querySelector('[role="alert"]')!;
        expect(alert.textContent).toBe("No model credentials");
        expect(alert.className).toContain("agent-kit-tone-warning");
        expect(alert.className).not.toContain("destructive");
      },
    ],
    [
      { state: "done", message: "Compacted. Applies from the next message." },
      (view) => {
        expect(view.querySelector('[role="status"]')?.textContent).toBe(
          "Compacted. Applies from the next message.",
        );
      },
    ],
  ])("renders the %o compact state", (compact, check) => {
    act(() => root.render(panel({ compact })));
    check(container.querySelector("[data-context-usage-panel]")!);
  });
});

describe("formatContextWindowTokens", () => {
  it("uses the window's own unit", () => {
    expect(formatContextWindowTokens(1_000_000)).toBe("1M");
    expect(formatContextWindowTokens(1_050_000)).toBe("1.05M");
    expect(formatContextWindowTokens(200_000)).toBe("200k");
    expect(formatContextWindowTokens(779_800)).toBe("779.8k");
  });
});
