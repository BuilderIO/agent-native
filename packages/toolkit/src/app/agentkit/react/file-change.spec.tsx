// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileChange } from "./file-change.js";
import { computeLineDiff } from "./file-diff.js";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

describe("FileChange", () => {
  it("shows an edit as a diff with markers instead of colors alone", async () => {
    await render(
      <FileChange
        defaultOpen
        change={{
          kind: "edit",
          filePath: "src/app.ts",
          oldText: "const a = 1;\nexport { a };",
          newText: "const a = 2;\nexport { a };",
        }}
      />,
    );
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(".agentkit-code-line"),
        (line) => line.dataset.variant ?? "context",
      ),
    ).toEqual(["removed", "added", "context"]);
    expect(container.querySelector("pre")?.textContent).toBe(
      "Removed const a = 1;\nAdded const a = 2;\nexport { a };",
    );
    expect(
      container.querySelector("[data-agent-file-change-stats]")?.textContent,
    ).toBe("+1−1");
  });

  it("shows a new file with line numbers and its first 40 lines", async () => {
    await render(
      <FileChange
        defaultOpen
        change={{ kind: "write", filePath: "src/new.ts", content: lines(45) }}
      />,
    );
    const pre = () => container.querySelector("pre");
    expect(pre()?.dataset.lineNumbers).toBe("true");
    expect(pre()?.querySelector("code")?.dataset.language).toBe("ts");
    expect(pre()?.textContent?.split("\n")).toHaveLength(40);
    const more = container.querySelector<HTMLButtonElement>(
      ".agentkit-code-block-footer button",
    );
    expect(more?.textContent).toBe("Show 5 more lines");
    await act(async () => more?.click());
    expect(pre()?.textContent?.split("\n")).toHaveLength(45);
    expect(
      container.querySelector("[data-agent-file-change-stats]")?.textContent,
    ).toBe("+45");
  });

  it("marks a cut-short change and hides counts while it runs", async () => {
    await render(
      <FileChange
        change={{
          kind: "write",
          filePath: "big.json",
          lineCount: 9000,
          truncated: true,
        }}
      />,
    );
    // Nothing was kept, so there is nothing to open.
    expect(container.querySelector("button")).toBeNull();
    expect(
      container.querySelector("[data-agent-file-change-stats]")?.textContent,
    ).toBe("+9000Partial");

    await render(
      <FileChange
        running
        change={{ kind: "edit", filePath: "a.ts", oldText: "a", newText: "b" }}
      />,
    );
    expect(
      container.querySelector("[data-agent-file-change-stats]"),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-slot="trace-line"]')
        ?.getAttribute("data-trace-status"),
    ).toBe("running");
  });
});

describe("computeLineDiff", () => {
  it("keeps an unchanged line after an edit as context", () => {
    expect(
      computeLineDiff("a\nshared\nb", "A\nshared\nB").map(
        (line) => `${line.kind[0]}${line.text}`,
      ),
    ).toEqual(["ra", "aA", "cshared", "rb", "aB"]);
  });
});
