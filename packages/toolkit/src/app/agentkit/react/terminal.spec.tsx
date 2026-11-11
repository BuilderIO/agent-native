// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Terminal } from "./terminal.js";

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

const trigger = () =>
  container.querySelector<HTMLButtonElement>(
    "button.agentkit-disclosure-summary",
  );
const status = () =>
  container
    .querySelector('[data-slot="trace-line"]')
    ?.getAttribute("data-trace-status");

describe("Terminal", () => {
  it("shows a command with no output yet as a static running step", async () => {
    await render(<Terminal command="pnpm build" running />);
    expect(trigger()).toBeNull();
    expect(container.querySelector(".agentkit-trace-title")?.textContent).toBe(
      "pnpm build",
    );
    expect(status()).toBe("running");
  });

  it("masks closed output in fresh nodes, so replay never keeps it", async () => {
    await render(
      <Terminal command="pnpm build" output={"token=abc\n"} exitCode={0} />,
    );
    const output = () =>
      document.querySelector(".agentkit-terminal-body [data-an-mask]");
    expect(
      document.querySelector(".agentkit-terminal-body")?.textContent,
    ).toContain("token=abc");
    expect(output()).not.toBeNull();

    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(".agentkit-disclosure-summary")
        ?.click(),
    );
    const opened = document.querySelector(".agentkit-terminal-body");
    expect(output()).toBeNull();

    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(".agentkit-disclosure-summary")
        ?.click(),
    );
    // Closing replaces the node instead of masking the one replay recorded.
    expect(opened?.isConnected).toBe(false);
    expect(output()).not.toBeNull();
  });

  it("opens when output starts streaming and marks a nonzero exit failed", async () => {
    await render(<Terminal command="pnpm test" running output="" />);
    await render(
      <Terminal command="pnpm test" running output={"1 passed\n"} />,
    );
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("pre")?.textContent).toBe("1 passed");

    await render(
      <Terminal
        command="pnpm test"
        output={"1 passed\n1 failed\n"}
        exitCode={1}
        durationMs={4_200}
      />,
    );
    expect(status()).toBe("error");
    expect(
      container.querySelector(".agentkit-trace-description")?.textContent,
    ).toBe("4s · Exit code 1");
    // Finishing never closes what streaming opened.
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
  });

  it("stays closed once the user closes it, while output keeps streaming", async () => {
    await render(<Terminal command="pnpm dev" running output={"ready\n"} />);
    await act(async () => trigger()?.click());
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
    await render(
      <Terminal command="pnpm dev" running output={"ready\nrebuilt\n"} />,
    );
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the newest lines first and reveals the earlier ones", async () => {
    const output = Array.from(
      { length: 8 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    await render(
      <Terminal command="seq 8" output={output} maxLines={3} defaultOpen />,
    );
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
    const pre = () => container.querySelector("pre")?.textContent;
    expect(pre()).toBe("line 6\nline 7\nline 8");
    const earlier = container.querySelector<HTMLButtonElement>(
      ".agentkit-terminal-earlier",
    );
    expect(earlier?.textContent).toBe("Show 5 earlier lines");
    await act(async () => earlier?.click());
    expect(pre()).toBe(output);

    // The body remounts on each toggle; the revealed lines stay revealed.
    await act(async () => trigger()?.click());
    await act(async () => trigger()?.click());
    expect(pre()).toBe(output);
  });

  it("copies the whole output without color codes", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await render(
      <Terminal
        command="pnpm lint"
        output={"\u001b[31merror\u001b[0m in a.ts"}
        exitCode={1}
      />,
    );
    const copy = container.querySelector<HTMLButtonElement>(
      ".agentkit-terminal-actions button",
    );
    expect(copy?.getAttribute("aria-label")).toBe("Copy output");
    await act(async () => {
      copy?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("error in a.ts");
  });

  it("marks a call that failed apart from its exit code", async () => {
    await render(
      <Terminal command="rm -rf /" output="Error: command blocked" failed />,
    );
    expect(status()).toBe("error");
  });
});
