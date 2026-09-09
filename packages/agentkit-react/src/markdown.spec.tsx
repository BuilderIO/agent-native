// @vitest-environment happy-dom

import type { AgentKitController } from "@agent-native/agentkit-client";
import type { TextPart } from "@agent-native/agentkit-protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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

  it("keeps incomplete streamed emphasis literal until the agent closes it", async () => {
    await renderPart(
      {
        type: "text",
        text: "**Hello, AgentKit Browser!",
        format: "markdown",
      },
      { active: true, resetKey: "incomplete-emphasis" },
    );
    await act(async () => vi.runAllTimers());

    expect(container.textContent).toContain("**Hello, AgentKit Browser!");
    expect(container.querySelector("strong")).toBeNull();

    await renderPart(
      {
        type: "text",
        text: "**Hello, AgentKit Browser!**",
        format: "markdown",
      },
      { active: true, resetKey: "incomplete-emphasis" },
    );
    await act(async () => vi.runAllTimers());

    expect(container.querySelector("strong")?.textContent).toBe(
      "Hello, AgentKit Browser!",
    );
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
});
