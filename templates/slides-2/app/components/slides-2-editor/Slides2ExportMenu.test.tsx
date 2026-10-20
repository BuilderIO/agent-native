// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDeckPptxBlob, exportDeckAsPptx } from "@/lib/export-pptx-client";

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
  vi.mocked(buildDeckPptxBlob).mockReset();
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

  it("shows the localized explanation for source-only export failures", async () => {
    const error = Object.assign(new Error("Action export-html failed"), {
      errorCode: "source_runtime_export_required",
      actionMessage: "Private source details should not be shown.",
    });
    mocks.mutateAsync.mockRejectedValue(error);

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

    expect(screen.getByText("sourceRuntimeExportUnavailable")).toBeTruthy();
    expect(
      screen.queryByText("Private source details should not be shown."),
    ).toBeNull();
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
        kind: "open-slide-react-worker-v1",
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
        kind: "open-slide-react-worker-v1",
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
        kind: "open-slide-react-worker-v1",
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
