// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useActionQueryMock, sendToAgentChatMock, useAgentChatContextMock } =
  vi.hoisted(() => ({
    useActionQueryMock: vi.fn(),
    sendToAgentChatMock: vi.fn(),
    useAgentChatContextMock: vi.fn(),
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
  useAgentChatContext: useAgentChatContextMock,
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
  DEFAULT_LOCALE: "en",
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
  useOptionalLocale: () => undefined,
}));
import { resolveToolRenderer } from "@agent-native/toolkit/app/chat";
import { type ToolRendererContext } from "@agent-native/toolkit/app/chat/chat";
import { ToolCallDisplay } from "@agent-native/toolkit/app/chat/chat/tool-call-display";
import {
  projectSlidesAddedSlideResult,
  projectSlidesDeckResult,
  SLIDES_ADDED_SLIDE_RESULT_RENDERER,
  SLIDES_DECK_RESULT_RENDERER,
  projectSlidesViewScreenResult,
  SLIDES_VIEW_SCREEN_RESULT_RENDERER,
} from "@shared/action-ui";

import "./register-chat-renderers.js";

describe("Slides deck result card", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(_callback: ResizeObserverCallback) {}
        observe(_target: Element) {}
        unobserve(_target: Element) {}
        disconnect() {}
      } as unknown as typeof ResizeObserver,
    );
    useActionQueryMock.mockReset();
    sendToAgentChatMock.mockReset();
    useAgentChatContextMock.mockReturnValue({ items: [] });
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

  it("keeps shared chart action results available with Slides renderers registered", async () => {
    await act(async () => {
      root.render(
        <ToolCallDisplay
          toolName="response-insights"
          args={{}}
          result={JSON.stringify({
            chartSeries: {
              type: "bar",
              title: "Responses by day",
              xKey: "date",
              series: [{ key: "submissions", label: "Submissions" }],
              data: [{ date: "2026-06-18", submissions: 1 }],
            },
          })}
          chatUI={{ renderer: "core.data-chart" }}
          isRunning={false}
        />,
      );
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(container.textContent).toContain("Responses by day");
    expect(
      container.querySelector('svg[role="img"][aria-label="Responses by day"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-action-card]")).toBeNull();
    expect(
      container.querySelector("[data-slides-deck-preview-strip]"),
    ).toBeNull();
  });

  it("keeps shared table action results available with Slides renderers registered", async () => {
    await act(async () => {
      root.render(
        <ToolCallDisplay
          toolName="response-records"
          args={{}}
          result={JSON.stringify({
            table: {
              title: "Responses by day",
              columns: [
                { key: "date", label: "Date" },
                { key: "submissions", label: "Submissions" },
              ],
              rows: [{ date: "2026-06-18", submissions: 1 }],
            },
          })}
          chatUI={{ renderer: "core.data-table" }}
          isRunning={false}
        />,
      );
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(container.textContent).toContain("Responses by day");
    expect(container.textContent).toContain("2026-06-18");
    expect(container.textContent).toContain("Submissions");
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("[data-action-card]")).toBeNull();
    expect(
      container.querySelector("[data-slides-deck-preview-strip]"),
    ).toBeNull();
  });

  it("projects only complete valid source versions for added slide results", () => {
    const result = {
      deckId: "deck-1",
      deckTitle: "Launch brief",
      slideId: "slide-1",
      slideNumber: 1,
      slideCount: 1,
    };
    const sourceVersion = { revision: 4, sourceHash: "a".repeat(64) };

    expect(projectSlidesAddedSlideResult(result)).toEqual(result);
    expect(
      projectSlidesAddedSlideResult({ ...result, ...sourceVersion }),
    ).toEqual({ ...result, ...sourceVersion });
    expect(projectSlidesAddedSlideResult({ ...result, revision: 4 })).toEqual(
      result,
    );
    expect(
      projectSlidesAddedSlideResult({
        ...result,
        ...sourceVersion,
        sourceHash: "not-a-source-hash",
      }),
    ).toEqual(result);
    expect(
      projectSlidesAddedSlideResult({
        ...result,
        ...sourceVersion,
        revision: 0,
      }),
    ).toEqual(result);
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
    const previewFrames = Array.from(
      previewStrip?.querySelectorAll("iframe") ?? [],
    );
    expect(previewFrames).toHaveLength(3);
    expect(previewFrames.map((frame) => frame.getAttribute("sandbox"))).toEqual(
      ["", "", ""],
    );
    expect(previewFrames[0]?.srcdoc).toContain("Slide 1");
    expect(container.querySelector("h1")).toBeNull();
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

  it("shows a loading preview while the remaining deck slides are read", async () => {
    useActionQueryMock.mockReturnValue({ data: undefined, isPending: true });
    const context: ToolRendererContext = {
      toolName: "create-deck",
      args: {},
      resultJson: {
        id: "deck-1",
        title: "Launch brief",
        slideCount: 2,
        slides: [
          {
            id: "slide-1",
            layout: "content",
            content: '<div class="fmd-slide"><h1>Slide 1</h1></div>',
          },
        ],
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

    const previewStrip = container.querySelector(
      "[data-slides-deck-preview-strip]",
    );
    expect(previewStrip?.querySelectorAll("iframe")).toHaveLength(1);
    expect(previewStrip?.querySelector(".skeleton-shimmer")).not.toBeNull();
  });

  it("renders a template copy with a sandboxed preview and no regenerate action", async () => {
    const sourceHash = "a".repeat(64);
    const workerArtifact = {
      protocolVersion: 1,
      deckId: "template-deck",
      slideId: "template-slide",
      revision: 1,
      sourceHash,
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
              id: "template-deck",
              title: "Investor pitch",
              slideCount: 1,
              slides: [
                {
                  id: "template-slide",
                  slideNumber: 1,
                  sourceTsx: "export default function Slide() { return null; }",
                  revision: 1,
                  sourceHash,
                  content: '<div class="fmd-slide"><h1>Pitch</h1></div>',
                },
              ],
            },
            isPending: false,
          },
    );
    const context: ToolRendererContext = {
      toolName: "create-deck-from-template",
      args: { templateId: "investor-pitch" },
      resultJson: {
        id: "template-deck",
        title: "Investor pitch",
        templateId: "investor-pitch",
        slideCount: 1,
        url: "/deck/template-deck",
        reused: false,
      },
      resultText: JSON.stringify({ id: "template-deck" }),
      isRunning: false,
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Template copy result renderer is missing");

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
      { id: "template-deck", compact: "false" },
      { enabled: true },
    );
    expect(container.textContent).toContain("Investor pitch");
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Continue in chat");
    expect(container.textContent).not.toContain("Regenerate");
    expect(
      container.querySelector('[data-worker-slide="template-slide"]'),
    ).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll("a")).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["/deck/template-deck", "/chat?deckId=template-deck"]);
  });

  it("renders patch-deck previews only from the exact saved revision", async () => {
    const updatedAt = "2026-10-20T10:00:00.000Z";
    useActionQueryMock.mockReturnValue({
      data: {
        id: "patched-deck",
        title: "Updated brief",
        updatedAt,
        slideCount: 2,
        slides: [
          {
            id: "changed-slide",
            slideNumber: 2,
            layout: "content",
            content: '<div class="fmd-slide"><h1>Changed in patch</h1></div>',
          },
          {
            id: "untouched-slide",
            slideNumber: 1,
            layout: "content",
            content: '<div class="fmd-slide"><h1>Untouched</h1></div>',
          },
        ],
      },
      isPending: false,
    });
    const context: ToolRendererContext = {
      toolName: "patch-deck",
      args: { deckId: "patched-deck" },
      resultJson: {
        ok: true,
        deckId: "patched-deck",
        updatedAt,
        updatedSlideIds: ["changed-slide", "removed-slide"],
        deletedSlideIds: ["removed-slide"],
      },
      resultText: JSON.stringify({ ok: true, deckId: "patched-deck" }),
      isRunning: false,
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Patch-deck result renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(useActionQueryMock).toHaveBeenCalledWith(
      "get-deck",
      { id: "patched-deck", compact: "false" },
      { enabled: true },
    );
    expect(container.textContent).toContain("Updated brief");
    expect(container.textContent).toContain("2 slides");
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Continue in chat");
    expect(container.textContent).not.toContain("Regenerate");
    const preview = container.querySelector("[data-slides-patch-deck-preview]");
    expect(preview?.hasAttribute("inert")).toBe(true);
    expect(preview?.querySelectorAll("iframe")).toHaveLength(1);
    expect(preview?.querySelector("iframe")?.srcdoc).toContain(
      "Changed in patch",
    );
    expect(preview?.querySelector("iframe")?.srcdoc).not.toContain("Untouched");
    expect(
      Array.from(container.querySelectorAll("a")).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["/deck/patched-deck", "/chat?deckId=patched-deck"]);
  });

  it("keeps generic patch output when the saved revision cannot be verified", async () => {
    useActionQueryMock.mockReturnValue({
      data: {
        id: "patched-deck",
        title: "Later brief",
        updatedAt: "2026-10-20T10:00:01.000Z",
        slideCount: 1,
        slides: [],
      },
      isPending: false,
    });
    const result = {
      ok: true,
      deckId: "patched-deck",
      updatedAt: "2026-10-20T10:00:00.000Z",
      updatedSlideIds: ["changed-slide"],
      deletedSlideIds: [],
    };
    const context: ToolRendererContext = {
      toolName: "patch-deck",
      args: { deckId: "patched-deck" },
      resultJson: result,
      resultText: JSON.stringify(result),
      isRunning: false,
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Patch-deck result renderer is missing");

    await act(async () => {
      root.render(<Renderer context={context} />);
    });

    expect(container.querySelector("[data-action-card]")).toBeNull();
    const disclosure = container.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    );
    expect(disclosure).not.toBeNull();
    await act(async () => disclosure?.click());
    const outputButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="agentChat.tool.viewOutput"]',
    );
    expect(outputButton).not.toBeNull();
    await act(async () => outputButton?.click());
    expect(document.body.textContent).toContain('"updatedAt"');
    expect(container.textContent).not.toContain("Later brief");
  });

  it("prefers the worker preview when a source slide has HTML fallback", async () => {
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
                  content:
                    '<div class="fmd-slide"><h1>Do not mount the fallback</h1></div>',
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
        slides: [
          {
            id: "slide-worker",
            sourceTsx: "export default function Slide() { return null; }",
            revision: 2,
            sourceHash: "a".repeat(64),
          },
        ],
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
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("pins a deck result preview to the source version returned at creation", async () => {
    useActionQueryMock.mockImplementation((action: string) =>
      action === "get-slide-render"
        ? { data: undefined, isPending: false }
        : {
            data: {
              id: "deck-1",
              title: "Worker deck",
              slideCount: 2,
              slides: [
                {
                  id: "slide-worker",
                  layout: "content",
                  sourceTsx:
                    "export default function LaterSlide() { return null; }",
                  revision: 5,
                  sourceHash: "e".repeat(64),
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
        slideCount: 2,
        slides: [
          {
            id: "slide-worker",
            sourceTsx: "export default function Slide() { return null; }",
            revision: 2,
            sourceHash: "a".repeat(64),
          },
        ],
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
      container.querySelector('[data-worker-slide="slide-worker"]'),
    ).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
  });

  it("renders a source-backed preview from the fallback read after result projection", async () => {
    const sourceHash = "a".repeat(64);
    const rawResult = {
      id: "deck-1",
      title: "Worker deck",
      slideCount: 1,
      slides: [
        {
          id: "slide-worker",
          layout: "content",
          sourceTsx: "export default function Slide() { return null; }",
          revision: 2,
          sourceHash,
        },
      ],
    };
    const projectedResult = projectSlidesDeckResult(rawResult);
    expect(projectedResult).toEqual({
      id: "deck-1",
      title: "Worker deck",
      slideCount: 1,
      previews: [],
    });

    const workerArtifact = {
      protocolVersion: 1,
      deckId: "deck-1",
      slideId: "slide-worker",
      revision: 2,
      sourceHash,
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
              slides: rawResult.slides,
            },
            isPending: false,
          },
    );
    const context: ToolRendererContext = {
      toolName: "create-deck",
      args: {
        promptDraft: {
          generationContext: { originalPrompt: "Create a worker deck" },
        },
      },
      resultJson: projectedResult,
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
      2,
      "get-slide-render",
      {
        deckId: "deck-1",
        slideId: "slide-worker",
        expectedRevision: 2,
        expectedSourceHash: sourceHash,
      },
      { enabled: true },
    );
    expect(
      container.querySelector("[data-slides-worker-preview]"),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-worker-slide="slide-worker"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
    expect(
      container.querySelector('a[href="/deck/deck-1"]')?.textContent,
    ).toContain("Apply");

    const regenerateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Regenerate");
    await act(async () => regenerateButton?.click());
    expect(sendToAgentChatMock).toHaveBeenCalledWith({
      message: expect.stringContaining("Regenerate this saved deck"),
      context: JSON.stringify({
        appId: "slides-2",
        deckId: "deck-1",
        deckTitle: "Worker deck",
        originalPrompt: "Create a worker deck",
      }),
      submit: true,
      openSidebar: true,
      chatTarget: "local",
    });
  });

  const invalidSourceIdentities: Array<{
    label: string;
    identity: Record<string, unknown>;
  }> = [
    { label: "missing identity", identity: {} },
    { label: "revision only", identity: { revision: 2 } },
    { label: "source hash only", identity: { sourceHash: "a".repeat(64) } },
    {
      label: "invalid revision",
      identity: { revision: 0, sourceHash: "a".repeat(64) },
    },
    {
      label: "invalid source hash",
      identity: { revision: 2, sourceHash: "bad" },
    },
  ];

  it.each(invalidSourceIdentities)(
    "keeps source previews hidden with $label",
    async ({ identity }) => {
      useActionQueryMock.mockReturnValue({
        data: {
          id: "deck-1",
          title: "Worker deck",
          slideCount: 1,
          slides: [
            {
              id: "slide-worker",
              layout: "content",
              content:
                '<div class="fmd-slide"><h1>Unpinned source fallback</h1></div>',
              sourceTsx: "export default function Slide() { return null; }",
              ...identity,
            },
          ],
        },
        isPending: false,
      });
      const context: ToolRendererContext = {
        toolName: "create-deck",
        args: {},
        resultJson: {
          id: "deck-1",
          title: "Worker deck",
          slideCount: 2,
          slides: [
            {
              id: "slide-worker",
              layout: "content",
              content:
                '<div class="fmd-slide"><h1>Unpinned result fallback</h1></div>',
            },
          ],
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

      expect(useActionQueryMock).toHaveBeenCalledWith(
        "get-deck",
        { id: "deck-1", compact: "false" },
        { enabled: true },
      );
      expect(
        useActionQueryMock.mock.calls.some(
          ([action]) => action === "get-slide-render",
        ),
      ).toBe(false);
      expect(
        container.querySelector("[data-slides-deck-preview-strip]"),
      ).toBeNull();
      expect(container.querySelector("iframe")).toBeNull();
      expect(container.textContent).not.toContain("Unpinned source fallback");
      expect(container.textContent).not.toContain("Unpinned result fallback");
      expect(container.querySelector("[data-action-card]")).not.toBeNull();
    },
  );

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
        generationContext: {
          generationMode: "action",
          originalPrompt: "Create a launch brief",
        },
        slides: [
          {
            id: "slide-2",
            layout: "content",
            content:
              '<div class="fmd-slide"><h1>Saved slide</h1><script>untrusted</script></div>',
            contentHash: "a".repeat(64),
          },
        ],
      },
      isPending: false,
    });
    const context: ToolRendererContext = {
      toolName: "add-slide",
      args: {
        deckId: "deck/1",
        slideId: "slide-2",
        content: '<div class="fmd-slide"><h1>Saved slide</h1></div>',
        position: 1,
        generationComplete: false,
      },
      resultJson: {
        deckId: "deck/1",
        deckTitle: "Launch brief",
        slideId: "slide-2",
        slideNumber: 2,
        slideCount: 12,
        layoutFit: { contentHash: "a".repeat(64) },
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
    const previewFrame = container.querySelector(
      "[data-slides-added-slide-preview] iframe",
    );
    expect(previewFrame?.getAttribute("sandbox")).toBe("");
    expect((previewFrame as HTMLIFrameElement | null)?.srcdoc).toContain(
      "Saved slide",
    );
    expect(container.querySelector("h1")).toBeNull();
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
        originalPrompt: "Create a launch brief",
      }),
      submit: true,
      openSidebar: true,
      chatTarget: "local",
    });
  });

  it("hides an added legacy preview when the saved slide changed after the result", async () => {
    useActionQueryMock.mockReturnValueOnce({
      data: {
        id: "deck-1",
        title: "Launch brief",
        slides: [
          {
            id: "slide-2",
            slideNumber: 2,
            layout: "content",
            content: '<div class="fmd-slide"><h1>Later edit</h1></div>',
            contentHash: "b".repeat(64),
          },
        ],
      },
      isPending: false,
    });
    const context: ToolRendererContext = {
      toolName: "add-slide",
      args: { deckId: "deck-1", slideId: "slide-2" },
      resultJson: {
        deckId: "deck-1",
        deckTitle: "Launch brief",
        slideId: "slide-2",
        slideNumber: 2,
        slideCount: 2,
        layoutFit: { contentHash: "a".repeat(64) },
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

    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
    expect(
      container.querySelector("[data-slides-added-slide-preview]"),
    ).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("Later edit");
  });

  it("uses the saved slide number when the deck was reordered after adding it", async () => {
    useActionQueryMock.mockReturnValueOnce({
      data: {
        id: "deck-1",
        title: "Launch brief",
        slideCount: 6,
        generationContext: {
          generationMode: "action",
          originalPrompt: "Create a launch brief",
        },
        slides: [
          {
            id: "slide-2",
            slideNumber: 5,
            layout: "content",
            content: '<div class="fmd-slide"><h1>Saved slide</h1></div>',
          },
        ],
      },
      isPending: false,
    });
    const context: ToolRendererContext = {
      toolName: "add-slide",
      args: {},
      resultJson: {
        deckId: "deck-1",
        deckTitle: "Launch brief",
        slideId: "slide-2",
        slideNumber: 2,
        slideCount: 6,
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

    expect(container.textContent).toContain("Slide 5");
    expect(
      Array.from(container.querySelectorAll("a")).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual([
      "/deck/deck-1?slide=5",
      "/chat?deckId=deck-1&slideId=slide-2&slideNumber=5",
    ]);
    const regenerateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Regenerate");
    await act(async () => regenerateButton?.click());
    expect(sendToAgentChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: JSON.stringify({
          appId: "slides-2",
          deckId: "deck-1",
          deckTitle: "Launch brief",
          slideId: "slide-2",
          slideNumber: 5,
          originalPrompt: "Create a launch brief",
        }),
      }),
    );
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
                  content:
                    '<div class="fmd-slide"><h1>Do not mount the fallback</h1></div>',
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
        revision: 1,
        sourceHash: "b".repeat(64),
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
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
  });

  it("does not render a later source revision as an added-slide result", async () => {
    useActionQueryMock.mockImplementation((action: string) =>
      action === "get-slide-render"
        ? { data: undefined, isPending: false }
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
                  content:
                    '<div class="fmd-slide"><h1>Later saved version</h1></div>',
                  sourceTsx: "export default function Slide() { return null; }",
                  revision: 5,
                  sourceHash: "e".repeat(64),
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
        revision: 4,
        sourceHash: "d".repeat(64),
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
      2,
      "get-slide-render",
      {
        deckId: "deck-1",
        slideId: "slide-worker",
        expectedRevision: 4,
        expectedSourceHash: "d".repeat(64),
      },
      { enabled: true },
    );
    expect(container.textContent).not.toContain("Later saved version");
    expect(container.querySelector("h1")).toBeNull();
  });

  it("keeps an added source result actionable without a complete source version", async () => {
    const currentSourceHash = "e".repeat(64);
    useActionQueryMock.mockImplementation((action: string) =>
      action === "get-slide-render"
        ? {
            data: {
              protocolVersion: 1,
              deckId: "deck-1",
              slideId: "slide-worker",
              revision: 5,
              sourceHash: currentSourceHash,
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
                  sourceTsx: "export default function Slide() { return null; }",
                  revision: 5,
                  sourceHash: currentSourceHash,
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
        revision: 4,
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

    expect(container.textContent).toContain("Launch brief");
    expect(container.textContent).toContain("Apply");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/deck/deck-1?slide=1",
    );
    expect(
      useActionQueryMock.mock.calls.some(
        ([action]) => action === "get-slide-render",
      ),
    ).toBe(false);
    expect(
      container.querySelector('[data-worker-slide="slide-worker"]'),
    ).toBeNull();
  });

  it("renders a source edit preview and regenerates from the saved request", async () => {
    useActionQueryMock.mockReturnValueOnce({
      data: {
        id: "deck/1",
        title: "Launch brief",
        slideCount: 12,
        generationContext: {
          generationMode: "action",
          originalPrompt: "Create a launch brief",
        },
        slides: [
          {
            id: "slide-2",
            slideNumber: 3,
            layout: "content",
            content:
              '<div class="fmd-slide"><h1>Updated source</h1><script>untrusted</script></div>',
            sourceTsx: "export default function Slide() { return null; }",
            revision: 2,
            sourceHash: "a".repeat(64),
          },
        ],
      },
      isPending: false,
    });
    const context: ToolRendererContext = {
      toolName: "update-slide-source",
      args: {
        deckId: "deck/1",
        slideId: "slide-2",
        expectedRevision: 1,
        expectedSourceHash: "b".repeat(64),
        sourceTsx: "export default function Slide() { return null; }",
      },
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
        originalPrompt: "Create a launch brief",
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
                  content:
                    '<div class="fmd-slide"><h1>Do not mount the fallback</h1></div>',
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
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
  });

  it("does not show a later source revision as the edit result preview", async () => {
    useActionQueryMock.mockImplementation((action: string) =>
      action === "get-slide-render"
        ? { data: undefined, isPending: false }
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
                  content:
                    '<div class="fmd-slide"><h1>Later saved version</h1></div>',
                  sourceTsx: "export default function Slide() { return null; }",
                  revision: 5,
                  sourceHash: "e".repeat(64),
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
        revision: 4,
        sourceHash: "d".repeat(64),
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

    expect(useActionQueryMock).toHaveBeenNthCalledWith(
      2,
      "get-slide-render",
      {
        deckId: "deck-1",
        slideId: "slide-worker",
        expectedRevision: 4,
        expectedSourceHash: "d".repeat(64),
      },
      { enabled: true },
    );
    expect(container.textContent).not.toContain("Later saved version");
    expect(container.querySelector("h1")).toBeNull();
  });

  it("keeps an updated source result actionable without a complete source version", async () => {
    const currentSourceHash = "e".repeat(64);
    useActionQueryMock.mockImplementation((action: string) =>
      action === "get-slide-render"
        ? {
            data: {
              protocolVersion: 1,
              deckId: "deck-1",
              slideId: "slide-worker",
              revision: 5,
              sourceHash: currentSourceHash,
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
                  sourceTsx: "export default function Slide() { return null; }",
                  revision: 5,
                  sourceHash: currentSourceHash,
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
        revision: 4,
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

    expect(container.textContent).toContain("Launch brief");
    expect(container.textContent).toContain("Apply");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/deck/deck-1?slide=1",
    );
    expect(
      useActionQueryMock.mock.calls.some(
        ([action]) => action === "get-slide-render",
      ),
    ).toBe(false);
    expect(
      container.querySelector('[data-worker-slide="slide-worker"]'),
    ).toBeNull();
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
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
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

  it("renders legacy slide edit results inside an opaque-origin preview", async () => {
    const contentHash = "c".repeat(64);
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
            contentHash,
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
        contentHash,
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
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
    expect(
      container.querySelector("[data-slides-updated-slide-preview]"),
    ).not.toBeNull();
    const previewFrame = container.querySelector(
      "[data-slides-updated-slide-preview] iframe",
    );
    expect(previewFrame?.getAttribute("sandbox")).toBe("");
    expect((previewFrame as HTMLIFrameElement | null)?.srcdoc).toContain(
      "Updated",
    );
    expect(container.querySelector("h1")).toBeNull();
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/deck/deck-1?slide=4",
      "/chat?deckId=deck-1&slideId=slide-4&slideNumber=4",
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
        deckId: "deck-1",
        deckTitle: "Roadmap",
        slideId: "slide-4",
        slideNumber: 4,
      }),
      submit: true,
      openSidebar: true,
      chatTarget: "local",
    });
  });

  it("hides a legacy edit preview when the saved slide changed after the result", async () => {
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
            content: '<div class="fmd-slide"><h1>Later edit</h1></div>',
            contentHash: "d".repeat(64),
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
        contentHash: "c".repeat(64),
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
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
    expect(
      container.querySelector("[data-slides-updated-slide-preview]"),
    ).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("Later edit");
  });

  it("renders copied legacy slides inside an opaque-origin preview", async () => {
    useActionQueryMock.mockReturnValueOnce({
      data: {
        id: "target-deck",
        title: "Launch brief",
        slideCount: 4,
        updatedAt: "2026-10-20T10:00:00.000Z",
        slides: [
          {
            id: "copied-slide",
            slideNumber: 3,
            layout: "statement",
            content: '<div class="fmd-slide"><h1>Copied content</h1></div>',
          },
        ],
      },
      isPending: false,
    });
    const context: ToolRendererContext = {
      toolName: "copy-slide-to-deck",
      args: {},
      resultJson: {
        deckId: "target-deck",
        slideId: "copied-slide",
        updatedAt: "2026-10-20T10:00:00.000Z",
        updatedSlideIds: ["copied-slide"],
      },
      isRunning: false,
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Copied slide result renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(useActionQueryMock).toHaveBeenCalledWith(
      "get-deck",
      { id: "target-deck", slideId: "copied-slide", compact: "false" },
      { enabled: true },
    );
    expect(container.textContent).toContain("Launch brief");
    expect(container.textContent).toContain("Slide 3");
    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
    expect(container.textContent).toContain("Continue in chat");
    const previewFrame = container.querySelector(
      "[data-slides-updated-slide-preview] iframe",
    );
    expect(previewFrame?.getAttribute("sandbox")).toBe("");
    expect((previewFrame as HTMLIFrameElement | null)?.srcdoc).toContain(
      "Copied content",
    );
    expect(container.querySelector("h1")).toBeNull();
    expect(
      Array.from(container.querySelectorAll("a")).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual([
      "/deck/target-deck?slide=3",
      "/chat?deckId=target-deck&slideId=copied-slide&slideNumber=3",
    ]);
  });

  it("hides a copied legacy preview when the destination deck changed afterward", async () => {
    useActionQueryMock.mockReturnValueOnce({
      data: {
        id: "target-deck",
        title: "Launch brief",
        updatedAt: "2026-10-20T10:00:01.000Z",
        slides: [
          {
            id: "copied-slide",
            slideNumber: 3,
            layout: "statement",
            content: '<div class="fmd-slide"><h1>Later edit</h1></div>',
          },
        ],
      },
      isPending: false,
    });
    const context: ToolRendererContext = {
      toolName: "copy-slide-to-deck",
      args: {},
      resultJson: {
        deckId: "target-deck",
        slideId: "copied-slide",
        updatedAt: "2026-10-20T10:00:00.000Z",
        updatedSlideIds: ["copied-slide"],
      },
      isRunning: false,
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Copied slide result renderer is missing");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <Renderer context={context} />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Apply");
    expect(container.textContent).toContain("Regenerate");
    expect(
      container.querySelector("[data-slides-updated-slide-preview]"),
    ).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("Later edit");
  });

  it("renders copied source slides through the sandboxed worker", async () => {
    const sourceHash = "a".repeat(64);
    useActionQueryMock.mockImplementation((action: string) =>
      action === "get-slide-render"
        ? {
            data: {
              protocolVersion: 1,
              deckId: "target-deck",
              slideId: "copied-slide",
              revision: 1,
              sourceHash,
              width: 1920,
              height: 1080,
              html: "<div>Sandboxed copied slide</div>",
            },
            isPending: false,
          }
        : {
            data: {
              id: "target-deck",
              title: "Launch brief",
              slides: [
                {
                  id: "copied-slide",
                  slideNumber: 3,
                  sourceTsx: "export default function Slide() { return null; }",
                  revision: 1,
                  sourceHash,
                },
              ],
            },
            isPending: false,
          },
    );
    const context: ToolRendererContext = {
      toolName: "copy-slide-to-deck",
      args: {},
      resultJson: {
        deckId: "target-deck",
        slideId: "copied-slide",
        updatedAt: "2026-10-20T10:00:00.000Z",
        updatedSlideIds: ["copied-slide"],
        revision: 1,
        sourceHash,
      },
      isRunning: false,
    };
    const Renderer = resolveToolRenderer(context);
    if (!Renderer) throw new Error("Copied slide result renderer is missing");

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
        deckId: "target-deck",
        slideId: "copied-slide",
        expectedRevision: 1,
        expectedSourceHash: sourceHash,
      },
      { enabled: true },
    );
    expect(
      container.querySelector('[data-worker-slide="copied-slide"]'),
    ).not.toBeNull();
    expect(container.querySelector("h1")).toBeNull();
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
  describe("Slides view-screen result card", () => {
    const activeSourceSlideResult = [
      "## Current Screen",
      "view: editor",
      "deckId: deck/1            ← use this as deckId",
      "currentSlideNumber: 2 of 4   (1-based; matches the UI)",
      "currentSlideId: slide-2   ← use this for update-slide-source --slideId",
      `currentSlideContentHash: ${"a".repeat(64)}   (preview hash only; read get-slide-source for its revision)`,
      "currentSlideSourceRevision: 4",
      `currentSlideSourceHash: ${"c".repeat(64)}`,
    ].join("\n");

    it("projects only safe IDs and the selected slide number", () => {
      expect(projectSlidesViewScreenResult(activeSourceSlideResult)).toEqual({
        deckId: "deck/1",
        slideId: "slide-2",
        slideNumber: 2,
        revision: 4,
        sourceHash: "c".repeat(64),
      });
    });

    it("projects a legacy slide using its current content hash", () => {
      const legacyResult = [
        "view: editor",
        "deckId: deck/1            ← use this as deckId",
        "currentSlideNumber: 4 of 12   (1-based; matches the UI)",
        "currentSlideId: slide-legacy   ← use this for update-slide --slideId",
        `currentSlideContentHash: ${"b".repeat(64)} ← baseContentHash for update-slide`,
      ].join("\n");

      expect(projectSlidesViewScreenResult(legacyResult)).toEqual({
        deckId: "deck/1",
        slideId: "slide-legacy",
        slideNumber: 4,
        contentHash: "b".repeat(64),
      });
      expect(
        projectSlidesViewScreenResult({
          deckId: "deck/1",
          slideId: "slide-legacy",
          slideNumber: 4,
          contentHash: "b".repeat(64),
        }),
      ).toEqual({
        deckId: "deck/1",
        slideId: "slide-legacy",
        slideNumber: 4,
        contentHash: "b".repeat(64),
      });
    });

    it.each([
      ["home", "view: list\nhomeTab: recent\n### All decks"],
      [
        "empty deck",
        "view: editor\ndeckId: deck-1\ncurrentSlideNumber: 1 of 0\ncurrentSlideId: (no slide for slide number 1)",
      ],
      [
        "inaccessible deck",
        "view: editor\ndeckId: deck-1  (NOT FOUND in database)",
      ],
      ["failed inspection", "Unable to inspect the current screen."],
    ])("keeps %s output on the generic path", (_name, output) => {
      expect(projectSlidesViewScreenResult(output)).toBeNull();
    });

    it("keeps a successful home inspection in the unchanged generic output", async () => {
      const result = "view: list\nhomeTab: recent\n### All decks";
      expect(projectSlidesViewScreenResult(result)).toBeNull();
      const chatUI = projectSlidesViewScreenResult(result)
        ? { renderer: SLIDES_VIEW_SCREEN_RESULT_RENDERER }
        : undefined;

      await act(async () => {
        root.render(
          <ToolCallDisplay
            toolName="view-screen"
            args={{}}
            result={result}
            chatUI={chatUI}
            isRunning={false}
          />,
        );
      });

      const disclosure = container.querySelector(
        "button[aria-expanded]",
      ) as HTMLButtonElement | null;
      expect(disclosure).not.toBeNull();
      await act(async () => disclosure?.click());

      const outputButton = container.querySelector(
        'button[aria-label="agentChat.tool.viewOutput"]',
      ) as HTMLButtonElement | null;
      expect(outputButton).not.toBeNull();
      await act(async () => outputButton?.click());

      expect(document.body.textContent).toContain("view: list");
      expect(document.body.textContent).toContain("homeTab: recent");
      expect(document.body.textContent).toContain("### All decks");
      expect(container.querySelector("[data-action-card]")).toBeNull();
      expect(useActionQueryMock).not.toHaveBeenCalled();
    });

    it("rejects incomplete or invalid source identity", () => {
      expect(
        projectSlidesViewScreenResult({
          deckId: "deck-1",
          slideId: "slide-1",
          slideNumber: 1,
        }),
      ).toBeNull();
      expect(
        projectSlidesViewScreenResult({
          deckId: "deck-1",
          slideId: "slide-1",
          slideNumber: 1,
          revision: 4,
          sourceHash: "not-a-source-hash",
        }),
      ).toBeNull();
      expect(
        projectSlidesViewScreenResult({
          deckId: "deck-1",
          slideId: "slide-1",
          slideNumber: 1,
          revision: 0,
          sourceHash: "c".repeat(64),
        }),
      ).toBeNull();
      expect(
        projectSlidesViewScreenResult({
          deckId: "deck-1",
          slideId: "slide-1",
          slideNumber: 1,
          contentHash: "not-a-content-hash",
        }),
      ).toBeNull();
      expect(
        projectSlidesViewScreenResult({
          deckId: "deck-1",
          slideId: "slide-1",
          slideNumber: 1,
          contentHash: "b".repeat(64),
          revision: 4,
          sourceHash: "c".repeat(64),
        }),
      ).toBeNull();
    });

    it("renders the inspected source slide through the sandbox and links to it", async () => {
      const sourceHash = "c".repeat(64);
      useActionQueryMock.mockImplementation((action: string) =>
        action === "get-slide-render"
          ? {
              data: {
                protocolVersion: 1,
                deckId: "deck/1",
                slideId: "slide-2",
                revision: 4,
                sourceHash,
                width: 1920,
                height: 1080,
                html: "<div>Sandboxed slide</div>",
              },
              isPending: false,
            }
          : {
              data: {
                id: "deck/1",
                title: "Launch brief",
                slideCount: 4,
                slides: [
                  {
                    id: "slide-2",
                    slideNumber: 2,
                    layout: "content",
                    content:
                      '<div class="fmd-slide"><h1>Do not mount this HTML</h1><script>unsafe</script></div>',
                    sourceTsx:
                      "export default function Slide() { return null; }",
                    revision: 4,
                    sourceHash,
                  },
                ],
              },
              isPending: false,
            },
      );
      const context: ToolRendererContext = {
        toolName: "view-screen",
        args: {},
        resultJson: {
          deckId: "deck/1",
          slideId: "slide-2",
          slideNumber: 2,
          revision: 4,
          sourceHash,
        },
        isRunning: false,
        chatUI: { renderer: SLIDES_VIEW_SCREEN_RESULT_RENDERER },
      };
      const Renderer = resolveToolRenderer(context);
      if (!Renderer) throw new Error("View-screen result renderer is missing");

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
          expectedSourceHash: sourceHash,
        },
        { enabled: true },
      );
      expect(
        container.querySelector("[data-slides-view-screen-preview]"),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-worker-slide="slide-2"]'),
      ).not.toBeNull();
      expect(container.querySelector("h1")).toBeNull();
      expect(container.querySelector("script")).toBeNull();
      expect(container.textContent).toContain("Launch brief");
      expect(container.textContent).toContain("Slide 2");
      expect(container.textContent).toContain("Open deck");
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "/deck/deck%2F1?slide=2",
      );
    });

    it("renders a matching legacy HTML slide through the sandbox", async () => {
      const contentHash = "b".repeat(64);
      const legacyResult = [
        "view: editor",
        "deckId: deck/1",
        "currentSlideNumber: 4 of 12   (1-based; matches the UI)",
        "currentSlideId: slide-legacy",
        `currentSlideContentHash: ${contentHash} ← baseContentHash for update-slide`,
      ].join("\n");
      const result = projectSlidesViewScreenResult(legacyResult);
      if (!result)
        throw new Error("Legacy view-screen result was not projected");

      useActionQueryMock.mockReturnValueOnce({
        data: {
          id: "deck/1",
          title: "Imported brief",
          slideCount: 12,
          slides: [
            {
              id: "slide-legacy",
              slideNumber: 4,
              layout: "content",
              content:
                '<div class="fmd-slide"><h1>Saved legacy slide</h1><script>unsafe()</script></div>',
              contentHash,
            },
          ],
        },
        isPending: false,
      });
      const context: ToolRendererContext = {
        toolName: "view-screen",
        args: {},
        resultJson: result,
        isRunning: false,
        chatUI: { renderer: SLIDES_VIEW_SCREEN_RESULT_RENDERER },
      };
      const Renderer = resolveToolRenderer(context);
      if (!Renderer) throw new Error("View-screen result renderer is missing");

      await act(async () => {
        root.render(
          <MemoryRouter>
            <Renderer context={context} />
          </MemoryRouter>,
        );
      });

      expect(useActionQueryMock).toHaveBeenCalledTimes(1);
      expect(useActionQueryMock).toHaveBeenCalledWith(
        "get-deck",
        { id: "deck/1", slideId: "slide-legacy", compact: "false" },
        { enabled: true },
      );
      const preview = container.querySelector(
        "[data-slides-view-screen-preview]",
      );
      expect(preview?.hasAttribute("inert")).toBe(true);
      const previewFrame = preview?.querySelector("iframe");
      expect(previewFrame?.getAttribute("sandbox")).toBe("");
      expect((previewFrame as HTMLIFrameElement | null)?.srcdoc).toContain(
        "Saved legacy slide",
      );
      expect((previewFrame as HTMLIFrameElement | null)?.srcdoc).not.toContain(
        "unsafe()",
      );
      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("h1")).toBeNull();
      expect(container.textContent).toContain("Slide 4");
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "/deck/deck%2F1?slide=4",
      );
    });

    it("does not preview legacy HTML that changed after inspection", async () => {
      const inspectedContentHash = "b".repeat(64);
      useActionQueryMock.mockReturnValueOnce({
        data: {
          id: "deck-1",
          title: "Imported brief",
          slideCount: 1,
          slides: [
            {
              id: "slide-1",
              slideNumber: 1,
              layout: "content",
              content: '<div class="fmd-slide"><h1>Newer slide</h1></div>',
              contentHash: "d".repeat(64),
            },
          ],
        },
        isPending: false,
      });
      const context: ToolRendererContext = {
        toolName: "view-screen",
        args: {},
        resultJson: {
          deckId: "deck-1",
          slideId: "slide-1",
          slideNumber: 1,
          contentHash: inspectedContentHash,
        },
        isRunning: false,
        chatUI: { renderer: SLIDES_VIEW_SCREEN_RESULT_RENDERER },
      };
      const Renderer = resolveToolRenderer(context);
      if (!Renderer) throw new Error("View-screen result renderer is missing");

      await act(async () => {
        root.render(
          <MemoryRouter>
            <Renderer context={context} />
          </MemoryRouter>,
        );
      });

      expect(
        container.querySelector("[data-slides-view-screen-preview]"),
      ).toBeNull();
      expect(container.querySelector("iframe")).toBeNull();
      expect(container.textContent).toContain("Open deck");
    });

    it("pins the preview read to the source version inspected earlier", async () => {
      const inspectedSourceHash = "c".repeat(64);
      useActionQueryMock.mockImplementation((action: string) =>
        action === "get-slide-render"
          ? { data: undefined, isPending: false }
          : {
              data: {
                id: "deck-1",
                title: "Updated deck",
                slides: [
                  {
                    id: "slide-1",
                    sourceTsx:
                      "export default function Slide() { return null; }",
                    revision: 5,
                    sourceHash: "d".repeat(64),
                  },
                ],
              },
              isPending: false,
            },
      );
      const context: ToolRendererContext = {
        toolName: "view-screen",
        args: {},
        resultJson: {
          deckId: "deck-1",
          slideId: "slide-1",
          slideNumber: 1,
          revision: 4,
          sourceHash: inspectedSourceHash,
        },
        isRunning: false,
        chatUI: { renderer: SLIDES_VIEW_SCREEN_RESULT_RENDERER },
      };
      const Renderer = resolveToolRenderer(context);
      if (!Renderer) throw new Error("View-screen result renderer is missing");

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
          slideId: "slide-1",
          expectedRevision: 4,
          expectedSourceHash: inspectedSourceHash,
        },
        { enabled: true },
      );
      expect(container.querySelector("[data-worker-slide]")).toBeNull();
      expect(container.textContent).toContain("Updated deck");
    });

    it("keeps failed view-screen actions in the generic tool output", async () => {
      await act(async () => {
        root.render(
          <ToolCallDisplay
            toolName="view-screen"
            args={{}}
            result="Unable to inspect the current screen."
            chatUI={{ renderer: SLIDES_VIEW_SCREEN_RESULT_RENDERER }}
            isRunning={false}
            isError
          />,
        );
      });

      const disclosure = container.querySelector("button");
      expect(disclosure).not.toBeNull();
      await act(async () => disclosure?.click());

      expect(container.textContent).toContain(
        "Unable to inspect the current screen.",
      );
      expect(container.querySelector("[data-action-card]")).toBeNull();
      expect(useActionQueryMock).not.toHaveBeenCalled();
    });
  });
});
