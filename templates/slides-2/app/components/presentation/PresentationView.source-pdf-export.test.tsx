// @vitest-environment happy-dom

import { sourceRuntimeExportError } from "@shared/source-runtime-export";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Slide } from "@/context/DeckContext";

const mocks = vi.hoisted(() => ({
  actionCalls: [] as Array<{ action: string; args: Record<string, unknown> }>,
  artifact: undefined as unknown,
  exportPdf: vi.fn(),
  renderSandbox: vi.fn(),
  translate: (key: string) => key,
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  captureError: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (action: string, args: Record<string, unknown>) => {
    mocks.actionCalls.push({ action, args });
    return Promise.resolve(mocks.artifact);
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => mocks.translate,
}));

vi.mock("@/components/deck/SlideRenderer", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: { slide: { id: string; content: string } }) =>
      createElement(
        "div",
        {
          "data-testid": `rendered-${props.slide.id}`,
          "data-slide-canvas": props.slide.id,
        },
        props.slide.content,
      ),
  };
});

vi.mock("@/components/slides-2-runtime/SlideContentRenderer", () => ({
  default: () => null,
}));

vi.mock("@/components/slides-2-runtime/SandboxedSlide", () => ({
  renderSlideArtifactInSandbox: mocks.renderSandbox,
}));

vi.mock("@/lib/export-pdf-client", () => ({
  exportDeckAsPdf: mocks.exportPdf,
}));

vi.mock("./present-channel", () => ({ openPresentChannel: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import PresentationView from "./PresentationView";

afterEach(cleanup);

beforeEach(() => {
  mocks.actionCalls = [];
  mocks.exportPdf.mockReset().mockReturnValue(new Promise<void>(() => {}));
  mocks.renderSandbox.mockReset();
  mocks.artifact = {
    protocolVersion: 1,
    deckId: "deck-live",
    slideId: "source-slide",
    revision: 2,
    sourceHash: "a".repeat(64),
    width: 1920,
    height: 1080,
    html: "",
    assetOrigins: [],
    runtime: {
      kind: "open-slide-react-worker-v1",
      workerSource: "self.onmessage = () => {};",
      page: { current: 1, total: 2 },
      assetUrls: {},
      styles: ["#slide-root { color: #123456; }"],
      timeoutMs: 2500,
    },
  };
  mocks.renderSandbox.mockResolvedValue({
    deckId: "deck-live",
    slideId: "source-slide",
    revision: 2,
    sourceHash: "a".repeat(64),
    width: 1920,
    height: 1080,
    html: "<main>Sandbox-rendered source</main>",
    styles: ["#slide-root { color: #123456; }"],
    assetOrigins: [],
    fontOrigins: [],
    fontAssets: [],
    stepCount: 0,
  });
});

const sourceSlide = {
  id: "source-slide",
  content: "",
  sourceRuntimeRequired: true,
  notes: "",
  layout: "content",
} as Slide;

const importedSlide = {
  id: "imported-slide",
  content: "<main>Imported HTML</main>",
  notes: "",
  layout: "content",
} as Slide;

function renderPresentation(slides: Slide[], sourceDeckId?: string) {
  return render(
    <MemoryRouter>
      <PresentationView
        slides={slides}
        deckId="__shared__/public-token"
        sourceDeckId={sourceDeckId}
        pdfExportTitle="Public deck"
      />
    </MemoryRouter>,
  );
}

describe("PresentationView source-backed PDF export", () => {
  it("uses the sandbox-rendered artifact for source slides and keeps HTML slides on SlideRenderer", async () => {
    renderPresentation([sourceSlide, importedSlide], "deck-live");

    fireEvent.click(
      screen.getByRole("button", { name: "editorExport.exportPdf" }),
    );

    await waitFor(() => expect(mocks.exportPdf).toHaveBeenCalled());

    expect(mocks.actionCalls).toEqual([
      {
        action: "get-slide-render",
        args: { deckId: "deck-live", slideId: "source-slide" },
      },
    ]);
    expect(mocks.renderSandbox).toHaveBeenCalledWith(
      mocks.artifact,
      window.location.origin,
      500,
    );

    const exportSlides = mocks.exportPdf.mock.calls[0][1] as Slide[];
    expect(exportSlides[0]).toMatchObject({
      id: "source-slide",
      content: "<main>Sandbox-rendered source</main>",
    });
    expect(exportSlides[0]?.sourceTsx).toBeUndefined();
    expect(exportSlides[0]?.sourceRuntimeRequired).toBeUndefined();
    expect(exportSlides[1]).toMatchObject(importedSlide);
    expect(sourceRuntimeExportError(exportSlides, "pdf")).toBeNull();

    const sourceCanvas = document.querySelector<HTMLElement>(
      '[data-pdf-export-stage] [data-slide-canvas="source-slide"]',
    );
    expect(sourceCanvas?.textContent).toContain("Sandbox-rendered source");
    expect(sourceCanvas?.querySelector("style")?.textContent).toContain(
      '[data-pdf-slide-root="0"]',
    );
    expect(screen.getByTestId("rendered-imported-slide").textContent).toContain(
      "Imported HTML",
    );
  });

  it("does not fetch live source artifacts for token-only snapshots", async () => {
    renderPresentation([sourceSlide]);

    fireEvent.click(
      screen.getByRole("button", { name: "editorExport.exportPdf" }),
    );

    await waitFor(() => expect(mocks.exportPdf).toHaveBeenCalled());

    const exportSlides = mocks.exportPdf.mock.calls[0][1] as Slide[];
    expect(mocks.actionCalls).toEqual([]);
    expect(mocks.renderSandbox).not.toHaveBeenCalled();
    expect(exportSlides[0]).toMatchObject(sourceSlide);
    expect(sourceRuntimeExportError(exportSlides, "pdf")).toMatchObject({
      slideIds: ["source-slide"],
    });
  });
});
