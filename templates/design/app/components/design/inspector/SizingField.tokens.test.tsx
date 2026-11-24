// @vitest-environment happy-dom

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

const TOKEN_QUERY = vi.hoisted(() => ({
  isError: true,
  data: undefined as unknown,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => TOKEN_QUERY,
}));

import { DesignColorTokensProvider } from "../edit-panel/design-color-tokens";
import { SizingField } from "./AutoLayoutMatrix";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SizingField token menu", () => {
  it("says the tokens failed to load instead of listing only sizing modes", async () => {
    act(() =>
      root.render(
        <DesignColorTokensProvider designId="design-1">
          <SizingField
            axis="W"
            sizingAxis="horizontal"
            value="fixed"
            resolvedSize={120}
            disabled={false}
            onChange={vi.fn()}
            onSizeChange={vi.fn()}
            tokenBinding={{
              accepts: ["container", "spacing"],
              authored: undefined,
              onBind: vi.fn(),
              onDetach: vi.fn(),
            }}
          />
        </DesignColorTokensProvider>,
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="W sizing mode"]',
    );
    if (!trigger) throw new Error("missing sizing trigger");
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });

    expect(document.body.textContent).toContain(
      "editPanel.colorPicker.tokensFailed",
    );
  });
});
