// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadCodeHighlighter } from "../../code-highlighter.js";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockLine,
} from "./code-block.js";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  // Real throttle timers let a highlight pass land early under load.
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
}

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(100);
    await loadCodeHighlighter();
    await Promise.resolve();
  });
}

function lineText() {
  return Array.from(
    container.querySelectorAll(".agentkit-code-line"),
    (line) => line.textContent,
  );
}

describe("CodeBlock", () => {
  it("renders plain lines first, then highlighted tokens with the same text", async () => {
    const code = "const ready = true;\nexport { ready };\n";
    await render(
      <CodeBlock>
        <CodeBlockContent language="ts">{code}</CodeBlockContent>
      </CodeBlock>,
    );
    expect(container.querySelector(".agentkit-code-token")).toBeNull();
    expect(lineText()).toEqual(["const ready = true;", "export { ready };"]);

    await settle();
    expect(container.querySelector(".agentkit-code-token")).not.toBeNull();
    expect(lineText()).toEqual(["const ready = true;", "export { ready };"]);
    expect(container.querySelector("code")?.textContent).toBe(
      "const ready = true;\nexport { ready };",
    );
  });

  it("keeps finished lines highlighted while a new line streams in", async () => {
    const view = (code: string) => (
      <CodeBlockContent language="ts">{code}</CodeBlockContent>
    );
    await render(view("const a = 1;"));
    await settle();
    await render(view("const a = 1;\nconst b"));
    const [first, second] = Array.from(
      container.querySelectorAll(".agentkit-code-line"),
    );
    expect(first?.querySelector(".agentkit-code-token")).not.toBeNull();
    expect(second?.querySelector(".agentkit-code-token")).toBeNull();
    expect(second?.textContent).toBe("const b");
  });

  it("colors terminal output and never shows its escape codes", async () => {
    await render(
      <CodeBlockContent language="ansi">
        {"\u001b[31mfailed\u001b[0m 2 tests\nok"}
      </CodeBlockContent>,
    );
    expect(lineText()).toEqual(["failed 2 tests", "ok"]);
    await settle();
    expect(lineText()).toEqual(["failed 2 tests", "ok"]);
    const failed = container.querySelector<HTMLElement>(".agentkit-code-token");
    expect(failed?.textContent).toBe("failed");
    expect(failed?.style.getPropertyValue("--shiki-light")).not.toBe("");
  });

  it("renders an unknown language as plain text", async () => {
    await render(
      <CodeBlockContent language="cobol">{"DISPLAY 'HI'."}</CodeBlockContent>,
    );
    await settle();
    expect(container.querySelector(".agentkit-code-token")).toBeNull();
    expect(lineText()).toEqual(["DISPLAY 'HI'."]);
  });

  it("keeps diff markers and line numbers out of the text", async () => {
    await render(
      <CodeBlockContent lineNumbers startLine={10}>
        <CodeBlockLine variant="removed">old</CodeBlockLine>
        <CodeBlockLine variant="added">new</CodeBlockLine>
      </CodeBlockContent>,
    );
    const pre = container.querySelector("pre")!;
    expect(pre.dataset.lineNumbers).toBe("true");
    expect(pre.style.getPropertyValue("--agentkit-code-start-line")).toBe("9");
    expect(pre.getAttribute("dir")).toBe("ltr");
    // The visible +/− is generated content; screen readers hear the word.
    expect(pre.textContent).toBe("Removed old\nAdded new");
    expect(
      Array.from(pre.querySelectorAll(".agentkit-code-line-change"), (label) =>
        label.classList.contains("agentkit-visually-hidden"),
      ),
    ).toEqual([true, true]);
    expect(
      Array.from(
        pre.querySelectorAll<HTMLElement>(".agentkit-code-line"),
        (line) => line.dataset.variant,
      ),
    ).toEqual(["removed", "added"]);
  });

  it("copies its value outside an AgentKit provider", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await render(<CodeBlockCopyButton value="pnpm build" />);
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Copy code");
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("pnpm build");
    expect(button.getAttribute("aria-label")).toBe("Copied");
    // Said once in a polite region; a renamed focused button is often silent.
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      "Copied",
    );
  });
});
