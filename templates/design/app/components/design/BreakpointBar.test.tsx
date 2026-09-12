// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  act,
  createElement,
  type ComponentType,
  type ReactNode,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  availableBreakpointPresets,
  breakpointLabelForWidth,
  BreakpointDeviceControl,
  type BreakpointDeviceControlProps,
  extraBreakpointWidthPresets,
  FRAMER_BREAKPOINT_PRESETS,
  parseBreakpointWidthInput,
} from "./BreakpointBar";

vi.mock("@agent-native/core/client/i18n", () => ({
  AgentNativeI18nProvider: ({ children }: { children: ReactNode }) => children,
  useT: () => (key: string) => key.replace("designEditor.breakpointBar.", ""),
}));

// Minimal catalog covering only the keys BreakpointDeviceControl reads — see
// the same convention/rationale note in
// inspector/BreakpointOverrideIndicator.test.tsx. Full catalog coverage
// across all 11 locales is verified by `guard:i18n-catalogs`, not here.
const CATALOG_MESSAGES = {
  designEditor: {
    breakpointBar: {
      base: "Base",
      editBaseWidth: "Edit base width",
      addBreakpoint: "Add breakpoint",
      remove: "Remove breakpoint",
      options: "Breakpoint options",
      changeWidth: "Change width",
      customWidth: "Custom width",
      add: "Add",
      showAllBreakpoints: "Show all breakpoints",
      desktop: "Desktop",
      tablet: "Tablet",
      phone: "Phone",
    },
  },
};

function renderWithProviders<P extends object>(
  Component: ComponentType<P>,
  props: P,
): string {
  return renderToStaticMarkup(
    <AgentNativeI18nProvider catalog={{ messages: CATALOG_MESSAGES }}>
      {createElement(Component, props)}
    </AgentNativeI18nProvider>,
  );
}

function renderControl(
  props: Partial<BreakpointDeviceControlProps> = {},
): string {
  return renderWithProviders(BreakpointDeviceControl, {
    breakpoints: [],
    canEdit: true,
    onSelect: vi.fn(),
    ...props,
  } as BreakpointDeviceControlProps);
}

function InteractiveControl({
  onAdd,
  onChangeWidth,
  initialBreakpoints = [{ id: "bp-810", label: "Tablet", widthPx: 810 }],
}: {
  onAdd: (widthPx: number, label: string) => void;
  onChangeWidth: (id: string, widthPx: number) => void;
  initialBreakpoints?: Array<{ id: string; label: string; widthPx: number }>;
}) {
  const [breakpoints, setBreakpoints] = useState(initialBreakpoints);
  return (
    <AgentNativeI18nProvider catalog={{ messages: CATALOG_MESSAGES }}>
      <BreakpointDeviceControl
        breakpoints={breakpoints}
        activeWidthPx={810}
        canEdit
        onSelect={() => {}}
        onAdd={(widthPx, label) => {
          onAdd(widthPx, label);
          setBreakpoints((current) => [
            ...current,
            { id: `bp-${widthPx}`, label, widthPx },
          ]);
        }}
        onChangeWidth={(id, widthPx) => {
          onChangeWidth(id, widthPx);
          setBreakpoints((current) =>
            current.map((breakpoint) =>
              breakpoint.id === id ? { ...breakpoint, widthPx } : breakpoint,
            ),
          );
        }}
      />
    </AgentNativeI18nProvider>
  );
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  Object.getOwnPropertyDescriptor(input, "_valueTracker")?.value?.setValue("");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function pointerClick(target: HTMLElement) {
  target.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  target.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, button: 0 }),
  );
  target.click();
}

describe("BreakpointDeviceControl interactions", () => {
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
  });

  it("applies a changed width when Enter is pressed in the options menu", async () => {
    const onAdd = vi.fn();
    const onChangeWidth = vi.fn();
    await act(async () =>
      root.render(
        <InteractiveControl onAdd={onAdd} onChangeWidth={onChangeWidth} />,
      ),
    );
    await act(async () => {
      pointerClick(
        container.querySelector<HTMLButtonElement>('[aria-label="options"]')!,
      );
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="changeWidth"]',
    )!;
    await act(async () => {
      setInputValue(input, "768");
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onChangeWidth).toHaveBeenCalledWith("bp-810", 768);
    expect(container.textContent).toContain("768");
  });

  it("reopens after adding Tablet so another custom breakpoint can be added", async () => {
    const onAdd = vi.fn();
    const onChangeWidth = vi.fn();
    await act(async () =>
      root.render(
        <InteractiveControl
          initialBreakpoints={[]}
          onAdd={onAdd}
          onChangeWidth={onChangeWidth}
        />,
      ),
    );

    await act(async () => {
      pointerClick(
        container.querySelector<HTMLButtonElement>(
          'button[title="addBreakpoint"]',
        )!,
      );
    });
    const tabletPreset = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("tablet"));
    expect(tabletPreset).toBeDefined();
    await act(async () => tabletPreset!.click());

    await act(async () => {
      pointerClick(
        container.querySelector<HTMLButtonElement>(
          'button[title="addBreakpoint"]',
        )!,
      );
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="customWidth"]',
    )!;
    await act(async () => {
      setInputValue(input, "700");
      document
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click();
    });

    expect(onAdd.mock.calls).toEqual([
      [810, "tablet"],
      [700, "Tablet"],
    ]);
    expect(container.textContent).toContain("700");
  });
});

describe("BreakpointDeviceControl — item 8a device icons", () => {
  it("renders a phone icon + width number for a narrow breakpoint segment", () => {
    const markup = renderControl({
      breakpoints: [{ id: "bp-1", label: "Phone", widthPx: 390 }],
    });
    expect(markup).toContain("tabler-icon-device-mobile");
    expect(markup).not.toContain("tabler-icon-device-tablet");
    expect(markup).not.toContain("tabler-icon-device-desktop");
    expect(markup).toContain(">390<");
  });

  it("renders a tablet icon + width number for a mid-width breakpoint segment", () => {
    const markup = renderControl({
      breakpoints: [{ id: "bp-1", label: "Tablet", widthPx: 810 }],
    });
    expect(markup).toContain("tabler-icon-device-tablet");
    expect(markup).not.toContain("tabler-icon-device-mobile");
    expect(markup).toContain(">810<");
  });

  it("renders a desktop icon + width number for a wide breakpoint segment", () => {
    const markup = renderControl({
      breakpoints: [{ id: "bp-1", label: "Desktop", widthPx: 1200 }],
    });
    expect(markup).toContain("tabler-icon-device-desktop");
    expect(markup).toContain(">1200<");
  });

  it("renders one icon per segment, ordered widest first, plus the icon-only Base segment", () => {
    const markup = renderControl({
      breakpoints: [
        { id: "bp-390", label: "Phone", widthPx: 390 },
        { id: "bp-810", label: "Tablet", widthPx: 810 },
      ],
    });
    // Base segment uses IconViewportWide (icon-only, no width shown for it).
    expect(markup).toContain("tabler-icon-viewport-wide");
    const tabletIndex = markup.indexOf("tabler-icon-device-tablet");
    const mobileIndex = markup.indexOf("tabler-icon-device-mobile");
    expect(tabletIndex).toBeGreaterThan(-1);
    expect(mobileIndex).toBeGreaterThan(-1);
    // Widest-first ordering: the 810 (tablet) segment's icon appears before
    // the 390 (mobile) segment's icon in source order.
    expect(tabletIndex).toBeLessThan(mobileIndex);
  });

  it("boundary: exactly 1024px renders as desktop, exactly 600px renders as tablet", () => {
    const desktopBoundary = renderControl({
      breakpoints: [{ id: "bp-1", label: "Desktop", widthPx: 1024 }],
    });
    expect(desktopBoundary).toContain("tabler-icon-device-desktop");

    const tabletBoundary = renderControl({
      breakpoints: [{ id: "bp-1", label: "Tablet", widthPx: 600 }],
    });
    expect(tabletBoundary).toContain("tabler-icon-device-tablet");
  });
});

describe("BreakpointDeviceControl — Base segment and selection state", () => {
  it("marks Base as pressed when activeWidthPx is undefined", () => {
    const markup = renderControl({ activeWidthPx: undefined });
    expect(markup).toContain('aria-pressed="true"');
  });

  it("marks the matching breakpoint segment as pressed when active", () => {
    const markup = renderControl({
      breakpoints: [{ id: "bp-1", label: "Tablet", widthPx: 810 }],
      activeWidthPx: 810,
    });
    // Two aria-pressed="true": none expected on Base (false) and one on the
    // active breakpoint segment.
    const trueCount = (markup.match(/aria-pressed="true"/g) ?? []).length;
    expect(trueCount).toBe(1);
  });
});

describe("parseBreakpointWidthInput", () => {
  it("accepts a valid width in range", () => {
    expect(parseBreakpointWidthInput("500", [])).toBe(500);
  });

  it("rejects non-numeric input", () => {
    expect(parseBreakpointWidthInput("abc", [])).toBeNull();
  });

  it("rejects widths below 320 or above 3840", () => {
    expect(parseBreakpointWidthInput("319", [])).toBeNull();
    expect(parseBreakpointWidthInput("3841", [])).toBeNull();
  });

  it("rejects a width already taken by another breakpoint", () => {
    expect(parseBreakpointWidthInput("810", [810])).toBeNull();
  });
});

describe("breakpointLabelForWidth / availableBreakpointPresets", () => {
  it("labels widths by the same buckets as the device icon", () => {
    expect(breakpointLabelForWidth(1200)).toBe("Desktop");
    expect(breakpointLabelForWidth(810)).toBe("Tablet");
    expect(breakpointLabelForWidth(390)).toBe("Phone");
  });

  it("excludes presets already present by exact width", () => {
    const remaining = availableBreakpointPresets([810]);
    expect(remaining.map((p) => p.widthPx)).not.toContain(810);
    expect(remaining.length).toBe(FRAMER_BREAKPOINT_PRESETS.length - 1);
  });
});

describe("extraBreakpointWidthPresets", () => {
  const allFramerWidths = FRAMER_BREAKPOINT_PRESETS.map((p) => p.widthPx);

  it("still offers device widths once every Framer default is used", () => {
    // The reported gap: with Desktop/Tablet/Phone added, the "+" popover fell
    // back to a bare number input because the only preset source was empty.
    expect(availableBreakpointPresets(allFramerWidths)).toHaveLength(0);
    expect(extraBreakpointWidthPresets(allFramerWidths).length).toBeGreaterThan(
      0,
    );
  });

  it("never repeats a width already in the breakpoint set", () => {
    const existing = [402, 810];
    const widths = extraBreakpointWidthPresets(existing).map((p) => p.widthPx);
    expect(widths).not.toContain(402);
    expect(widths).not.toContain(810);
  });

  it("never duplicates the Framer defaults it sits beside", () => {
    const widths = extraBreakpointWidthPresets([]).map((p) => p.widthPx);
    allFramerWidths.forEach((width) => expect(widths).not.toContain(width));
  });

  it("returns one entry per distinct width, widest first", () => {
    const presets = extraBreakpointWidthPresets([]);
    const widths = presets.map((p) => p.widthPx);
    expect(new Set(widths).size).toBe(widths.length);
    expect([...widths].sort((a, b) => b - a)).toEqual(widths);
  });

  it("only offers widths the width validator would accept", () => {
    for (const preset of extraBreakpointWidthPresets([])) {
      expect(parseBreakpointWidthInput(String(preset.widthPx), [])).toBe(
        preset.widthPx,
      );
    }
  });
});
