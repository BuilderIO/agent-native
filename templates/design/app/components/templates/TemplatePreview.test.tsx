// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TemplatePreview } from "./TemplatePreview";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("TemplatePreview", () => {
  it("renders shared HTML in a script-disabled sandbox", async () => {
    await act(async () => {
      root.render(
        <TemplatePreview
          title="Shared template"
          html="<script>window.parent.__templateAttack = true</script><p>Preview</p>"
        />,
      );
    });

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-scripts");
  });
});
