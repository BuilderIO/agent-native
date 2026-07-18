// @vitest-environment happy-dom

import type { NodeRewriteProposal as NodeRewriteProposalState } from "@shared/node-rewrite";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn().mockResolvedValue({ cancelled: true }),
  setClientAppState: vi.fn().mockResolvedValue(undefined),
  sendToAgent: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  setClientAppState: mocks.setClientAppState,
  useActionMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  }),
  useChangeVersion: () => 0,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, number>) =>
    key === "designEditor.nodeRewrite.candidatePosition"
      ? `${values?.current} of ${values?.total}`
      : key,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => <span />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChatAndConfirm: mocks.sendToAgent,
}));

import {
  NodeRewriteProposal,
  placeNodeRewritePopover,
} from "./NodeRewriteProposal";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("NodeRewriteProposal overview positioning", () => {
  let transformedCanvas: HTMLDivElement;
  let componentRoot: HTMLDivElement;
  let iframe: HTMLIFrameElement;
  let root: Root;
  let proposalSnapshot: NodeRewriteProposalState;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    mocks.callAction.mockClear();
    mocks.setClientAppState.mockClear();
    mocks.sendToAgent.mockReset();
    proposalSnapshot = {
      proposalId: "proposal-1",
      repromptId: "reprompt-1",
      designId: "design-1",
      fileId: "screen-1",
      filename: "screen-1.html",
      baseVersionHash: "hash-1",
      target: { nodeId: "hero" },
      resolvedTarget: { nodeId: "hero", selector: "[data-hero]" },
      variants: [
        { html: "<section>First hero</section>", summary: "First hero" },
        { html: "<section>Second hero</section>", summary: "Second hero" },
        { html: "<section>Third hero</section>", summary: "Third hero" },
      ],
      chosenIndex: 0,
      createdAt: "2026-07-16T00:00:00.000Z",
    };

    transformedCanvas = document.createElement("div");
    transformedCanvas.className = "proposal-test-canvas";
    transformedCanvas.style.transform = "scale(0.2152)";
    transformedCanvas.style.overflow = "hidden";
    transformedCanvas.getBoundingClientRect = () => rect(40, 50, 600, 400);

    iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    iframe.getBoundingClientRect = () => rect(80, 90, 500, 300);
    transformedCanvas.appendChild(iframe);
    document.body.appendChild(transformedCanvas);
    const proposalElement = iframe.contentDocument!.createElement("section");
    proposalElement.setAttribute(
      "data-agent-native-node-rewrite-proposal",
      "proposal-1",
    );
    proposalElement.getBoundingClientRect = () => rect(20, 30, 200, 100);
    iframe.contentDocument!.body.appendChild(proposalElement);

    componentRoot = document.createElement("div");
    transformedCanvas.appendChild(componentRoot);
    root = createRoot(componentRoot);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    transformedCanvas.remove();
    vi.unstubAllGlobals();
  });

  it("portals proposal chrome outside the transformed and clipped overview canvas", async () => {
    await act(async () => {
      root.render(
        <NodeRewriteProposal
          designId="design-1"
          fileId="screen-1"
          canvasSelector=".proposal-test-canvas"
          proposalSnapshot={proposalSnapshot}
        />,
      );
    });

    const proposalBeforePreview = document.querySelector<HTMLElement>(
      '[data-node-rewrite-proposal="proposal-1"]',
    );
    expect(proposalBeforePreview).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            type: "agent-native:node-html-preview-applied",
            proposalId: "proposal-1",
          },
        }),
      );
    });

    const proposal = document.querySelector<HTMLElement>(
      '[data-node-rewrite-proposal="proposal-1"]',
    );
    expect(proposal).not.toBeNull();
    expect(proposal?.parentElement).toBe(document.body);
    expect(transformedCanvas.contains(proposal)).toBe(false);
    expect(proposal?.textContent).toContain("1 of 3");

    const next = proposal?.querySelector<HTMLButtonElement>(
      '[aria-label="designEditor.nodeRewrite.nextCandidate"]',
    );
    await act(async () => next?.click());
    expect(proposal?.textContent).toContain("2 of 3");
    expect(proposal?.textContent).toContain("Second hero");
    expect(mocks.setClientAppState).not.toHaveBeenCalled();
  });

  it("does not erase a newer pending refinement when delivery fails", async () => {
    mocks.sendToAgent.mockResolvedValue({
      delivered: false,
      reason: "offline",
    });
    await act(async () => {
      root.render(
        <NodeRewriteProposal
          designId="design-1"
          fileId="screen-1"
          canvasSelector=".proposal-test-canvas"
          proposalSnapshot={proposalSnapshot}
        />,
      );
    });

    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="designEditor.nodeRewrite.refinePlaceholder"]',
    );
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "Make it warmer");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const refine = document.querySelector<HTMLButtonElement>(
      '[aria-label="designEditor.nodeRewrite.refine"]',
    );
    await act(async () => {
      refine?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.setClientAppState).toHaveBeenCalledWith(
      "design-reprompt-pending:design-1:screen-1",
      expect.objectContaining({ instruction: "Make it warmer" }),
    );
    expect(mocks.setClientAppState).not.toHaveBeenCalledWith(
      "design-reprompt-pending:design-1:screen-1",
      null,
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "cancel-node-rewrite-request",
      expect.objectContaining({
        designId: "design-1",
        fileId: "screen-1",
      }),
    );
  });

  it("shows review controls in the viewport while the target canvas is culled", async () => {
    await act(async () => {
      root.render(
        <NodeRewriteProposal
          designId="design-1"
          fileId="screen-1"
          canvasSelector=".culled-proposal-canvas"
          proposalSnapshot={proposalSnapshot}
        />,
      );
    });

    const proposal = document.querySelector<HTMLElement>(
      '[data-node-rewrite-proposal="proposal-1"]',
    );
    expect(proposal).not.toBeNull();
    expect(proposal?.parentElement).toBe(document.body);
    expect(proposal?.getAttribute("data-side")).toBe("below");
    expect(proposal?.textContent).toContain("1 of 3");
  });
});

describe("placeNodeRewritePopover", () => {
  it("flips above a target near the bottom of the viewport", () => {
    expect(
      placeNodeRewritePopover(
        { centerX: 500, top: 690, bottom: 740 },
        { width: 320, height: 176 },
        { width: 1000, height: 768 },
      ),
    ).toEqual({ left: 340, top: 506, side: "above" });
  });

  it("clamps the popover to safe viewport edges when neither side fits", () => {
    expect(
      placeNodeRewritePopover(
        { centerX: 980, top: 40, bottom: 100 },
        { width: 320, height: 700 },
        { width: 1000, height: 720 },
      ),
    ).toEqual({ left: 668, top: 12, side: "clamped" });
  });
});
