// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DesignToolbarTool,
  type DesignToolbarOption,
} from "./toolbar-controls";

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => children,
  TooltipContent: ({ children }: { children?: ReactNode }) => (
    <span data-tooltip>{children}</span>
  ),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

const option = (
  key: string,
  extra: Partial<DesignToolbarOption> = {},
): DesignToolbarOption => ({
  key,
  label: key,
  icon: null,
  onSelect: vi.fn(),
  ...extra,
});

async function renderTool(
  props: Partial<Parameters<typeof DesignToolbarTool>[0]> = {},
) {
  await act(async () =>
    root.render(
      <DesignToolbarTool
        groupId="frame"
        active={false}
        label="Rectangle"
        icon={null}
        optionsLabel="Frame options"
        options={[option("frame"), option("rect")]}
        onPrimary={vi.fn()}
        {...props}
      />,
    ),
  );
}

async function openMenu() {
  const chevron = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Frame options"]',
  )!;
  await act(async () => {
    chevron.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

describe("DesignToolbarTool", () => {
  it("is a 32px tool and a 16px chevron on a 1px seam", async () => {
    await renderTool();

    const group = container.querySelector<HTMLElement>(
      '[data-design-toolbar-group="frame"]',
    )!;
    expect(group.className).toContain("gap-px");
    const [tool, chevron] = Array.from(group.querySelectorAll("button"));
    expect(tool!.className).toContain("size-8");
    expect(chevron!.className).toContain("w-4");
    expect(chevron!.className).toContain("h-8");
  });

  it("names the tool by the armed variant and the chevron by the group", async () => {
    await renderTool({ active: true });

    const tool = container.querySelector('button[aria-label="Rectangle"]');
    expect(tool?.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector('button[aria-label="Frame options"]'),
    ).not.toBeNull();
    // The accent fills the armed tool and nothing else.
    expect(tool?.className).toContain("bg-[var(--design-editor-accent-color)]");
    expect(
      container.querySelector('button[aria-label="Frame options"]')?.className,
    ).not.toContain("--design-editor-accent-color");
  });

  it("leaves the armed tool unfilled while it is not armed", async () => {
    await renderTool({ active: false });

    const tool = container.querySelector('button[aria-label="Rectangle"]');
    expect(tool?.getAttribute("aria-pressed")).toBe("false");
    expect(tool?.className).not.toContain(
      "bg-[var(--design-editor-accent-color)]",
    );
  });

  it("drops the chevron for a group with a single item", async () => {
    await renderTool({ options: [option("pen")], optionsLabel: "Pen options" });

    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(
      container.querySelector('button[aria-label="Pen options"]'),
    ).toBeNull();
  });

  it("runs the primary action from the tool, not the chevron", async () => {
    const onPrimary = vi.fn();
    await renderTool({ onPrimary });

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Rectangle"]')
        ?.click(),
    );
    expect(onPrimary).toHaveBeenCalledOnce();
  });

  it("shows the primary shortcut in the tooltip beside the label", async () => {
    await renderTool({ primaryShortcut: "R" });

    expect(container.querySelector("[data-tooltip]")?.textContent).toBe(
      "RectangleR",
    );
  });

  it("opens a menu that lists the items, draws a divider where asked, and dims without disabling", async () => {
    const onSelect = vi.fn();
    await renderTool({
      options: [
        option("frame", { shortcut: "F" }),
        option("image-video", { dimmed: true, onSelect }),
        option("rect", { separatorBefore: true }),
      ],
    });

    await openMenu();

    const items = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    expect(items.map((item) => item.dataset.option)).toEqual([
      "frame",
      "image-video",
      "rect",
    ]);
    expect(document.body.querySelectorAll('[role="separator"]')).toHaveLength(
      1,
    );
    const dimmed = items[1]!;
    expect(dimmed.getAttribute("aria-disabled")).toBe("true");
    expect(dimmed.hasAttribute("data-disabled")).toBe(false);
    expect(dimmed.className).toContain("opacity-50");
    expect(items[0]!.textContent).toContain("F");
    await act(async () => dimmed.click());
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
