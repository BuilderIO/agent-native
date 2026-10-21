// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useActionQueryMock, sendToAgentChatMock } = vi.hoisted(() => ({
  useActionQueryMock: vi.fn(),
  sendToAgentChatMock: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: useActionQueryMock,
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  sendToAgentChat: sendToAgentChatMock,
}));

vi.mock("@/components/slides-2-runtime/Slides2Canvas", () => ({
  Slides2Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-slides-2-canvas>{children}</div>
  ),
}));

vi.mock("@/components/slides-2-runtime/SandboxedSlide", () => ({
  SandboxedSlide: ({
    artifact,
    title,
  }: {
    artifact: { slideId: string };
    title: string;
  }) => <div data-worker-slide={artifact.slideId} title={title} />,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "history.slideCount") return `${values?.count} slides`;
    if (key === "agent.slideNumber") return `Slide ${values?.number}`;
    return (
      {
        "deckResult.saved": "Saved",
        "deckEditor.accessApprovalOpenDeck": "Open deck",
        "deckEditor.applyResult": "Apply",
        "deckEditor.continueInChat": "Continue in chat",
        "deckEditor.regenerateResult": "Regenerate",
      }[key] ?? key
    );
  },
}));
import { resolveToolRenderer } from "@agent-native/toolkit/app/chat";
import { type ToolRendererContext } from "@agent-native/toolkit/app/chat/chat";
import {
  SLIDES_ADDED_SLIDE_RESULT_RENDERER,
  SLIDES_DECK_RESULT_RENDERER,
} from "@shared/action-ui";

import "./register-chat-renderers.js";

describe("Slides deck result card", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useActionQueryMock.mockReset();
    sendToAgentChatMock.mockReset();
    useActionQueryMock.mockReturnValue({ data: undefined, isPending: false });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders projected deck details and applies to its editor", async () => {
    const context: ToolRendererContext = {
      toolName: "create-deck",
      args: {
        promptDraft: {
          generationContext: { originalPrompt: "Create a launch brief" },
        },
      },
      resultJson: {
        id: "deck/1",
        title: "Launch brief",
        slideCount: 12,
        slides: Array.from({ length: 4 }, (_, index) => ({
          id: `slide-${index + 1}`,
          layout: "content",
          content: `<div class="fmd-slide"><h1>Slide ${index + 1}</h1><script>untrusted</script></div>`,
        })),
      },
      isRunning: false,
      chatUI: { renderer: SLIDES_DECK_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Slides deck result renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector("[data-action-card]")).not.toBeNull();
    expect(container.textContent).toContain("Launch brief");
    expect(container.textContent).toContain("12 slides");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
    expect(container.textContent).toContain("Continue in chat");
    const previewStrip = container.querySelector(
      "[data-slides-deck-preview-strip]",
    );
    expect(previewStrip?.hasAttribute("inert")).toBe(true);
    expect(previewStrip?.querySelectorAll(":scope > div")).toHaveLength(3);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/deck/deck%2F1");
    expect(link?.className).toContain("active:scale-[0.98]");
    expect(link?.className).toContain("bg-background");
    expect(
      Array.from(container.querySelectorAll("a")).map((item) =>
        item.getAttribute("href"),
      ),
    ).toEqual(["/deck/deck%2F1", "/chat?deckId=deck%2F1"]);

    const regenerateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Regenerate");
    expect(regenerateButton).toBeDefined();
    await act(async () => regenerateButton?.click());
    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: expect.stringContaining("Regenerate this saved deck"),
      context: JSON.stringify({
        appId: "slides-2",
        deckId: "deck/1",
        deckTitle: "Launch brief",
        originalPrompt: "Create a launch brief",
      }),
      submit: true,
      openSidebar: true,
      chatTarget: "local",
    });
  });

  it("uses the worker artifact for a source-backed deck preview without HTML", async () => {
    const workerArtifact = {
      protocolVersion: 1,
      deckId: "deck-1",
      slideId: "slide-worker",
      revision: 2,
      sourceHash: "a".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      runtime: { entryPoint: "worker.js" },
    };
    useActionQueryMock.mockImplementation((action: string) =>
      action === "get-slide-render"
        ? { data: workerArtifact, isPending: false }
        : {
            data: {
              id: "deck-1",
              title: "Worker deck",
              slideCount: 1,
              slides: [
                {
                  id: "slide-worker",
                  layout: "content",
                  content: "",
                  sourceTsx: "export default function Slide() { return null; }",
                  revision: 2,
                  sourceHash: "a".repeat(64),
                },
              ],
            },
            isPending: false,
          },
    );
    const context: ToolRendererContext = {
      toolName: "create-deck",
      args: {},
      resultJson: {
        id: "deck-1",
        title: "Worker deck",
        slideCount: 1,
        previews: [],
      },
      isRunning: false,
      chatUI: { renderer: SLIDES_DECK_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Slides deck result renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(useActionQueryMock).toHaveBeenNthCalledWith(
      1,
      "get-deck",
      { id: "deck-1", compact: "false" },
      { enabled: true },
    );
    expect(useActionQueryMock).toHaveBeenNthCalledWith(
      2,
      "get-slide-render",
      {
        deckId: "deck-1",
        slideId: "slide-worker",
        expectedRevision: 2,
        expectedSourceHash: "a".repeat(64),
      },
      { enabled: true },
    );
    expect(
      container.querySelector("[data-slides-worker-preview]"),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-worker-slide="slide-worker"]'),
    ).not.toBeNull();
  });

  it("ignores results without a deck id, title, or slide count", async () => {
    const context: ToolRendererContext = {
      toolName: "create-deck",
      args: {},
      resultJson: { id: "deck-1", title: "Launch brief" },
      isRunning: false,
      chatUI: { renderer: SLIDES_DECK_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Slides deck result renderer is missing");

    await act(async () => {
      root.render(<Renderer context={context} />);
    });

    expect(container.querySelector("[data-action-card]")).toBeNull();
  });

  it("renders an incremental slide preview and routes to its editor and chat scope", async () => {
    useActionQueryMock.mockReturnValueOnce({
      data: {
        id: "deck/1",
        title: "Launch brief",
        slideCount: 12,
        slides: [
          {
            id: "slide-2",
            layout: "content",
            content:
              '<div class="fmd-slide"><h1>Saved slide</h1><script>untrusted</script></div>',
          },
        ],
      },
      isPending: false,
    });
    const context: ToolRendererContext = {
      toolName: "add-slide",
      args: {},
      resultJson: {
        deckId: "deck/1",
        deckTitle: "Launch brief",
        slideId: "slide-2",
        slideNumber: 2,
        slideCount: 12,
      },
      isRunning: false,
      chatUI: { renderer: SLIDES_ADDED_SLIDE_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Added slide result renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(useActionQueryMock).toHaveBeenCalledWith(
      "get-deck",
      { id: "deck/1", slideId: "slide-2", compact: "false" },
      { enabled: true },
    );
    expect(container.textContent).toContain("Launch brief");
    expect(container.textContent).toContain("Slide 2");
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
    expect(container.textContent).toContain("Continue in chat");
    expect(container.querySelector("script")).toBeNull();
    expect(
      container.querySelector("[data-slides-added-slide-preview]"),
    ).not.toBeNull();
    expect(
      container
        .querySelector("[data-slides-added-slide-preview]")
        ?.hasAttribute("inert"),
    ).toBe(true);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/deck/deck%2F1?slide=2",
      "/chat?deckId=deck%2F1&slideId=slide-2&slideNumber=2",
    ]);
    const regenerateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Regenerate");
    expect(regenerateButton).toBeDefined();
    await act(async () => regenerateButton?.click());
    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: expect.stringContaining("Regenerate this slide"),
      context: JSON.stringify({
        appId: "slides-2",
        deckId: "deck/1",
        deckTitle: "Launch brief",
        slideId: "slide-2",
        slideNumber: 2,
      }),
      submit: true,
      openSidebar: true,
      chatTarget: "local",
    });
  });

  it("loads a Worker artifact when an added slide has no static preview", async () => {
    useActionQueryMock.mockImplementation((action: string) =>
      action === "get-slide-render"
        ? {
            data: {
              protocolVersion: 1,
              deckId: "deck-1",
              slideId: "slide-worker",
              revision: 1,
              sourceHash: "b".repeat(64),
              width: 1920,
              height: 1080,
              html: "",
              runtime: { entryPoint: "worker.js" },
            },
            isPending: false,
          }
        : {
            data: {
              id: "deck-1",
              title: "Launch brief",
              slideCount: 1,
              slides: [
                {
                  id: "slide-worker",
                  slideNumber: 1,
                  layout: "content",
                  content: "",
                  sourceTsx: "export default function Slide() { return null; }",
                  revision: 1,
                  sourceHash: "b".repeat(64),
                },
              ],
            },
            isPending: false,
          },
    );
    const context: ToolRendererContext = {
      toolName: "add-slide",
      args: {},
      resultJson: {
        deckId: "deck-1",
        deckTitle: "Launch brief",
        slideId: "slide-worker",
        slideNumber: 1,
        slideCount: 1,
      },
      isRunning: false,
      chatUI: { renderer: SLIDES_ADDED_SLIDE_RESULT_RENDERER },
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Added slide result renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(useActionQueryMock).toHaveBeenNthCalledWith(
      1,
      "get-deck",
      { id: "deck-1", slideId: "slide-worker", compact: "false" },
      { enabled: true },
    );
    expect(useActionQueryMock).toHaveBeenNthCalledWith(
      2,
      "get-slide-render",
      {
        deckId: "deck-1",
        slideId: "slide-worker",
        expectedRevision: 1,
        expectedSourceHash: "b".repeat(64),
      },
      { enabled: true },
    );
    expect(
      container.querySelector('[data-worker-slide="slide-worker"]'),
    ).not.toBeNull();
  });

  it("renders a source edit preview and links back to the edited slide", async () => {
    useActionQueryMock.mockReturnValueOnce({
      data: {
        id: "deck/1",
        title: "Launch brief",
        slideCount: 12,
        slides: [
          {
            id: "slide-2",
            slideNumber: 3,
            layout: "content",
            content:
              '<div class="fmd-slide"><h1>Updated source</h1><script>untrusted</script></div>',
          },
        ],
      },
      isPending: false,
    });
    const context: ToolRendererContext = {
      toolName: "update-slide-source",
      args: {},
      resultJson: {
        deckId: "deck/1",
        slideId: "slide-2",
        position: 1,
        revision: 2,
        sourceHash: "a".repeat(64),
        sourceTsx: "export default function Slide() { return null; }",
      },
      isRunning: false,
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Updated slide renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(useActionQueryMock).toHaveBeenCalledWith(
      "get-deck",
      { id: "deck/1", slideId: "slide-2", compact: "false" },
      { enabled: true },
    );
    expect(container.textContent).toContain("Launch brief");
    expect(container.textContent).toContain("Slide 3");
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
    expect(container.textContent).toContain("Continue in chat");
    expect(container.querySelector("script")).toBeNull();
    expect(
      container
        .querySelector("[data-slides-updated-slide-preview]")
        ?.hasAttribute("inert"),
    ).toBe(true);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/deck/deck%2F1?slide=3",
      "/chat?deckId=deck%2F1&slideId=slide-2&slideNumber=3",
    ]);
    const regenerateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Regenerate");
    expect(regenerateButton).toBeDefined();
    await act(async () => regenerateButton?.click());
    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: expect.stringContaining("Regenerate this slide"),
      context: JSON.stringify({
        appId: "slides-2",
        deckId: "deck/1",
        deckTitle: "Launch brief",
        slideId: "slide-2",
        slideNumber: 3,
      }),
      submit: true,
      openSidebar: true,
      chatTarget: "local",
    });
  });

  it("loads a Worker artifact when an updated source slide has no HTML", async () => {
    useActionQueryMock.mockImplementation((action: string) =>
      action === "get-slide-render"
        ? {
            data: {
              protocolVersion: 1,
              deckId: "deck-1",
              slideId: "slide-worker",
              revision: 3,
              sourceHash: "c".repeat(64),
              width: 1920,
              height: 1080,
              html: "",
              runtime: { entryPoint: "worker.js" },
            },
            isPending: false,
          }
        : {
            data: {
              id: "deck-1",
              title: "Launch brief",
              slideCount: 1,
              slides: [
                {
                  id: "slide-worker",
                  slideNumber: 1,
                  layout: "content",
                  content: "",
                  sourceTsx: "export default function Slide() { return null; }",
                  revision: 3,
                  sourceHash: "c".repeat(64),
                },
              ],
            },
            isPending: false,
          },
    );
    const context: ToolRendererContext = {
      toolName: "update-slide-source",
      args: {},
      resultJson: {
        deckId: "deck-1",
        slideId: "slide-worker",
        position: 0,
        revision: 3,
        sourceHash: "c".repeat(64),
      },
      isRunning: false,
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Updated slide renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(useActionQueryMock).toHaveBeenNthCalledWith(
      2,
      "get-slide-render",
      {
        deckId: "deck-1",
        slideId: "slide-worker",
        expectedRevision: 3,
        expectedSourceHash: "c".repeat(64),
      },
      { enabled: true },
    );
    expect(
      container.querySelector('[data-worker-slide="slide-worker"]'),
    ).not.toBeNull();
  });

  it("renders a Worker preview for source-backed object transform results", async () => {
    const workerArtifact = {
      protocolVersion: 1,
      deckId: "deck/1",
      slideId: "slide-2",
      revision: 4,
      sourceHash: "d".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      runtime: { entryPoint: "worker.js" },
    };
    useActionQueryMock.mockImplementation((action: string) =>
      action === "get-slide-render"
        ? { data: workerArtifact, isPending: false }
        : {
            data: {
              id: "deck/1",
              title: "Launch brief",
              slideCount: 3,
              slides: [
                {
                  id: "slide-2",
                  slideNumber: 2,
                  layout: "content",
                  content: "",
                  sourceTsx: "export default function Slide() { return null; }",
                  revision: 4,
                  sourceHash: "d".repeat(64),
                },
              ],
            },
            isPending: false,
          },
    );
    const context: ToolRendererContext = {
      toolName: "transform-slide-objects",
      args: {},
      resultJson: {
        deckId: "deck/1",
        slideId: "slide-2",
        position: 1,
        revision: 4,
        sourceHash: "d".repeat(64),
        operation: "move",
        targetCount: 1,
      },
      isRunning: false,
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Updated slide renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(useActionQueryMock).toHaveBeenNthCalledWith(
      1,
      "get-deck",
      { id: "deck/1", slideId: "slide-2", compact: "false" },
      { enabled: true },
    );
    expect(useActionQueryMock).toHaveBeenNthCalledWith(
      2,
      "get-slide-render",
      {
        deckId: "deck/1",
        slideId: "slide-2",
        expectedRevision: 4,
        expectedSourceHash: "d".repeat(64),
      },
      { enabled: true },
    );
    expect(container.textContent).toContain("Launch brief");
    expect(container.textContent).toContain("Slide 2");
    expect(container.textContent).toContain("Continue in chat");
    expect(
      container.querySelector("[data-slides-updated-slide-preview]"),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-worker-slide="slide-2"]'),
    ).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll("a")).map((item) =>
        item.getAttribute("href"),
      ),
    ).toEqual([
      "/deck/deck%2F1?slide=2",
      "/chat?deckId=deck%2F1&slideId=slide-2&slideNumber=2",
    ]);
  });

  it("renders legacy slide edit results from the updated slide read", async () => {
    useActionQueryMock.mockReturnValueOnce({
      data: {
        id: "deck-1",
        title: "Roadmap",
        slideCount: 5,
        slides: [
          {
            id: "slide-4",
            slideNumber: 4,
            layout: "statement",
            content: '<div class="fmd-slide"><h1>Updated</h1></div>',
          },
        ],
      },
      isPending: false,
    });
    const context: ToolRendererContext = {
      toolName: "update-slide",
      args: {},
      resultJson: {
        ok: true,
        deckId: "deck-1",
        slideId: "slide-4",
        applied: true,
      },
      isRunning: false,
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Updated slide renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Roadmap");
    expect(container.textContent).toContain("Slide 4");
    expect(
      container.querySelector("[data-slides-updated-slide-preview]"),
    ).not.toBeNull();
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/deck/deck-1?slide=4",
      "/chat?deckId=deck-1&slideId=slide-4&slideNumber=4",
    ]);
  });

  it("does not render failed slide edit results", async () => {
    const context: ToolRendererContext = {
      toolName: "update-slide",
      args: {},
      resultJson: { ok: false, deckId: "deck-1", slideId: "slide-1" },
      isRunning: false,
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Updated slide renderer is missing");

    await act(async () => {
      root.render(<Renderer context={context} />);
    });

    expect(container.querySelector("[data-action-card]")).toBeNull();
    expect(useActionQueryMock).toHaveBeenCalledWith(
      "get-deck",
      { id: "", slideId: "", compact: "false" },
      { enabled: false },
    );
  });
});
