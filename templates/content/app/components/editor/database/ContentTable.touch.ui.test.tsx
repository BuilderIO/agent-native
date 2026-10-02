// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useContentTableLongPress,
  useContentTableSelectionGutter,
} from "./ContentTable";
import { DatabaseTableGrid, DatabaseTableLayout } from "./DatabaseTableGrid";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubHover(canHover: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(any-hover: none)" ? !canHover : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function GutterHarness({ selecting }: { selecting: boolean }) {
  const { gutterWidth, containerProps } =
    useContentTableSelectionGutter(selecting);
  return (
    <div data-gutter-width={gutterWidth} {...containerProps}>
      <div data-table-selection-gutter="">
        <button type="button">Select row</button>
      </div>
      <button type="button">Open row</button>
    </div>
  );
}

function gutterWidth() {
  return host
    .querySelector("[data-gutter-width]")
    ?.getAttribute("data-gutter-width");
}

describe("selection gutter on touch-only devices", () => {
  it("keeps the gutter wherever a pointer can hover a row's checkbox into view", async () => {
    stubHover(true);
    await act(async () => root.render(<GutterHarness selecting={false} />));
    expect(gutterWidth()).toBe("56");
  });

  it("gives the gutter's width to content until rows are selected", async () => {
    stubHover(false);
    await act(async () => root.render(<GutterHarness selecting={false} />));
    expect(gutterWidth()).toBe("0");

    await act(async () => root.render(<GutterHarness selecting />));
    expect(gutterWidth()).toBe("56");
  });

  it("reveals the gutter while keyboard focus is inside it", async () => {
    stubHover(false);
    await act(async () => root.render(<GutterHarness selecting={false} />));
    const [select, open] = host.querySelectorAll("button");

    await act(async () => select.focus());
    expect(gutterWidth()).toBe("56");

    await act(async () => open.focus());
    expect(gutterWidth()).toBe("56");

    await act(async () => open.blur());
    expect(gutterWidth()).toBe("0");
  });

  it("collapses the grid track, border, and sticky offsets with the gutter", async () => {
    await act(async () =>
      root.render(
        <DatabaseTableLayout.Provider
          value={{
            frozenThroughColumnId: "name",
            viewportWidth: 900,
            gutterWidth: 0,
          }}
        >
          <DatabaseTableGrid
            className="grid"
            propertyIds={["status"]}
            widths={{ name: 240, status: 96 }}
            nameCell={<span>Name</span>}
            propertyCells={[<span key="status">Status</span>]}
          />
        </DatabaseTableLayout.Provider>,
      ),
    );

    const row = host.firstElementChild as HTMLElement;
    expect(row.style.gridTemplateColumns).toBe("0px 240px 96px");
    const gutter = host.querySelector<HTMLElement>(
      "[data-table-selection-gutter]",
    );
    expect(gutter?.className).toContain("overflow-hidden");
    expect(gutter?.className).toContain("border-r-0");
    const name = host.querySelector<HTMLElement>('[data-table-column="name"]');
    expect(name?.hasAttribute("data-table-frozen")).toBe(true);
    expect(name?.style.insetInlineStart).toMatch(/^0(px)?$/);
  });

  it("lets an explicit gutter width win over the table's layout context", async () => {
    await act(async () =>
      root.render(
        <DatabaseTableLayout.Provider
          value={{
            frozenThroughColumnId: undefined,
            viewportWidth: 900,
            gutterWidth: 0,
          }}
        >
          <DatabaseTableGrid
            className="grid"
            gutterWidth={44}
            propertyIds={[]}
            widths={{ name: 240 }}
            nameCell={<span>Name</span>}
            propertyCells={[]}
          />
        </DatabaseTableLayout.Provider>,
      ),
    );

    expect(
      (host.firstElementChild as HTMLElement).style.gridTemplateColumns,
    ).toBe("44px 240px");
  });
});

describe("touch long-press", () => {
  function LongPressHarness({
    onLongPress,
    onOpen,
  }: {
    onLongPress: () => void;
    onOpen: () => void;
  }) {
    const longPress = useContentTableLongPress(onLongPress);
    return (
      <div data-row="" {...longPress}>
        <button type="button" onClick={onOpen}>
          Open row
        </button>
      </div>
    );
  }

  function pointer(
    type: string,
    pointerType: string,
    x = 10,
    y = 10,
  ): PointerEvent {
    return new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType,
      isPrimary: true,
      clientX: x,
      clientY: y,
    });
  }

  async function renderHarness() {
    const onLongPress = vi.fn();
    const onOpen = vi.fn();
    await act(async () =>
      root.render(
        <LongPressHarness onLongPress={onLongPress} onOpen={onOpen} />,
      ),
    );
    const button = host.querySelector("button")!;
    return { onLongPress, onOpen, button };
  }

  it("selects after a held touch and swallows the click that ends it", async () => {
    vi.useFakeTimers();
    const { onLongPress, onOpen, button } = await renderHarness();

    await act(async () => {
      button.dispatchEvent(pointer("pointerdown", "touch"));
      vi.advanceTimersByTime(500);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);

    await act(async () => {
      button.dispatchEvent(pointer("pointerup", "touch"));
      button.click();
    });
    expect(onOpen).not.toHaveBeenCalled();

    await act(async () => button.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("ignores mouse presses, short taps, and presses that turn into a scroll", async () => {
    vi.useFakeTimers();
    const { onLongPress, onOpen, button } = await renderHarness();

    await act(async () => {
      button.dispatchEvent(pointer("pointerdown", "mouse"));
      vi.advanceTimersByTime(800);
    });
    await act(async () => {
      button.dispatchEvent(pointer("pointerdown", "touch"));
      vi.advanceTimersByTime(200);
      button.dispatchEvent(pointer("pointerup", "touch"));
      vi.advanceTimersByTime(800);
    });
    await act(async () => {
      button.dispatchEvent(pointer("pointerdown", "touch"));
      button.dispatchEvent(pointer("pointermove", "touch", 40, 10));
      vi.advanceTimersByTime(800);
    });
    expect(onLongPress).not.toHaveBeenCalled();

    await act(async () => button.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
