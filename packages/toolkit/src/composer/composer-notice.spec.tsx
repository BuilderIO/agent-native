// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentComposerFrame } from "./AgentComposerFrame.js";
import { ComposerNotice, ComposerNoticeScope } from "./composer-notice.js";

vi.mock("@assistant-ui/react", () => ({
  ComposerPrimitive: {
    Root: ({ children, ...props }: Record<string, unknown>) => (
      <div {...(props as object)}>{children as never}</div>
    ),
  },
}));

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllGlobals();
});

async function render(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

describe("ComposerNotice", () => {
  it("collects a scope's notices above the outlet composer's input", async () => {
    const container = await render(
      <ComposerNoticeScope>
        <ComposerNotice noticeId="host">Host notice</ComposerNotice>
        <div data-transcript="">
          <AgentComposerFrame>
            <span>Nested composer</span>
          </AgentComposerFrame>
        </div>
        <AgentComposerFrame noticeOutlet>
          <ComposerNotice noticeId="own" role="alert">
            Own notice
          </ComposerNotice>
        </AgentComposerFrame>
      </ComposerNoticeScope>,
    );
    const slots = container.querySelectorAll(
      '[data-agent-composer-slot="notices"]',
    );
    expect(slots).toHaveLength(2);
    // The nested composer is not the outlet, so it never takes the notices.
    expect(slots[0]!.children).toHaveLength(0);
    expect(
      [...slots[1]!.querySelectorAll("[data-agent-composer-notice]")].map(
        (notice) => notice.getAttribute("data-notice"),
      ),
    ).toEqual(["host", "own"]);
    expect(
      container.querySelector("[data-transcript] [data-agent-composer-notice]"),
    ).toBeNull();
  });

  it("renders in place when no composer collects it", async () => {
    const container = await render(
      <section>
        <ComposerNotice noticeId="alone">Alone</ComposerNotice>
      </section>,
    );
    expect(
      container.querySelector("section > [data-notice='alone']"),
    ).not.toBeNull();
  });

  it("is amber with a triangle by default and red only for danger", async () => {
    const onDismiss = vi.fn();
    const container = await render(
      <>
        <ComposerNotice
          noticeId="warning"
          title="Lead"
          onDismiss={onDismiss}
          dismissLabel="Dismiss"
        >
          Message
        </ComposerNotice>
        <ComposerNotice noticeId="danger" tone="danger">
          Final
        </ComposerNotice>
      </>,
    );
    const warning = container.querySelector<HTMLElement>(
      "[data-notice='warning']",
    )!;
    expect(warning.dataset.tone).toBe("warning");
    expect(warning.getAttribute("role")).toBe("status");
    expect(warning.className).toContain("--agent-kit-warning");
    expect(warning.className).not.toContain("destructive");
    expect(warning.querySelector(".tabler-icon-alert-triangle")).not.toBeNull();
    const dismiss = warning.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss"]',
    )!;
    expect(dismiss.className).toContain("size-6");
    await act(async () => dismiss.click());
    expect(onDismiss).toHaveBeenCalledOnce();

    const danger = container.querySelector<HTMLElement>(
      "[data-notice='danger']",
    )!;
    expect(danger.getAttribute("role")).toBe("alert");
    expect(danger.className).toContain("destructive");
    expect(danger.querySelector("button")).toBeNull();
  });
});
