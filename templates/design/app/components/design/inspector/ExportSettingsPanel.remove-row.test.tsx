// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { ExportSettingsPanel } from "./ExportSettingsPanel";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const REMOVE = '[aria-label="Remove export"]';
const ADD = '[aria-label="Add export"]';

describe("ExportSettingsPanel remove-row affordance", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** Mounted under a TooltipProvider because that is how EditPanel mounts it —
   *  the inspector components rely on the panel-level provider. */
  async function render(props?: { exporting?: boolean }) {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <ExportSettingsPanel
            value={{ scale: 1, format: "png", suffix: "" }}
            onChange={vi.fn()}
            onExport={vi.fn()}
            exporting={props?.exporting}
          />
        </TooltipProvider>,
      );
    });
  }

  it("renders no remove control while a single export row is the only row", () => {
    // A permanently disabled × is unexplainable: `disabled` suppresses pointer
    // events, so it cannot carry a tooltip either.
    return render().then(() => {
      expect(container.querySelector(REMOVE)).toBeNull();
    });
  });

  it("reveals a remove control for every row once a second export exists", async () => {
    await render();
    const add = container.querySelector<HTMLButtonElement>(ADD);
    expect(add).not.toBeNull();
    await act(async () => add!.click());
    expect(container.querySelectorAll(REMOVE)).toHaveLength(2);
  });

  it("keeps the remove control hoverable while an export run is in flight", async () => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>(ADD)!.click(),
    );
    await render({ exporting: true });
    const remove = container.querySelector<HTMLButtonElement>(REMOVE);
    expect(remove).not.toBeNull();
    expect(remove!.disabled).toBe(true);
    // The wrapper, not the disabled button, receives the hover that opens the
    // tooltip — a bare disabled trigger would silently have none.
    const wrapper = remove!.parentElement;
    expect(wrapper?.tagName).toBe("SPAN");
    expect(wrapper?.className).not.toContain("pointer-events-none");
  });

  it("drops back to no remove control when the extra row is removed", async () => {
    await render();
    await act(async () =>
      container.querySelector<HTMLButtonElement>(ADD)!.click(),
    );
    expect(container.querySelectorAll(REMOVE)).toHaveLength(2);
    await act(async () =>
      container.querySelector<HTMLButtonElement>(REMOVE)!.click(),
    );
    expect(container.querySelector(REMOVE)).toBeNull();
  });
});
