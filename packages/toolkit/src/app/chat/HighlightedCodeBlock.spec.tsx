// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HighlightedCodeBlock } from "./HighlightedCodeBlock.js";

describe("HighlightedCodeBlock while code streams", () => {
  let container: HTMLDivElement;
  let root: Root;
  let resolveHighlight: Array<() => void>;

  // Each highlight waits until the test releases it, like a slow highlighter.
  const loadHighlighter = async () => ({
    getLoadedLanguages: () => ["ts"],
    codeToHtml: (code: string) =>
      new Promise<string>((resolve) => {
        resolveHighlight.push(() =>
          resolve(
            `<pre class="shiki"><code><span class="line"><span class="token">${code}</span></span></code></pre>`,
          ),
        );
      }),
  });

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    resolveHighlight = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(code: string) {
    await act(async () => {
      root.render(
        <HighlightedCodeBlock
          code={code}
          lang="ts"
          containerClass="code"
          loadHighlighter={loadHighlighter}
        />,
      );
    });
  }

  async function releaseHighlights() {
    await act(async () => {
      for (const resolve of resolveHighlight.splice(0)) resolve();
    });
  }

  it("shows new code at once, unstyled until its highlight lands", async () => {
    await render("const a = 1;");
    await releaseHighlights();
    expect(container.querySelector(".token")?.textContent).toBe("const a = 1;");

    await render("const a = 1;\nconst b = 2;");

    // The highlighted prefix stays, and the new line is already on screen.
    expect(container.querySelector(".token")?.textContent).toBe("const a = 1;");
    expect(container.textContent).toBe("const a = 1;\nconst b = 2;");

    await releaseHighlights();
    expect(container.querySelector(".token")?.textContent).toBe(
      "const a = 1;\nconst b = 2;",
    );
  });

  it("escapes the unstyled tail", async () => {
    await render("a");
    await releaseHighlights();
    await render("a < b && c > d");

    expect(container.textContent).toBe("a < b && c > d");
    expect(container.querySelector("b, d")).toBeNull();
  });
});
