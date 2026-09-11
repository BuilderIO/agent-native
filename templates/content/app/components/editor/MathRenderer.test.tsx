// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { MathRenderer } from "./MathRenderer";

const containers: HTMLElement[] = [];
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, "compatMode", {
    configurable: true,
    value: "CSS1Compat",
  });
  if (!document.doctype) {
    document.insertBefore(
      document.implementation.createDocumentType("html", "", ""),
      document.documentElement,
    );
  }
});

afterAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

async function renderMath(latex: string, displayMode: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);

  act(() => {
    root.render(<MathRenderer latex={latex} displayMode={displayMode} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  return { container, root };
}

describe("MathRenderer", () => {
  it("includes accessible KaTeX markup in the initial server render", () => {
    const html = renderToString(
      <MathRenderer latex="a^2 + b^2" displayMode={false} />,
    );

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-mathml"');
    expect(html).toContain('contentEditable="false"');
  });

  it("renders KaTeX without exposing editable generated markup", async () => {
    const { container, root } = await renderMath("a^2 + b^2", false);

    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-mathml")).not.toBeNull();
    expect(
      container.querySelector(".content-math")?.getAttribute("contenteditable"),
    ).toBe("false");

    await act(async () => root.unmount());
  });

  it("shows raw source when KaTeX rejects an expression", async () => {
    const { container, root } = await renderMath("\\frac{", true);

    const fallback = container.querySelector(".content-math-error");
    expect(fallback?.textContent).toBe("\\frac{");
    expect(fallback?.getAttribute("title")).toContain("KaTeX parse error");

    await act(async () => root.unmount());
  });
});
