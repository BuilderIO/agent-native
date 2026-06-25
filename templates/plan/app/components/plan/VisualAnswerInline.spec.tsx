// @vitest-environment happy-dom

import type { ToolRendererContext } from "@agent-native/core/client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VisualAnswerInline from "./VisualAnswerInline";

/**
 * The visual-answer chat renderer turns the action result into INLINE plan
 * blocks (diagram/wireframe/api-spec/data-model/rich-text) inside the agent
 * conversation, registry-driven via `planBlockRegistry`. These guard:
 *  - running / empty-content results render nothing (defer to the running pill
 *    or the action's link affordance) instead of a broken empty card, and
 *  - a result with normalized `plan.content.blocks` renders the heading, an
 *    "Open" deep link, and the blocks themselves inline.
 */

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function ctx(partial: Partial<ToolRendererContext>): ToolRendererContext {
  return {
    toolName: "visual-answer",
    args: {},
    resultJson: undefined,
    isRunning: false,
    ...partial,
  };
}

const contentResult = {
  planId: "plan_abc",
  question: "What is the API spec for auth?",
  url: "/plans/plan_abc",
  plan: {
    id: "plan_abc",
    kind: "plan",
    title: "Auth API spec",
    brief: "Login, refresh, and logout endpoints.",
    content: {
      version: 2,
      title: "Auth API spec",
      brief: "Login, refresh, and logout endpoints.",
      blocks: [
        {
          id: "rt-1",
          type: "rich-text",
          data: { markdown: "INLINE_VISUAL_ANSWER_BODY" },
        },
      ],
    },
  },
};

describe("VisualAnswerInline chat renderer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders nothing while the tool is still running", () => {
    act(() => {
      root.render(<VisualAnswerInline context={ctx({ isRunning: true })} />);
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the result has no plan content (link fallback)", () => {
    act(() => {
      root.render(
        <VisualAnswerInline
          context={ctx({
            resultJson: { planId: "plan_abc", url: "/plans/plan_abc" },
          })}
        />,
      );
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders the heading, open link, and blocks inline for a content result", () => {
    act(() => {
      root.render(
        <VisualAnswerInline context={ctx({ resultJson: contentResult })} />,
      );
    });

    expect(container.textContent).toContain("Auth API spec");

    const openLink = container.querySelector(
      'a[href="/plans/plan_abc"]',
    ) as HTMLAnchorElement | null;
    expect(openLink).not.toBeNull();
    expect(openLink?.textContent).toContain("Open");

    const body = container.querySelector(".plan-chat-visual-answer");
    expect(body).not.toBeNull();
    // The block was mapped through PlanBlockView inside the registry provider.
    expect(body?.childElementCount).toBeGreaterThan(0);
    expect(container.textContent).toContain("INLINE_VISUAL_ANSWER_BODY");
  });
});
