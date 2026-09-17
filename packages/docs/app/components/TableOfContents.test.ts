import { afterEach, describe, expect, it, vi } from "vitest";

import { copyMarkdownFromUrl, getActiveTocId } from "./TableOfContents";

function headingAt(top: number): Pick<HTMLElement, "getBoundingClientRect"> {
  return {
    getBoundingClientRect: () =>
      ({
        bottom: top + 24,
        height: 24,
        left: 0,
        right: 0,
        top,
        width: 200,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) satisfies DOMRect,
  };
}

describe("getActiveTocId", () => {
  it("returns the deepest heading currently above the scroll offset", () => {
    const headings = new Map([
      ["intro", headingAt(-40)],
      ["actions", headingAt(48)],
      ["security", headingAt(180)],
    ]);

    expect(
      getActiveTocId(
        ["intro", "actions", "security"],
        (id) => headings.get(id) ?? null,
      ),
    ).toBe("actions");
  });
});

describe("copyMarkdownFromUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the markdown twin and writes it to the clipboard", async () => {
    const fetchMock = vi.fn(async () => new Response("# Docs\n"));
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetchMock);

    await copyMarkdownFromUrl("/docs/multi-app-workspace.md", writeText);

    expect(fetchMock).toHaveBeenCalledWith("/docs/multi-app-workspace.md", {
      headers: {
        Accept: "text/markdown, text/plain;q=0.9, */*;q=0.1",
      },
    });
    expect(writeText).toHaveBeenCalledWith("# Docs\n");
  });
});
