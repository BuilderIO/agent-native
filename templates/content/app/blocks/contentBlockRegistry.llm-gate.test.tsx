// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const agentState = vi.hoisted(() => ({ state: "unknown" }));
const sendToAgentChat = vi.hoisted(() => vi.fn());
const setupCard = vi.hoisted(() => vi.fn(() => "shared setup"));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  BuilderSetupCard: setupCard,
  sendToAgentChat,
  useAgentEngineConfigured: () => ({
    missing: agentState.state === "missing",
    state: agentState.state,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => children,
  PopoverContent: ({ children }: { children: React.ReactNode }) => children,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => children,
}));

import { createContentBlockRenderContext } from "./contentBlockRegistry";

function renderBlockAction() {
  const context = createContentBlockRenderContext({ documentId: "document-1" });
  return context.renderEditSurface?.({
    title: "Checklist",
    trigger: <button type="button">Edit</button>,
    children: <div>Block contents</div>,
    open: true,
    onOpenChange: vi.fn(),
    variant: "menu",
    blockId: "block-1",
    blockType: "checklist",
    blockData: { items: [] },
  });
}

describe("Content structured-block AI prompt readiness gate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    agentState.state = "unknown";
    sendToAgentChat.mockReset();
    setupCard.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render() {
    act(() => root.render(renderBlockAction()));
    return container.querySelector("textarea")!;
  }

  it("keeps the field locked and offers shared setup only after a confirmed missing result", () => {
    agentState.state = "missing";

    const textarea = render();
    const action = textarea.parentElement?.parentElement;

    expect(textarea.disabled).toBe(true);
    expect(setupCard).toHaveBeenCalledWith(
      expect.objectContaining({
        fullWidth: true,
        layout: "sidebar",
      }),
      undefined,
    );
    expect(action?.firstChild?.textContent).toBe("shared setup");
    expect(sendToAgentChat).not.toHaveBeenCalled();
  });

  it.each(["unknown", "unavailable"])(
    "keeps the field locked without showing setup while readiness is %s",
    (state) => {
      agentState.state = state;

      const textarea = render();

      expect(textarea.disabled).toBe(true);
      expect(container.textContent).toContain("setup.checkingProvider");
      expect(setupCard).not.toHaveBeenCalled();
    },
  );

  it("submits the unchanged focused-block prompt once an LLM provider is ready", () => {
    agentState.state = "configured";

    const textarea = render();
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setValue.call(textarea, "  Add a clear title  ");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );

    expect(textarea.disabled).toBe(false);
    expect(sendToAgentChat).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "content",
        submit: true,
        openSidebar: true,
        message: "Add a clear title",
        context: expect.stringContaining("Document block id: block-1"),
      }),
    );
  });
});
