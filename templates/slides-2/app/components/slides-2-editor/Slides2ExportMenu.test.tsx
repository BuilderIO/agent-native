// @vitest-environment happy-dom
import { DEFAULT_SLIDE_DESIGN_TOKENS } from "@shared/slide-design-tokens";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { exportDeckAsPdf } from "@/lib/export-pdf-client";
import {
  buildDeckPptxBlob,
  exportDeckAsImagePptx,
  exportDeckAsPptx,
} from "@/lib/export-pptx-client";
import * as standaloneHtml from "@/lib/standalone-html";

import { renderSlideArtifactInSandbox } from "../slides-2-runtime/SandboxedSlide";
import {
  Slides2ExportMenu,
  type Slides2ExportMenuHandle,
} from "./Slides2ExportMenu";

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useActionMutation: () => ({ mutateAsync: mocks.mutateAsync }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) => {
    const translatedKey = key.split(".").at(-1) ?? key;
    return options?.slideNumber
      ? `${translatedKey} ${options.slideNumber}`
      : translatedKey;
  },
}));

vi.mock("@/lib/export-pdf-client", () => ({
  exportDeckAsPdf: vi.fn(),
}));

vi.mock("@/lib/export-pptx-client", () => ({
  buildDeckPptxBlob: vi.fn(),
  exportDeckAsImagePptx: vi.fn(),
  exportDeckAsPptx: vi.fn(),
}));

vi.mock("../slides-2-runtime/SandboxedSlide", () => ({
  renderSlideArtifactInSandbox: vi.fn(),
}));

afterEach(() => {
  cleanup();
  mocks.mutateAsync.mockReset();
  mocks.callAction.mockReset();
  vi.mocked(exportDeckAsPdf).mockReset();
  vi.mocked(buildDeckPptxBlob).mockReset();
  vi.mocked(exportDeckAsImagePptx).mockReset();
  vi.mocked(exportDeckAsPptx).mockReset();
  vi.mocked(renderSlideArtifactInSandbox).mockReset();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}

describe("Slides2ExportMenu", () => {
  it("opens by keyboard and closes with Escape", async () => {
    render(
      <Slides2ExportMenu
        deckId="deck-1"
        title="Quarterly Review"
        slides={[{ id: "slide-1" }]}
        onBeforeExport={async () => true}
      />,
    );

    const trigger = screen.getByRole("button", { name: "export" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const menu = await screen.findByRole("menu");
    expect(screen.getByRole("menuitem", { name: "downloadHtml" })).toBeTruthy();
    fireEvent.keyDown(menu, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("exports image-based PPTX from the menu and cleans its render stage", async () => {
    mocks.callAction.mockResolvedValue({
      slides: [{ id: "slide-1", content: "<h1>Slide</h1>", notes: "Notes" }],
    });
    let stageRenderedDuringExport = false;
    vi.mocked(exportDeckAsImagePptx).mockImplementation(
      async (_title, _slides, _aspectRatio, _analytics, renderRoot) => {
        stageRenderedDuringExport = Boolean(
          renderRoot?.querySelector('[data-slide-canvas="slide-1"] h1'),
        );
      },
    );

    render(
      <Slides2ExportMenu
        deckId="deck-1"
        title="Quarterly Review"
        slides={[{ id: "slide-1" }]}
        aspectRatio="16:9"
        onBeforeExport={async () => true}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "export" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "exportPptxAsImages" }),
    );

    await waitFor(() => expect(exportDeckAsImagePptx).toHaveBeenCalledOnce());
    expect(exportDeckAsImagePptx).toHaveBeenCalledWith(
      "Quarterly Review",
      [{ id: "slide-1", notes: "Notes" }],
      "16:9",
      { deckId: "deck-1" },
      expect.any(HTMLDivElement),
    );
    expect(stageRenderedDuringExport).toBe(true);
    expect(document.querySelector("[data-pdf-export-stage]")).toBeNull();
  });

  it("disables every export choice while an export is in progress", async () => {
    const pendingExport = deferred<{ html: string; filename: string }>();
    mocks.mutateAsync.mockReturnValue(pendingExport.promise);
    const ref = createRef<Slides2ExportMenuHandle>();

    render(
      <Slides2ExportMenu
        ref={ref}
        deckId="deck-1"
        title="Quarterly Review"
        slides={[{ id: "slide-1" }]}
        onBeforeExport={async () => true}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "export" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    await screen.findByRole("menu");

    let exportPromise!: Promise<void>;
    await act(async () => {
      exportPromise = ref.current!.run("html");
      await Promise.resolve();
    });

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(
      document.querySelectorAll('[role="menuitem"][aria-disabled="true"]'),
    ).toHaveLength(5);

    await act(async () => {
      pendingExport.reject(new Error("export failed"));
      await exportPromise;
    });
  });

  it("exports the selected PDF deck and removes its render stage", async () => {
    mocks.callAction.mockResolvedValue({
      slides: [{ id: "slide-1", content: "<h1>Slide</h1>", notes: "Notes" }],
    });
    let stageRenderedDuringExport = false;
    vi.mocked(exportDeckAsPdf).mockImplementation(async () => {
      stageRenderedDuringExport = Boolean(
        document.querySelector(
          '[data-pdf-export-stage] [data-slide-canvas="slide-1"]',
        ),
      );
    });
    const onBeforeExport = vi.fn(async () => true);

    render(
      <Slides2ExportMenu
        deckId="deck-1"
        title="Quarterly Review"
        slides={[{ id: "slide-1" }]}
        aspectRatio="16:9"
        onBeforeExport={onBeforeExport}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "export" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "exportPdf" }));

    await waitFor(() => expect(exportDeckAsPdf).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(document.querySelector("[data-pdf-export-stage]")).toBeNull(),
    );

    expect(onBeforeExport).toHaveBeenCalledOnce();
    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-deck",
      { id: "deck-1", slideIds: ["slide-1"], compact: "false" },
      { method: "GET" },
    );
    expect(exportDeckAsPdf).toHaveBeenCalledWith(
      "Quarterly Review",
      [{ id: "slide-1", content: expect.any(String), notes: "Notes" }],
      "16:9",
    );
    expect(stageRenderedDuringExport).toBe(true);
    expect(document.querySelector("[data-pdf-export-stage]")).toBeNull();
  });

  it("hides the inert close control while an export is running", async () => {
    const pendingExport = deferred<{ html: string; filename: string }>();
    mocks.mutateAsync.mockReturnValue(pendingExport.promise);

    const ref = createRef<Slides2ExportMenuHandle>();
    render(
      <Slides2ExportMenu
        ref={ref}
        deckId="deck-1"
        title="Quarterly Review"
        slides={[{ id: "slide-1" }]}
        onBeforeExport={async () => true}
      />,
    );

    let exportPromise!: Promise<void>;
    await act(async () => {
      exportPromise = ref.current!.run("html");
      await Promise.resolve();
    });

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();

    await act(async () => {
      pendingExport.reject(new Error("export failed"));
      await exportPromise;
    });
  });

  it("shows a safe error when the HTML Worker fallback cannot load the deck", async () => {
    const error = Object.assign(new Error("Action export-html failed"), {
      errorCode: "source_runtime_export_required",
      actionMessage: "Private source details should not be shown.",
    });
    mocks.mutateAsync.mockRejectedValue(error);
    mocks.callAction.mockResolvedValue({ slides: [] });

    const ref = createRef<Slides2ExportMenuHandle>();
    render(
      <Slides2ExportMenu
        ref={ref}
        deckId="deck-1"
        title="Quarterly Review"
        slides={[{ id: "slide-1" }]}
        onBeforeExport={async () => true}
      />,
    );

    await act(async () => {
      await ref.current!.run("html");
    });

    expect(screen.getAllByText("exportFailed")).toHaveLength(2);
    expect(
      screen.queryByText("Private source details should not be shown."),
    ).toBeNull();
  });

  it("downloads a standalone HTML file with Worker slide styles and assets", async () => {
    const artifact = {
      protocolVersion: 1,
      deckId: "deck-1",
      slideId: "source-slide",
      revision: 1,
      sourceHash: "c".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      assetOrigins: ["https://cdn.example.test"],
      designTokens: DEFAULT_SLIDE_DESIGN_TOKENS,
      runtime: {
        kind: "agent-native-slides-react-worker-v1",
        workerSource: "self.onmessage = () => {};",
        page: { current: 2, total: 2 },
        assetUrls: {},
        styles: ["#slide-root h1 { color: var(--deck-accent); }"],
        design: {
          palette: {
            bg: DEFAULT_SLIDE_DESIGN_TOKENS.background,
            text: DEFAULT_SLIDE_DESIGN_TOKENS.text,
            accent: DEFAULT_SLIDE_DESIGN_TOKENS.accent,
          },
          fonts: {
            display: DEFAULT_SLIDE_DESIGN_TOKENS.displayFont,
            body: DEFAULT_SLIDE_DESIGN_TOKENS.bodyFont,
          },
          typeScale: { hero: 72, body: 24 },
          radius: 12,
        },
        timeoutMs: 2500,
      },
    };
    mocks.mutateAsync.mockRejectedValue(
      Object.assign(new Error("source slide needs Worker rendering"), {
        errorCode: "source_runtime_export_required",
      }),
    );
    mocks.callAction.mockImplementation((actionName: string) =>
      actionName === "get-deck"
        ? Promise.resolve({
            designSystemId: "ds-1",
            designTokens: DEFAULT_SLIDE_DESIGN_TOKENS,
            slides: [
              {
                id: "legacy-slide",
                content:
                  "<style>h2 { color: var(--deck-accent); }</style><h2>Legacy</h2>",
                background: "bg-slate-900",
              },
              {
                id: "source-slide",
                content: "",
                sourceTsx:
                  "export default function Slide() { return <main />; }",
              },
            ],
          })
        : actionName === "get-design-system"
          ? Promise.resolve({
              id: "ds-1",
              title: "Acme",
              data: JSON.stringify({
                colors: { accent: "#654321", text: "#111111" },
                typography: { headingFont: "Georgia" },
              }),
            })
          : Promise.resolve(artifact),
    );
    vi.mocked(renderSlideArtifactInSandbox).mockResolvedValue({
      deckId: "deck-1",
      slideId: "source-slide",
      revision: 1,
      sourceHash: artifact.sourceHash,
      width: 1920,
      height: 1080,
      html: '<main><img src="https://cdn.example.test/cover.png"><h1>Rendered source</h1></main>',
      styles: artifact.runtime.styles,
      assetUrls: {},
      assetOrigins: artifact.assetOrigins,
      fontOrigins: [],
      fontAssets: [],
      design: artifact.runtime.design,
      designTokens: artifact.designTokens,
      stepCount: 0,
    });
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:html");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(window, "setTimeout").mockReturnValue(
      null as unknown as ReturnType<typeof window.setTimeout>,
    );
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    let downloadedBlob: Blob | undefined;
    createObjectUrl.mockImplementation((blob) => {
      downloadedBlob = blob as Blob;
      return "blob:html";
    });

    const ref = createRef<Slides2ExportMenuHandle>();
    render(
      <Slides2ExportMenu
        ref={ref}
        deckId="deck-1"
        title="Quarterly Review"
        slides={[{ id: "legacy-slide" }, { id: "source-slide" }]}
        aspectRatio="16:9"
        onBeforeExport={async () => true}
      />,
    );

    await act(async () => {
      await ref.current!.run("html");
    });

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-pdf-export-stage]")).toBeNull();
    const html = await downloadedBlob!.text();
    const sourceSection = html.match(
      /<section class="slide"[^>]*data-standalone-slide-root="1"[\s\S]*?<\/section>/,
    )?.[0];
    expect(html).toContain("Legacy");
    expect(html).toContain("Rendered source");
    expect(html).toContain("https://cdn.example.test/cover.png");
    expect(html).toContain("--deck-bg:");
    expect(html).toContain("--slides2-bg:");
    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-design-system",
      { id: "ds-1", deckId: "deck-1", compact: "true" },
      { method: "GET" },
    );
    expect(html).toContain("--ds-accent: #654321");
    expect(html).toContain(
      '<style data-slide-style="0">[data-standalone-slide-root="0"] h2',
    );
    expect(html).toContain(
      '<style data-slide-style="1">[data-standalone-slide-root="1"] h1',
    );
    expect(html).not.toContain("data-pdf-slide-root");
    expect(sourceSection).not.toContain("<style");
  });

  it("cleans the render stage and skips download when HTML assembly fails", async () => {
    const artifact = {
      protocolVersion: 1,
      deckId: "deck-1",
      slideId: "slide-1",
      revision: 1,
      sourceHash: "d".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      runtime: {
        kind: "agent-native-slides-react-worker-v1",
        workerSource: "self.onmessage = () => {};",
        page: { current: 1, total: 1 },
        assetUrls: {},
        styles: [],
        timeoutMs: 2500,
      },
    };
    mocks.mutateAsync.mockRejectedValue(
      Object.assign(new Error("source slide needs Worker rendering"), {
        errorCode: "source_runtime_export_required",
      }),
    );
    mocks.callAction.mockImplementation((actionName: string) =>
      actionName === "get-deck"
        ? Promise.resolve({
            slides: [
              {
                id: "slide-1",
                content: "",
                sourceTsx:
                  "export default function Slide() { return <main />; }",
              },
            ],
          })
        : Promise.resolve(artifact),
    );
    vi.mocked(renderSlideArtifactInSandbox).mockResolvedValue({
      deckId: "deck-1",
      slideId: "slide-1",
      revision: 1,
      sourceHash: artifact.sourceHash,
      width: 1920,
      height: 1080,
      html: "<main>Rendered</main>",
      styles: [],
      assetUrls: {},
      assetOrigins: [],
      stepCount: 0,
    });
    const buildHtml = vi
      .spyOn(standaloneHtml, "buildStandaloneHtml")
      .mockImplementation(() => {
        throw new Error("assembly failed");
      });
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    const ref = createRef<Slides2ExportMenuHandle>();
    render(
      <Slides2ExportMenu
        ref={ref}
        deckId="deck-1"
        title="Quarterly Review"
        slides={[{ id: "slide-1" }]}
        onBeforeExport={async () => true}
      />,
    );

    await act(async () => {
      await ref.current!.run("html");
    });

    expect(buildHtml).toHaveBeenCalledOnce();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(document.querySelector("[data-pdf-export-stage]")).toBeNull();
    expect(screen.getAllByText("exportFailed")).toHaveLength(2);
  });

  it("shows the safe slide-specific message for unavailable PPTX images", async () => {
    const actionMessage =
      "Cannot export PowerPoint: an image on slide 2 could not be loaded. No file was created.";
    const error = Object.assign(new Error("Action export-pptx failed"), {
      errorCode: "pptx_image_unavailable",
      details: { slideNumber: 2 },
    });
    mocks.mutateAsync.mockRejectedValue(error);

    const ref = createRef<Slides2ExportMenuHandle>();
    render(
      <Slides2ExportMenu
        ref={ref}
        deckId="deck-1"
        title="Quarterly Review"
        slides={[{ id: "slide-1" }, { id: "slide-2" }]}
        onBeforeExport={async () => true}
      />,
    );

    await act(async () => {
      await ref.current!.run("pptx");
    });

    expect(screen.getByText("pptxImageUnavailable 2")).toBeTruthy();
    expect(screen.queryByText(actionMessage)).toBeNull();
  });

  it("uses the browser exporter when source-only slides require Worker rendering", async () => {
    const artifact = {
      protocolVersion: 1,
      deckId: "deck-1",
      slideId: "slide-1",
      revision: 1,
      sourceHash: "a".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      runtime: {
        kind: "agent-native-slides-react-worker-v1",
        workerSource: "self.onmessage = () => {};",
        page: { current: 1, total: 1 },
        assetUrls: {},
        styles: [],
        timeoutMs: 2500,
      },
    };
    mocks.mutateAsync.mockRejectedValue(
      Object.assign(new Error("source slide needs Worker rendering"), {
        errorCode: "source_runtime_export_required",
      }),
    );
    mocks.callAction.mockImplementation((actionName: string) =>
      actionName === "get-deck"
        ? Promise.resolve({
            slides: [
              {
                id: "slide-1",
                content: "",
                sourceTsx:
                  "export default function Slide() { return <main />; }",
              },
            ],
          })
        : Promise.resolve(artifact),
    );
    vi.mocked(renderSlideArtifactInSandbox).mockResolvedValue({
      deckId: "deck-1",
      slideId: "slide-1",
      revision: 1,
      sourceHash: artifact.sourceHash,
      width: 1920,
      height: 1080,
      html: "<h1>Rendered slide</h1>",
      styles: [],
      assetUrls: {},
      assetOrigins: [],
      stepCount: 0,
    });
    vi.mocked(exportDeckAsPptx).mockResolvedValue({ blankShapes: 0 });

    const ref = createRef<Slides2ExportMenuHandle>();
    render(
      <Slides2ExportMenu
        ref={ref}
        deckId="deck-1"
        title="Quarterly Review"
        slides={[{ id: "slide-1" }]}
        aspectRatio="16:9"
        onBeforeExport={async () => true}
      />,
    );

    await act(async () => {
      await ref.current!.run("pptx");
    });

    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-slide-render",
      { deckId: "deck-1", slideId: "slide-1" },
      { method: "GET" },
    );
    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-deck",
      { id: "deck-1", slideIds: ["slide-1"], compact: "false" },
      { method: "GET" },
    );
    expect(exportDeckAsPptx).toHaveBeenCalledWith(
      "Quarterly Review",
      [{ id: "slide-1" }],
      "16:9",
      { deckId: "deck-1" },
    );
    expect(document.querySelector("[data-pdf-export-stage]")).toBeNull();
  });

  it("builds a Google Slides PPTX in the browser for source-only slides", async () => {
    const artifact = {
      protocolVersion: 1,
      deckId: "deck-1",
      slideId: "slide-1",
      revision: 1,
      sourceHash: "c".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      runtime: {
        kind: "agent-native-slides-react-worker-v1",
        workerSource: "self.onmessage = () => {};",
        page: { current: 1, total: 1 },
        assetUrls: {},
        styles: [],
        timeoutMs: 2500,
      },
    };
    mocks.mutateAsync.mockRejectedValue(
      Object.assign(new Error("source slide requires Worker rendering"), {
        errorCode: "source_runtime_export_required",
      }),
    );
    mocks.callAction.mockImplementation((actionName: string) =>
      actionName === "get-deck"
        ? Promise.resolve({
            slides: [
              {
                id: "slide-1",
                content: "",
                sourceTsx:
                  "export default function Slide() { return <main />; }",
              },
            ],
          })
        : Promise.resolve(artifact),
    );
    vi.mocked(renderSlideArtifactInSandbox).mockResolvedValue({
      deckId: "deck-1",
      slideId: "slide-1",
      revision: 1,
      sourceHash: artifact.sourceHash,
      width: 1920,
      height: 1080,
      html: "<h1>Rendered source slide</h1>",
      styles: [],
      assetUrls: {},
      assetOrigins: [],
      stepCount: 0,
    });
    vi.mocked(buildDeckPptxBlob).mockResolvedValue({
      blob: new Blob(["pptx"]),
      filename: "quarterly-review.pptx",
      blankShapes: 0,
    });
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:pptx");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(window, "setTimeout").mockReturnValue(
      null as unknown as ReturnType<typeof window.setTimeout>,
    );
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    const ref = createRef<Slides2ExportMenuHandle>();
    render(
      <Slides2ExportMenu
        ref={ref}
        deckId="deck-1"
        title="Quarterly Review"
        slides={[{ id: "slide-1" }]}
        aspectRatio="16:9"
        onBeforeExport={async () => true}
      />,
    );

    await act(async () => {
      await ref.current!.run("google-slides");
    });

    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-slide-render",
      { deckId: "deck-1", slideId: "slide-1" },
      { method: "GET" },
    );
    expect(buildDeckPptxBlob).toHaveBeenCalledWith(
      "Quarterly Review",
      [{ id: "slide-1" }],
      "16:9",
      { target: "google-slides" },
    );
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(screen.getByText("googleSlidesDownloaded")).toBeTruthy();
    expect(document.querySelector("[data-pdf-export-stage]")).toBeNull();
  });

  it("keeps legacy slides static in editable PPTX fallback for mixed decks", async () => {
    const artifact = {
      protocolVersion: 1,
      deckId: "deck-1",
      slideId: "source-1",
      revision: 1,
      sourceHash: "b".repeat(64),
      width: 1920,
      height: 1080,
      html: "",
      runtime: {
        kind: "agent-native-slides-react-worker-v1",
        workerSource: "self.onmessage = () => {};",
        page: { current: 2, total: 2 },
        assetUrls: {},
        styles: [],
        timeoutMs: 2500,
      },
    };
    mocks.mutateAsync.mockRejectedValue(
      Object.assign(new Error("source slide needs Worker rendering"), {
        errorCode: "source_runtime_export_required",
      }),
    );
    mocks.callAction.mockImplementation((actionName: string) =>
      actionName === "get-deck"
        ? Promise.resolve({
            slides: [
              {
                id: "legacy-1",
                content: "<div>Legacy static slide</div>",
                notes: "Legacy notes",
              },
              {
                id: "source-1",
                content: "",
                sourceTsx:
                  "export default function Slide() { return <main />; }",
                notes: "Source notes",
              },
            ],
          })
        : Promise.resolve(artifact),
    );
    vi.mocked(renderSlideArtifactInSandbox).mockResolvedValue({
      deckId: "deck-1",
      slideId: "source-1",
      revision: 1,
      sourceHash: artifact.sourceHash,
      width: 1920,
      height: 1080,
      html: "<h1>Rendered source slide</h1>",
      styles: [],
      assetUrls: {},
      assetOrigins: [],
      stepCount: 0,
    });
    let legacyCanvasText = "";
    vi.mocked(exportDeckAsPptx).mockImplementation(async () => {
      legacyCanvasText =
        document.querySelector('[data-slide-canvas="legacy-1"]')?.textContent ??
        "";
      return { blankShapes: 0 };
    });

    const ref = createRef<Slides2ExportMenuHandle>();
    render(
      <Slides2ExportMenu
        ref={ref}
        deckId="deck-1"
        title="Mixed Deck"
        slides={[{ id: "legacy-1" }, { id: "source-1" }]}
        aspectRatio="16:9"
        onBeforeExport={async () => true}
      />,
    );

    await act(async () => {
      await ref.current!.run("pptx");
    });

    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    expect(mocks.callAction).toHaveBeenNthCalledWith(
      1,
      "get-deck",
      {
        id: "deck-1",
        slideIds: ["legacy-1", "source-1"],
        compact: "false",
      },
      { method: "GET" },
    );
    expect(mocks.callAction).toHaveBeenNthCalledWith(
      2,
      "get-slide-render",
      { deckId: "deck-1", slideId: "source-1" },
      { method: "GET" },
    );
    const exportedSlides = vi.mocked(exportDeckAsPptx).mock.calls[0]?.[1];
    expect(exportedSlides).toHaveLength(2);
    expect(exportedSlides?.[0]).toMatchObject({
      id: "legacy-1",
      notes: "Legacy notes",
    });
    expect(legacyCanvasText).toContain("Legacy static slide");
    expect(exportedSlides?.[1]).toEqual({
      id: "source-1",
      notes: "Source notes",
    });
    expect(document.querySelector("[data-pdf-export-stage]")).toBeNull();
  });
});
