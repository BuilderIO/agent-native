import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const { sendToAgentChat } = vi.hoisted(() => ({
  sendToAgentChat: vi.fn(),
}));
vi.mock("@agent-native/core/client", () => ({
  sendToAgentChat,
  // The component imports `sendToAgentChat` from `@agent-native/core/client`,
  // and `@/lib/utils` re-exports `cn` from the same client subpath, so the mock
  // must target `/client` to keep both alive.
  cn: (...args: unknown[]) =>
    args
      .flat(Infinity)
      .filter((x) => typeof x === "string" && x.length > 0)
      .join(" "),
  useT: () => (key: string) =>
    (
      ({
        "raw.comment": "Comment",
        "raw.editSlide": "Edit slide",
        "raw.escExit": "Esc to exit",
        "raw.pinDropHint": "Click anywhere on the slide to leave a comment",
        "raw.tellAgentChange": "Tell the agent what to change...",
        "raw.send": "Send",
      }) as Record<string, string>
    )[key] ?? key,
}));

// Tooltip primitives in shadcn portal to document.body. Render them inline
// in the test so we can assert visibility without a TooltipProvider boilerplate.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({
    open,
    children,
  }: {
    open?: boolean;
    children: React.ReactNode;
  }) => (
    <div
      data-testid="tooltip-root"
      data-open={open === false ? "false" : "true"}
    >
      {children}
    </div>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { CanvasCommentPins } from "./CanvasCommentPins";

function mountCanvas() {
  const canvas = document.createElement("div");
  canvas.setAttribute("data-test-canvas", "true");
  canvas.style.position = "fixed";
  canvas.style.left = "100px";
  canvas.style.top = "100px";
  canvas.style.width = "800px";
  canvas.style.height = "600px";
  canvas.getBoundingClientRect = () =>
    ({
      width: 800,
      height: 600,
      top: 100,
      left: 100,
      right: 900,
      bottom: 700,
      x: 100,
      y: 100,
      toJSON() {},
    }) as DOMRect;
  document.body.appendChild(canvas);
  return canvas;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sendToAgentChat.mockReset();
});

describe("CanvasCommentPins", () => {
  it("sends pin draft to the agent via sendToAgentChat when Send is clicked", async () => {
    const canvas = mountCanvas();
    render(
      <CanvasCommentPins
        active
        onClose={() => {}}
        canvasSelector="[data-test-canvas]"
        contextId="slide-1"
        contextLabel="Slide 1"
      />,
    );

    // Drop a pin inside the canvas. The window click handler installed by
    // CanvasCommentPins captures clicks anywhere on `window`, so we can
    // dispatch the click at the document level.
    act(() => {
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 300,
      });
      Object.defineProperty(clickEvent, "target", {
        value: canvas,
        enumerable: true,
      });
      window.dispatchEvent(clickEvent);
    });

    // Composer should appear. Type a draft and click Send.
    const textarea = await screen.findByPlaceholderText(
      /Tell the agent what to change/i,
    );
    fireEvent.change(textarea, {
      target: { value: "Make this heading bigger" },
    });

    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect((sendBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(sendBtn);

    expect(sendToAgentChat).toHaveBeenCalledTimes(1);
    const payload = sendToAgentChat.mock.calls[0][0];
    expect(payload.submit).toBe(true);
    expect(payload.openSidebar).toBe(true);
    expect(payload.message).toContain("[Comment pin on Slide 1]");
    expect(payload.message).toContain("Make this heading bigger");
  });

  it("hides the pin-marker tooltip while the composer is open", async () => {
    mountCanvas();
    render(
      <CanvasCommentPins
        active
        onClose={() => {}}
        canvasSelector="[data-test-canvas]"
        contextId="slide-1"
        contextLabel="Slide 1"
      />,
    );

    // Drop a pin.
    act(() => {
      const evt = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 300,
        clientY: 300,
      });
      Object.defineProperty(evt, "target", {
        value: document.querySelector("[data-test-canvas]"),
        enumerable: true,
      });
      window.dispatchEvent(evt);
    });

    // The composer is showing for this pin (it's the active pin). The Tooltip
    // around the pin marker must be force-closed (`open={false}`) so its
    // content (rendered at z-[250] by shadcn) cannot overlap and absorb
    // clicks on the Send button below it.
    const root = await screen.findByTestId("tooltip-root");
    expect(root.getAttribute("data-open")).toBe("false");
  });
});
