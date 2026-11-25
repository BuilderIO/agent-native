// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { EditPanel } from "./EditPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("./inspector/NativeShaderCatalogPreview", () => ({
  NativeShaderCatalogPreview: () => null,
  NativeShaderCatalogPreviewProvider: ({ children }: { children: ReactNode }) =>
    children,
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

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

it("preserves the requested inspector width while limiting it to the parent", () => {
  for (const width of [280, 400]) {
    act(() =>
      root.render(
        <EditPanel
          selectedElement={null}
          viewMode="overview"
          mode="edit"
          onStyleChange={vi.fn()}
          width={width}
        />,
      ),
    );

    const inspector = container.querySelector<HTMLElement>(".design-sidebar");
    if (!inspector) throw new Error("Inspector was not rendered");
    const style = getComputedStyle(inspector);
    expect(style.width).toBe(`${width}px`);
    expect(style.maxWidth).toBe("100%");
  }
});
