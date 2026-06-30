import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  cn: (...args: unknown[]) =>
    args
      .flat(Infinity)
      .filter((v) => typeof v === "string" && v.length > 0)
      .join(" "),
}));

vi.mock("@agent-native/core/client", () => ({
  // `@/lib/utils` re-exports `cn` from `@agent-native/core/client`, so the
  // client mock must provide it or DropdownMenu crashes on first render.
  cn: (...args: unknown[]) =>
    args
      .flat(Infinity)
      .filter((v) => typeof v === "string" && v.length > 0)
      .join(" "),
  agentNativePath: (path: string) => `/agent${path}`,
  appBasePath: () => "/slides",
  useT: () => (key: string) =>
    (
      ({
        "editorExport.downloadGoogleSlides": "Download for Google Slides",
        "editorExport.downloadHtml": "Download as HTML",
        "editorExport.duplicateDeck": "Duplicate deck",
        "editorExport.export": "Export",
        "editorExport.exportAndDuplicate": "Export and duplicate",
        "editorExport.exportPdf": "Export PDF",
        "editorExport.exportPptx": "Export as PPTX",
        "editorExport.googleSlidesDownloaded": "Downloaded for Google Slides",
        "editorExport.googleSlidesImportHint":
          "Import the downloaded PPTX into Google Slides.",
        "editorExport.pptxFailed": "PPTX export failed",
        "editorExport.htmlFailed": "HTML export failed",
        "editorExport.exportFailed": "Export failed",
        "editorExport.exportPptxError": "Could not export PPTX.",
        "editorExport.exportGoogleSlidesError":
          "Could not export Google Slides.",
        "editorExport.exportHtmlError": "Could not export HTML.",
      }) as Record<string, string>
    )[key] ?? key,
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: toastMock,
}));

import { ExportMenu } from "./ExportMenu";

function renderMenu(overrides: Partial<Parameters<typeof ExportMenu>[0]> = {}) {
  return render(
    <ExportMenu
      deckId="deck-1"
      deckTitle="Quarterly Review"
      onDuplicate={vi.fn()}
      onExportPdf={vi.fn()}
      onExportPptx={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn(async () => new Response()) as typeof fetch;
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pptx");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const realSetTimeout = window.setTimeout.bind(window);
  vi.spyOn(window, "setTimeout").mockImplementation(((
    handler: TimerHandler,
    timeout?: number,
    ...args: any[]
  ) => {
    if (timeout === 60_000) return 1;
    return realSetTimeout(handler, timeout, ...args);
  }) as typeof window.setTimeout);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ExportMenu>", () => {
  it("exports PPTX from the rendered slide canvas", async () => {
    const onExportPptx = vi.fn().mockResolvedValue(undefined);
    renderMenu({ onExportPptx });

    const trigger = screen.getByRole("button", { name: /export/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("Export as PPTX"));

    await waitFor(() => expect(onExportPptx).toHaveBeenCalledTimes(1));
    expect(fetch).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("downloads Google Slides exports as PPTX without navigating away first", async () => {
    const onExportPptx = vi.fn().mockResolvedValue(undefined);
    renderMenu({ onExportPptx });

    const trigger = screen.getByRole("button", { name: /export/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("Download for Google Slides"));

    await waitFor(() => expect(onExportPptx).toHaveBeenCalledTimes(1));
    expect(fetch).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Downloaded for Google Slides" }),
    );
  });

  it("does not open Google Slides when Google export fails", async () => {
    renderMenu({
      onExportPptx: vi.fn().mockRejectedValue(new Error("Could not render")),
    });
    const trigger = screen.getByRole("button", { name: /export/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("Download for Google Slides"));

    expect(window.open).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Export failed",
          description: "Could not render",
          variant: "destructive",
        }),
      );
    });
    expect(window.open).not.toHaveBeenCalled();
  });

  it("downloads HTML via the streamed POST endpoint, not the broken filename GET", async () => {
    // Regression test for the bug Josh hit: the old flow POSTed to the
    // action endpoint, got back a filename, then redirected to
    // /api/exports/:filename — that GET returns 404 on serverless because
    // the file was written to a different Lambda's /tmp.
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        new Blob(["<html><body>deck</body></html>"], { type: "text/html" }),
        {
          status: 200,
          headers: {
            "content-disposition": 'attachment; filename="quarterly.html"',
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    }) as typeof fetch;

    renderMenu();
    const trigger = screen.getByRole("button", { name: /export/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("Download as HTML"));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    expect(fetch).toHaveBeenCalledWith(
      "/slides/api/exports/html",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ deckId: "deck-1" }),
      }),
    );
    expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain(
      "/_agent-native/actions/export-html",
    );
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
