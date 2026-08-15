import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  toastSuccessMock,
  toastErrorMock,
  toastWarningMock,
  getDeckMock,
  flushDeckSaveMock,
} = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastWarningMock: vi.fn(),
  getDeckMock: vi.fn(),
  flushDeckSaveMock: vi.fn(),
}));

vi.mock("@/context/DeckContext", () => ({
  useDecks: () => ({ getDeck: getDeckMock, flushDeckSave: flushDeckSaveMock }),
}));

vi.mock("@agent-native/core", () => ({
  cn: (...args: unknown[]) =>
    args
      .flat(Infinity)
      .filter((v) => typeof v === "string" && v.length > 0)
      .join(" "),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => `/agent${path}`,
  appBasePath: () => "/slides",
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    (
      ({
        "editorExport.connectGoogle": "Connect Google",
        "editorExport.openInGoogleSlides": "Export to Google Slides",
        "editorExport.googleSlidesCreated": "Exported to Google Slides",
        "editorExport.googleSlidesCreatedHint":
          "A copy of this deck was created in your Google Drive.",
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

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: toastWarningMock,
  }),
}));

import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";

import { ExportMenu } from "./ExportMenu";

function renderMenu(overrides: Partial<Parameters<typeof ExportMenu>[0]> = {}) {
  return render(
    <ExportMenu
      deckId="deck-1"
      deckTitle="Quarterly Review"
      onDuplicate={vi.fn()}
      onExportPdf={vi.fn()}
      onExportPptx={vi.fn()}
      onExportGoogleSlides={vi.fn().mockResolvedValue({
        url: "https://docs.google.com/presentation/d/new-deck/edit",
      })}
      {...overrides}
    />,
  );
}

function openExportMenu() {
  const trigger = screen.getByRole("button", { name: /export/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
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

    openExportMenu();
    fireEvent.click(await screen.findByText("Export as PPTX"));

    await waitFor(() => expect(onExportPptx).toHaveBeenCalledTimes(1));
    expect(fetch).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("renders export actions inline inside a parent menu", async () => {
    const onExportPptx = vi.fn().mockResolvedValue(undefined);
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <ExportMenu
            inline
            deckId="deck-1"
            deckTitle="Quarterly Review"
            onDuplicate={vi.fn()}
            onExportPdf={vi.fn()}
            onExportPptx={onExportPptx}
          />
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.queryByRole("button", { name: /^export$/i })).toBeNull();
    const exportTrigger = screen.getByRole("menuitem", { name: "Export" });
    fireEvent.focus(exportTrigger);
    fireEvent.keyDown(exportTrigger, { key: "ArrowRight" });
    fireEvent.click(screen.getByText("Export as PPTX"));

    await waitFor(() => expect(onExportPptx).toHaveBeenCalledTimes(1));
  });

  it("exports the converted deck to Google Slides", async () => {
    const openedTab = { location: { href: "" }, close: vi.fn() };
    vi.mocked(window.open).mockReturnValue(openedTab as unknown as Window);
    const onExportGoogleSlides = vi.fn().mockResolvedValue({
      url: "https://docs.google.com/presentation/d/new-deck/edit",
    });
    renderMenu({ onExportGoogleSlides });

    openExportMenu();
    fireEvent.click(await screen.findByText("Export to Google Slides"));

    await waitFor(() => expect(onExportGoogleSlides).toHaveBeenCalledTimes(1));
    expect(openedTab.location.href).toBe(
      "https://docs.google.com/presentation/d/new-deck/edit",
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Exported to Google Slides",
      expect.objectContaining({
        description: "A copy of this deck was created in your Google Drive.",
      }),
    );
  });

  it("asks for Google OAuth when export needs a connection", async () => {
    const openedTab = { location: { href: "" }, close: vi.fn() };
    vi.mocked(window.open).mockReturnValue(openedTab as unknown as Window);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          url: "https://accounts.google.com/o/oauth2/v2/auth?state=test",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    renderMenu({
      onExportGoogleSlides: vi.fn().mockResolvedValue({
        url: null,
        requiresConnection: true,
        reason: "No connected Google account.",
      }),
    });

    openExportMenu();
    expect(screen.queryByText("Connect Google")).toBeNull();
    fireEvent.click(await screen.findByText("Export to Google Slides"));

    expect(window.open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "/agent/_agent-native/google-docs/auth-url?return=",
        ),
        { credentials: "same-origin" },
      ),
    );
    expect(openedTab.location.href).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    );
  });

  it("does not navigate the editor when the OAuth popup is blocked", async () => {
    renderMenu({
      onExportGoogleSlides: vi.fn().mockResolvedValue({
        url: null,
        requiresConnection: true,
        reason: "No connected Google account.",
      }),
    });

    openExportMenu();
    fireEvent.click(await screen.findByText("Export to Google Slides"));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Export failed",
        expect.objectContaining({
          description: "Could not export Google Slides.",
        }),
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to the import dialog when Drive is unavailable", async () => {
    const openedTab = { location: { href: "" }, close: vi.fn() };
    vi.mocked(window.open).mockReturnValue(openedTab as unknown as Window);
    renderMenu({
      onExportGoogleSlides: vi.fn().mockResolvedValue({
        url: null,
        downloaded: true,
        reason: "No connected Google account.",
      }),
    });

    openExportMenu();
    fireEvent.click(await screen.findByText("Export to Google Slides"));

    await waitFor(() =>
      expect(openedTab.location.href).toBe(
        "https://docs.google.com/presentation/u/0/?usp=import",
      ),
    );
    expect((await screen.findByRole("dialog")).textContent).toContain(
      "Import the downloaded PPTX into Google Slides.",
    );
    expect(toastWarningMock).toHaveBeenCalledWith(
      "Downloaded for Google Slides",
      expect.objectContaining({
        description:
          "No connected Google account. Import the downloaded PPTX into Google Slides.",
      }),
    );
  });

  it("does not open Google Slides when the export itself fails", async () => {
    const openedTab = { location: { href: "" }, close: vi.fn() };
    vi.mocked(window.open).mockReturnValue(openedTab as unknown as Window);
    renderMenu({
      onExportGoogleSlides: vi
        .fn()
        .mockRejectedValue(new Error("Could not render")),
    });
    openExportMenu();
    fireEvent.click(await screen.findByText("Export to Google Slides"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Export failed",
        expect.objectContaining({ description: "Could not render" }),
      );
    });
    expect(openedTab.location.href).toBe("");
    expect(openedTab.close).toHaveBeenCalled();
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
    openExportMenu();
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
