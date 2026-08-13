// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InlineMarkdown } from "./InlineMarkdown.js";

describe("InlineMarkdown", () => {
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

  it("renders inline formatting and safe links", () => {
    act(() => {
      root.render(
        <InlineMarkdown
          content={
            "**bold** *italic* ~~removed~~ `code` [docs](https://example.com) and www.example.org/help."
          }
        />,
      );
    });

    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("del")?.textContent).toBe("removed");
    expect(container.querySelector("code")?.textContent).toBe("code");

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toBe("https://example.com");
    expect(links[1]?.getAttribute("href")).toBe("https://www.example.org/help");
    expect(links[0]?.target).toBe("_blank");
    expect(links[0]?.rel).toBe("noopener noreferrer");
  });

  it("keeps headings and other block syntax out of compact surfaces", () => {
    act(() => {
      root.render(
        <InlineMarkdown
          content={
            "# Heading\n\n- list item\n\n> quoted text\n\n**still inline**"
          }
        />,
      );
    });

    expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(container.querySelector("ul, ol, blockquote")).toBeNull();
    expect(container.textContent).toContain("Heading");
    expect(container.textContent).toContain("list item");
    expect(container.querySelector("strong")?.textContent).toBe("still inline");
  });

  it("does not render raw HTML or unsafe links", () => {
    act(() => {
      root.render(
        <InlineMarkdown
          content={"<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))"}
        />,
      );
    });

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("unsafe");
  });

  it("keeps protected inline spans intact while rendering surrounding Markdown", () => {
    act(() => {
      root.render(
        <InlineMarkdown
          content="**Before** @Taylor *after*"
          inline
          protectedSpans={[
            {
              source: "@Taylor",
              label: "@Taylor",
            },
          ]}
          renderProtectedSpan={(span, children) => (
            <mark data-protected={span.label}>{children}</mark>
          )}
        />,
      );
    });

    expect(container.querySelector("strong")?.textContent).toBe("Before");
    expect(container.querySelector("mark")?.textContent).toBe("@Taylor");
    expect(container.querySelector("em")?.textContent).toBe("after");
    expect(container.querySelector("p")).toBeNull();
  });
});
