// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMENT_BODY_MARKDOWN_LIMIT, CommentBody } from "./CommentBody.js";

describe("CommentBody", () => {
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

  function render(element: React.ReactElement) {
    act(() => root.render(element));
  }

  function chips() {
    return [...container.querySelectorAll("span.rounded-full")].map(
      (chip) => chip.textContent,
    );
  }

  it("keeps lists, quotes and code blocks", () => {
    render(
      <CommentBody
        body={
          "Two fixes:\n\n- the **intro**\n- the title\n\n> quoted\n\n```\ncode\n```"
        }
      />,
    );

    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("intro");
    expect(container.querySelector("blockquote")?.textContent?.trim()).toBe(
      "quoted",
    );
    expect(container.querySelector("pre > code")?.textContent).toBe("code\n");
  });

  it("draws listed mentions as whole words, longest first", () => {
    render(
      <CommentBody
        body="@Sam Lee and @Sam, not @Samantha or mail@Sam"
        mentions={[
          { label: "Sam", email: "sam@example.com" },
          { label: "Sam Lee", email: "sam.lee@example.com" },
        ]}
      />,
    );

    expect(chips()).toEqual(["@Sam Lee", "@Sam"]);
    expect(container.textContent).toContain("@Samantha");
    expect(container.textContent).toContain("mail@Sam");
  });

  it("draws inline mailto mentions and keeps their address as a title", () => {
    render(
      <CommentBody body="Ask @[Alex Kim](mailto:alex%40example.com) first" />,
    );

    expect(chips()).toEqual(["@Alex Kim"]);
    expect(
      container.querySelector("span.rounded-full")?.getAttribute("title"),
    ).toBe("alex@example.com");
    expect(container.textContent).not.toContain("mailto");
  });

  it("uses a mention's offset when the app gives one", () => {
    const body = "@Sam then @Sam";
    render(
      <CommentBody
        body={body}
        mentions={[{ label: "Sam", at: body.lastIndexOf("@Sam") }]}
        renderMention={(mention) => (
          <mark data-at={mention.at}>@{mention.label}</mark>
        )}
      />,
    );

    const marks = [...container.querySelectorAll("mark")];
    expect(marks.map((mark) => mark.dataset.at)).toEqual([
      String(body.lastIndexOf("@Sam")),
    ]);
    expect(container.textContent).toBe(body);
  });

  it("marks agent mentions", () => {
    render(
      <CommentBody
        body="@Claude can you check?"
        mentions={[{ label: "Claude", kind: "agent" }]}
      />,
    );

    expect(chips()).toEqual(["@Claude"]);
    expect(container.querySelector("span.rounded-full svg")).not.toBeNull();
  });

  it("flattens a compact preview and shows links as text", () => {
    render(
      <CommentBody
        compact
        body={"- one [docs](https://example.com)\n- two\n\n> three"}
      />,
    );

    expect(container.querySelector("ul, ol, li, blockquote, p")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("docs");
    // Newlines between blocks read as spaces, so they don't spend the lines
    // of a clamped preview.
    const rootElement = container.firstElementChild;
    expect(rootElement?.className).toContain("whitespace-normal");
    expect(rootElement?.className).not.toContain("whitespace-pre-wrap");
  });

  it("leaves mentions inside links and URLs as part of the link", () => {
    render(
      <CommentBody
        body={
          "[ask @Sam](https://example.com/@Sam) or https://example.com/@Sam, then @Sam"
        }
        mentions={[{ label: "Sam", email: "sam@example.com" }]}
      />,
    );

    expect(chips()).toEqual(["@Sam"]);
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/@Sam",
      "https://example.com/@Sam",
    ]);
    expect(links[0]?.textContent).toBe("ask @Sam");
  });

  it("finds mentions in a comment that lists many", () => {
    const mentions = Array.from({ length: 5_000 }, (_, i) => ({
      label: `Person ${i}`,
    }));
    // 1,500 names stay under the Markdown limit, past which text is plain.
    const body = Array.from({ length: 1_500 }, (_, i) => `@Person ${i}`).join(
      " ",
    );
    expect(body.length).toBeLessThan(COMMENT_BODY_MARKDOWN_LIMIT);
    render(<CommentBody body={body} mentions={mentions} />);

    const drawn = chips();
    expect(drawn).toHaveLength(1_500);
    // Longest label first: `@Person 1499` isn't read as `@Person 1`.
    expect(drawn.at(-1)).toBe("@Person 1499");
  });

  it("draws the kit's chip when an app's renderer returns nothing", () => {
    render(
      <CommentBody
        body="Ask @[Alex Kim](mailto:alex@example.com) or @Sam"
        mentions={[{ label: "Sam", email: "sam@example.com" }]}
        renderMention={(mention) =>
          mention.label === "Sam" ? <b>custom {mention.label}</b> : null
        }
      />,
    );

    expect(container.querySelector("b")?.textContent).toBe("custom Sam");
    expect(chips()).toEqual(["@Alex Kim"]);
  });

  it("draws a compact preview's mention chips in the line's color", () => {
    render(
      <CommentBody
        compact
        body="Ask @[Alex Kim](mailto:alex@example.com) first"
      />,
    );

    // Previews sit on cards of any color, such as Clips' dark comment bubble.
    const chip = container.querySelector("span.rounded-full");
    expect(chip?.classList.contains("text-inherit")).toBe(true);
    expect(chip?.classList.contains("text-foreground")).toBe(false);
    expect(chip?.classList.contains("border-current/30")).toBe(true);
  });

  it("shows plain text past the Markdown limit", () => {
    const head = `${"**bold** ".repeat(1_000)}\n\n`;
    const filler = "x".repeat(COMMENT_BODY_MARKDOWN_LIMIT - head.length - 10);
    const tail = "\n\n**not bold** after the limit";
    render(<CommentBody body={`${head}${filler}${tail}`} />);

    expect(container.querySelectorAll("strong")).toHaveLength(1_000);
    expect(container.firstElementChild?.lastElementChild?.textContent).toBe(
      "**not bold** after the limit",
    );
  });

  it("skips raw HTML and unsafe links", () => {
    render(
      <CommentBody
        body={"<img src=x onerror=alert(1)> [x](javascript:alert(1))"}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
  });
});
