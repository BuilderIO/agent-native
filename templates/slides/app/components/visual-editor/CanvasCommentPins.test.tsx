import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const { sendToAgentChatAndConfirm } = vi.hoisted(() => ({
  sendToAgentChatAndConfirm: vi.fn(
    async (_input: {
      message: string;
      submit: boolean;
      openSidebar: boolean;
    }) => ({ delivered: true }),
  ),
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChatAndConfirm,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
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
  sendToAgentChatAndConfirm.mockClear();
});

describe("CanvasCommentPins", () => {
  it("confirms delivery before marking a pin as sent", async () => {
    let confirmDelivery: ((result: { delivered: true }) => void) | undefined;
    sendToAgentChatAndConfirm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirmDelivery = resolve;
        }),
    );
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

    await waitFor(() =>
      expect(sendToAgentChatAndConfirm).toHaveBeenCalledTimes(1),
    );
    expect(
      screen.getByPlaceholderText(/Tell the agent what to change/i),
    ).toBeTruthy();
    const payload = sendToAgentChatAndConfirm.mock.calls[0][0];
    expect(payload.submit).toBe(true);
    expect(payload.openSidebar).toBe(true);
    expect(payload.message).toContain("[Comment pin on Slide 1]");
    expect(payload.message).toContain("Make this heading bigger");

    await act(async () => confirmDelivery?.({ delivered: true }));
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText(/Tell the agent what to change/i),
      ).toBeNull(),
    );
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
    await screen.findByPlaceholderText(/Tell the agent what to change/i);
    const marker = document.querySelector<HTMLButtonElement>(
      "[data-pin-id] > button",
    );
    expect(marker?.getAttribute("data-state")).toBe("closed");
  });

  it("captures the parent-DOM target behind the iframe click plane", async () => {
    const canvas = mountCanvas();
    const heading = document.createElement("h1");
    heading.setAttribute("data-builder-id", "hero-title");
    heading.textContent = "Quarterly results";
    canvas.appendChild(heading);
    render(
      <CanvasCommentPins
        active
        onClose={() => {}}
        canvasSelector="[data-test-canvas]"
        contextId="slide-1"
        contextLabel="Slide 1"
      />,
    );

    const clickPlane = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        "[data-pin-click-overlay]",
      );
      expect(element).not.toBeNull();
      return element!;
    });
    expect(canvas.contains(clickPlane)).toBe(false);
    expect(canvas.contains(heading)).toBe(true);
    const elementsFromPoint = vi.fn(() => [clickPlane, heading, canvas]);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: elementsFromPoint,
    });
    fireEvent.click(clickPlane, { clientX: 300, clientY: 300 });
    Reflect.deleteProperty(document, "elementsFromPoint");
    expect(elementsFromPoint).toHaveBeenCalledWith(300, 300);

    const textarea = await screen.findByPlaceholderText(
      /Tell the agent what to change/i,
    );
    fireEvent.change(textarea, {
      target: { value: "Make this heading bigger" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(sendToAgentChatAndConfirm).toHaveBeenCalledTimes(1),
    );
    const payload = sendToAgentChatAndConfirm.mock.calls[0][0];
    expect(payload.message).toContain("Anchor id: hero-title");
    expect(payload.message).toContain(
      'Element: [data-builder-id="hero-title"]',
    );
    expect(payload.message).toContain('Nearby text: "Quarterly results"');
  });
});
