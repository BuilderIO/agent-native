// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import { VisualEditor } from "./VisualEditor";

/**
 * A full-length article, the payload from the original report: ~2100 words of
 * headings, prose, nested lists, links, fenced code, tables and rules, plus the
 * `<Table .../>` component block an MDX article carries. Chromium turns that
 * block into a childless `<table>`, which is what used to abort the paste.
 */
function fullLengthArticle(): string {
  const vocabulary =
    "editor content markdown paste document workspace agent collaboration pipeline transform parser serializer schema transaction render selection clipboard heading paragraph list table quote code block inline link image caption anchor offset revision history review suggestion".split(
      " ",
    );
  let seed = 42;
  const next = () =>
    (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const word = () => vocabulary[Math.floor(next() * vocabulary.length)];
  const sentence = (words: number) => {
    const text = Array.from({ length: words }, word).join(" ");
    return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
  };
  const paragraph = (sentences: number) =>
    Array.from({ length: sentences }, () =>
      sentence(10 + Math.floor(next() * 10)),
    ).join(" ");

  const lines: string[] = ["# Shipping A Long Article", "", paragraph(4), ""];
  for (let section = 1; section <= 8; section++) {
    lines.push(
      `## Section ${section}: ${sentence(5)}`,
      "",
      paragraph(4),
      "",
      `### Subsection ${section}.1`,
      "",
      paragraph(3),
      "",
      `- ${sentence(10)}`,
      `- **${word()}** ${sentence(9)}`,
      `- ${sentence(8)} [a link](https://example.com/${word()})`,
      `  - ${sentence(7)}`,
      `  - ${sentence(7)}`,
      "",
      `1. ${sentence(9)}`,
      `2. ${sentence(9)}`,
      "",
      "```ts",
      `export function step${section}(input: string): string {`,
      "  return input.trim();",
      "}",
      "```",
      "",
      paragraph(3),
      "",
      "| Name | Purpose |",
      "| --- | --- |",
      `| ${word()} | ${sentence(4)} |`,
      "",
      "<Table",
      '  columns={["Name", "Purpose"]}',
      "  rows={[",
      `    ["${word()}", "${sentence(3)}"],`,
      "  ]}",
      "/>",
      "",
      "---",
      "",
    );
  }
  lines.push("## Conclusion", "", paragraph(5), "");
  return lines.join("\n");
}

/** What a code editor puts on the clipboard: styled divs, no rich structure. */
function codeEditorHtml(markdown: string): string {
  const rows = markdown
    .split("\n")
    .map(
      (line) =>
        `<div>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`,
    )
    .join("");
  return `<div style="font-family: monospace; color: #d4d4d4;">${rows}</div>`;
}

function dispatchPaste(target: Element, markdown: string) {
  const payload = new Map<string, string>([
    ["text/plain", markdown],
    ["text/html", codeEditorHtml(markdown)],
  ]);
  const event = new window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (type: string) => payload.get(type) ?? "",
      types: [...payload.keys()],
      files: [],
      items: [],
    },
  });
  target.dispatchEvent(event);
}

describe("pasting a full-length markdown article", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let uncaught: string[];

  const recordUncaught = (event: Event) => {
    const detail =
      (event as ErrorEvent).error ??
      (event as PromiseRejectionEvent).reason ??
      event;
    uncaught.push(String(detail));
  };

  beforeEach(() => {
    uncaught = [];
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    window.addEventListener("error", recordUncaught);
    window.addEventListener("unhandledrejection", recordUncaught);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    window.removeEventListener("error", recordUncaught);
    window.removeEventListener("unhandledrejection", recordUncaught);
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mountEditor() {
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            TooltipProvider,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(VisualEditor, {
                content: "Start here.",
                onChange,
                ydoc: null,
                editable: true,
              }),
            ),
          ),
        ),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const editorElement = container.querySelector(".ProseMirror");
    expect(editorElement).not.toBeNull();
    return { editorElement: editorElement as Element, onChange };
  }

  it("inserts the article instead of throwing out of the paste handler", async () => {
    const article = fullLengthArticle();
    expect(article.split(/\s+/).filter(Boolean).length).toBeGreaterThan(2000);

    const { editorElement } = await mountEditor();
    let thrown: unknown = null;
    await act(async () => {
      try {
        dispatchPaste(editorElement, article);
      } catch (error) {
        thrown = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(thrown).toBeNull();
    expect(uncaught).toEqual([]);

    const text = editorElement.textContent ?? "";
    expect(text).toContain("Shipping A Long Article");
    expect(text).toContain("Conclusion");
    // Parsed as rich content, not dumped in as literal markdown syntax.
    expect(editorElement.querySelectorAll("h2").length).toBeGreaterThan(5);
    expect(editorElement.querySelectorAll("pre").length).toBeGreaterThan(5);
  });

  it("keeps fenced code containing a blank line in one code block", async () => {
    const markdown = [
      "# Heading",
      "",
      "Intro copy for the sample.",
      "",
      "```ts",
      'import { a } from "x";',
      "",
      "export default a;",
      "```",
      "",
      "Closing copy for the sample.",
    ].join("\n");

    const { editorElement } = await mountEditor();
    await act(async () => {
      dispatchPaste(editorElement, markdown);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(uncaught).toEqual([]);
    const blocks = editorElement.querySelectorAll("pre");
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.textContent).toBe(
      'import { a } from "x";\n\nexport default a;',
    );
  });
});
