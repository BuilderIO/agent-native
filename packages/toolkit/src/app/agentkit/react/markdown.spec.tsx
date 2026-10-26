// @vitest-environment happy-dom

import type { AgentKitController } from "@agent-native/agentkit/client";
import type { TextPart } from "@agent-native/agentkit/protocol";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentMessagePartView } from "./components.js";
import { AgentKitProvider } from "./context.js";

const controller = {} as AgentKitController;
let container: HTMLDivElement;
let root: Root;

async function renderPart(
  part: TextPart,
  options: { active: boolean; resetKey: string },
) {
  await act(async () => {
    root.render(
      <AgentKitProvider controller={controller} threadId="thread-markdown">
        <AgentMessagePartView
          value={part}
          threadId="thread-markdown"
          {...options}
        />
      </AgentKitProvider>,
    );
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AgentKit Markdown text parts", () => {
  it("renders semantic Markdown throughout a buffered stream and after completion", async () => {
    const text = [
      "**Strong** and _emphasized_ with `inline code` and [docs](https://example.com).",
      "",
      "- First item",
      "- Second item",
      "",
      "```ts",
      "const ready = true;",
      "```",
    ].join("\n");
    const part = { type: "text", text, format: "markdown" } satisfies TextPart;

    await renderPart(part, { active: true, resetKey: "streamed-markdown" });
    await act(async () => vi.runAllTimers());

    expect(container.querySelector("strong")?.textContent).toBe("Strong");
    expect(container.querySelector("em")?.textContent).toBe("emphasized");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toContain(
      "const ready = true;",
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );

    await renderPart(part, { active: false, resetKey: "streamed-markdown" });
    expect(container.querySelector("[data-format='markdown']")).not.toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("Strong");
  });

  it("renders heading markers as semantic heading elements", async () => {
    const text = ["# Top level", "", "## Section", "", "### Detail"].join("\n");

    await renderPart(
      { type: "text", text, format: "markdown" },
      { active: false, resetKey: "markdown-headings" },
    );

    expect(container.querySelector("h1")?.textContent).toBe("Top level");
    expect(container.querySelector("h2")?.textContent).toBe("Section");
    expect(container.querySelector("h3")?.textContent).toBe("Detail");
  });

  it("streams an unclosed bold run already bold, without its asterisks", async () => {
    await renderPart(
      {
        type: "text",
        text: "Greeting: **Hello, AgentKit Browser!",
        format: "markdown",
      },
      { active: true, resetKey: "incomplete-emphasis" },
    );
    await act(async () => vi.runAllTimers());

    expect(container.textContent).toContain("Greeting:");
    expect(container.textContent).not.toContain("*");
    const streamingStrong = container.querySelector("strong");
    expect(streamingStrong?.textContent).toBe("Hello, AgentKit Browser!");

    await renderPart(
      {
        type: "text",
        text: "Greeting: **Hello, AgentKit Browser!**",
        format: "markdown",
      },
      { active: true, resetKey: "incomplete-emphasis" },
    );
    await act(async () => vi.runAllTimers());

    expect(container.querySelector("strong")).toBe(streamingStrong);
    expect(container.textContent).not.toContain("*");
  });

  it("preserves completed Markdown block DOM while the live tail grows", async () => {
    const resetKey = "stable-markdown-blocks";
    await renderPart(
      {
        type: "text",
        text: "Stable first paragraph.\n\nA growing second paragraph",
        format: "markdown",
      },
      { active: false, resetKey },
    );
    const stableParagraph = container.querySelector("p");

    await renderPart(
      {
        type: "text",
        text: "Stable first paragraph.\n\nA growing second paragraph with more streamed text.",
        format: "markdown",
      },
      { active: false, resetKey },
    );
    await act(async () => vi.runAllTimers());

    expect(container.querySelector("p")).toBe(stableParagraph);
    expect(container.textContent).toContain("with more streamed text");
  });

  it("keeps plain text literal instead of interpreting Markdown", async () => {
    const text = "**Strong** _emphasis_ [docs](https://example.com)";
    await renderPart(
      { type: "text", text, format: "plain" },
      { active: false, resetKey: "plain-text" },
    );

    expect(container.querySelector("[data-format='plain']")?.textContent).toBe(
      text,
    );
    expect(container.querySelector("strong, em, a")).toBeNull();
  });

  it("drops executable Markdown link targets", async () => {
    await renderPart(
      {
        type: "text",
        text: "[unsafe](javascript:alert(1))",
        format: "markdown",
      },
      { active: false, resetKey: "unsafe-link" },
    );

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("unsafe");
  });

  it("renders fenced code as a labelled, copyable, focusable block", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await renderPart(
      {
        type: "text",
        text: "```ts\nconst ready = true;\n```",
        format: "markdown",
      },
      { active: false, resetKey: "code-block" },
    );

    const figure = container.querySelector("figure.agentkit-code-block");
    const language = figure?.querySelector(
      ".agentkit-code-block-header > span.agentkit-code-block-language",
    );
    const pre = figure?.querySelector<HTMLPreElement>(
      ":scope > pre[role='region']",
    );
    expect(language?.textContent).toBe("ts");
    expect(pre?.tabIndex).toBe(0);
    expect(pre?.getAttribute("aria-label")).toBe("ts code");
    const copy = figure?.querySelector<HTMLButtonElement>(
      ".agentkit-code-block-header button",
    );
    expect(copy?.getAttribute("aria-label")).toBe("Copy code");
    await act(async () => {
      copy?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("const ready = true;\n");
    expect(copy?.getAttribute("aria-label")).toBe("Copied");
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(copy?.getAttribute("aria-label")).toBe("Copy code");
  });

  it("names a code block without a language generically", async () => {
    await renderPart(
      { type: "text", text: "```\nplain\n```", format: "markdown" },
      { active: false, resetKey: "plain-code-block" },
    );
    expect(
      container.querySelector("pre[role='region']")?.getAttribute("aria-label"),
    ).toBe("Code block");
  });

  it("lets prose cells wrap while short cells stay on one line", async () => {
    await renderPart(
      {
        type: "text",
        text: "| Plan | Notes |\n| --- | --- |\n| Team | Best when several people share one workspace and its history. |",
        format: "markdown",
      },
      { active: false, resetKey: "prose-table" },
    );
    const cells = Array.from(
      container.querySelectorAll(".agentkit-markdown-table :is(th, td)"),
      (cell) => [cell.textContent, cell.hasAttribute("data-prose")],
    );
    expect(cells).toEqual([
      ["Plan", false],
      ["Notes", false],
      ["Team", false],
      ["Best when several people share one workspace and its history.", true],
    ]);
  });

  it("wraps tables in a focusable region and settles reading direction", async () => {
    await renderPart(
      {
        type: "text",
        text: "مرحبا\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] Done\n- [ ] Next",
        format: "markdown",
      },
      { active: false, resetKey: "table" },
    );
    const table = container.querySelector(
      "div.agentkit-markdown-table[role='region'] > table",
    );
    expect(table).not.toBeNull();
    expect(table?.querySelector("[data-prose]")).toBeNull();
    expect(
      container.querySelector<HTMLElement>(".agentkit-markdown-table")
        ?.tabIndex,
    ).toBe(0);
    expect(
      container
        .querySelector(".agentkit-markdown-table")
        ?.getAttribute("aria-label"),
    ).toBe("Table");
    expect(container.querySelector("p")?.getAttribute("dir")).toBe("auto");
    expect(container.querySelector("ul")?.getAttribute("dir")).toBe("auto");
    expect(container.querySelector("li")?.hasAttribute("dir")).toBe(false);
    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>("input[type='checkbox']"),
    );
    expect(checkboxes.map((box) => box.disabled)).toEqual([true, true]);
    expect(checkboxes.map((box) => box.getAttribute("aria-label"))).toEqual([
      "Completed",
      "Not completed",
    ]);
  });

  it("opens only links that leave this origin in a new tab", async () => {
    await renderPart(
      {
        type: "text",
        text: `[docs](https://example.com/docs) [here](${window.location.origin}/settings) [relative](/chat)`,
        format: "markdown",
      },
      { active: false, resetKey: "links" },
    );
    const [external, sameOrigin, relative] = Array.from(
      container.querySelectorAll("a"),
    );
    expect(external?.getAttribute("target")).toBe("_blank");
    expect(external?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(sameOrigin?.hasAttribute("target")).toBe(false);
    expect(relative?.hasAttribute("target")).toBe(false);
  });

  it("hydrates link targets without a server mismatch", async () => {
    const part: TextPart = {
      type: "text",
      text: `[docs](https://example.com/docs) [here](${window.location.origin}/settings)`,
      format: "markdown",
    };
    const tree = (
      <AgentKitProvider controller={controller} threadId="thread-markdown">
        <AgentMessagePartView
          value={part}
          threadId="thread-markdown"
          active={false}
          resetKey="hydrate"
        />
      </AgentKitProvider>
    );
    const serverHtml = renderToString(tree);
    const host = document.createElement("div");
    host.innerHTML = serverHtml;
    document.body.appendChild(host);
    const serverLinks = Array.from(host.querySelectorAll("a"));
    expect(serverLinks.map((link) => link.getAttribute("target"))).toEqual([
      "_blank",
      "_blank",
    ]);
    const recoverableErrors: unknown[] = [];
    const hydrated = await act(async () =>
      hydrateRoot(host, tree, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      }),
    );
    try {
      expect(recoverableErrors).toEqual([]);
      const [external, sameOrigin] = Array.from(host.querySelectorAll("a"));
      expect(external?.getAttribute("target")).toBe("_blank");
      expect(sameOrigin?.hasAttribute("target")).toBe(false);
    } finally {
      await act(async () => hydrated.unmount());
      host.remove();
    }
  });

  it("loads images lazily and drops unsafe sources", async () => {
    await renderPart(
      {
        type: "text",
        text: "![chart](https://example.com/chart.png) ![bad](javascript:alert(1))",
        format: "markdown",
      },
      { active: false, resetKey: "images" },
    );
    const images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute("loading")).toBe("lazy");
    expect(images[0]?.getAttribute("decoding")).toBe("async");
    expect(
      images[0]
        ?.closest(".agentkit-markdown-image")
        ?.getAttribute("data-loaded"),
    ).toBe("false");
  });
});

describe("AgentKit streamed Markdown reveal", () => {
  const words = () =>
    Array.from(container.querySelectorAll(".agentkit-stream-word"));
  const markdown = (text: string): TextPart => ({
    type: "text",
    text,
    format: "markdown",
  });

  it("fades in revealed words and new blocks, keeping settled spans mounted", async () => {
    const resetKey = "fade-stream";
    await renderPart(markdown("First paragraph is complete.\n\nSecond "), {
      active: true,
      resetKey,
    });
    await act(async () => vi.advanceTimersByTime(400));

    const firstParagraph = container.querySelector("p");
    const firstWord = words()[0];
    expect(firstParagraph?.classList.contains("agentkit-stream-block")).toBe(
      true,
    );
    expect(firstWord?.textContent).toBe("First ");

    await renderPart(
      markdown("First paragraph is complete.\n\nSecond paragraph grows here "),
      { active: true, resetKey },
    );
    await act(async () => vi.advanceTimersByTime(400));

    // The completed block is memoized: same element, same spans, no replay.
    expect(container.querySelector("p")).toBe(firstParagraph);
    expect(words()[0]).toBe(firstWord);
    expect(container.querySelectorAll("p")[1]?.textContent).toBe(
      "Second paragraph grows here",
    );
    expect(
      container
        .querySelectorAll("p")[1]
        ?.querySelectorAll(".agentkit-stream-word"),
    ).toHaveLength(4);
  });

  it("does not animate a completed message or history", async () => {
    await renderPart(markdown("A finished answer.\n\n- with a list"), {
      active: false,
      resetKey: "history",
    });

    expect(words()).toHaveLength(0);
    expect(container.querySelector(".agentkit-stream-block")).toBeNull();
    expect(container.textContent).toContain("with a list");
  });

  it("does not replay text that was visible before a remount", async () => {
    const resetKey = "remount-stream";
    const text =
      "One two three four five six seven eight nine ten eleven twelve";
    await renderPart(markdown(text), { active: true, resetKey });
    await act(async () => vi.advanceTimersByTime(120));
    const visibleBefore = container.textContent ?? "";
    expect(visibleBefore.length).toBeGreaterThan(0);
    expect(visibleBefore.length).toBeLessThan(text.length);

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPart(markdown(text), { active: true, resetKey });

    expect(container.textContent).toBe(visibleBefore);
    expect(words()).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(120));
    expect(words().length).toBeGreaterThan(0);
    expect(words()[0]!.textContent).not.toBe("One ");
  });

  it("paces the reveal without fading under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }));
    const text =
      "Words arrive at a steady pace and settle **with formatting** intact.";
    const settled =
      "Words arrive at a steady pace and settle with formatting intact.";
    await renderPart(markdown(text), { active: true, resetKey: "reduced" });

    await act(async () => vi.advanceTimersByTime(40));
    const partial = container.textContent ?? "";
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(settled.length);
    expect(words()).toHaveLength(0);
    expect(container.querySelector(".agentkit-stream-block")).toBeNull();

    await act(async () => vi.runAllTimers());
    expect(container.querySelector("strong")?.textContent).toBe(
      "with formatting",
    );
    expect(container.textContent).toBe(settled);
    expect(words()).toHaveLength(0);
    expect(container.querySelector(".agentkit-stream-block")).toBeNull();
  });

  it("settles a streamed message to exactly the static rendering", async () => {
    const text = [
      "## Result",
      "",
      "Use **bold**, *emphasis*, `code`, and [a link](https://example.com/x).",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const ready = true;",
      "```",
      "",
      "- one",
      "- two",
    ].join("\n");
    const resetKey = "settles-exactly";
    let streamedText = "";
    for (let end = 0; end < text.length; end += 23) {
      streamedText = text.slice(0, end);
      await renderPart(markdown(streamedText), { active: true, resetKey });
      await act(async () => vi.advanceTimersByTime(48));
      expect(container.textContent).not.toMatch(/\*\*|\]\(|`|\|\s*-/);
    }
    await renderPart(markdown(text), { active: false, resetKey });
    await act(async () => vi.runAllTimers());
    const normalize = (html: string) =>
      html
        .replace(/<span class="agentkit-stream-word">([^<]*)<\/span>/g, "$1")
        .replace(/ class="agentkit-stream-(?:word|block)"/g, "")
        .replace(/ agentkit-stream-(?:word|block)/g, "");
    const streamedHtml = normalize(container.innerHTML);

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPart(markdown(text), { active: false, resetKey: "static" });

    expect(streamedHtml).toBe(container.innerHTML);
  });
});
