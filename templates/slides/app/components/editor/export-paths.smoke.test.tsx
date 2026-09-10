// @vitest-environment happy-dom
/**
 * Per-release smoke test for every export path the export menu offers.
 *
 * The reports behind this file all shared one shape: an export was presented as
 * a working option and then produced nothing the user could see - no file, no
 * link, no error. So each path is checked against a single invariant rather
 * than against its own bespoke plumbing:
 *
 *   every export either produces an artifact, or says out loud that it did not.
 *
 * Silence is the failure. A path that resolves without downloading a file,
 * opening a deck, or showing an error is a regression even when nothing threw.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getDeckMock, flushDeckSaveMock } = vi.hoisted(() => ({
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

vi.mock("@agent-native/core/client/integrations", () => ({
  startWorkspaceProviderOAuth: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    (
      ({
        "editorExport.export": "Export",
        "editorExport.exportAndDuplicate": "Export and duplicate",
        "editorExport.downloadHtml": "Download as HTML",
        "editorExport.exportPdf": "Export as PDF",
        "editorExport.exportPptx": "Export as PPTX",
        "editorExport.openInGoogleSlides": "Export to Google Slides",
        "editorExport.googleSlidesUnavailable": "Unavailable",
        "editorExport.googleSlidesUnavailableHint":
          "Google Slides export is unavailable right now.",
        "editorExport.googleSlidesCreated": "Exported to Google Slides",
        "editorExport.googleSlidesCreatedHint": "Created in your Drive.",
        "editorExport.googleSlidesDownloaded": "Downloaded for Google Slides",
        "editorExport.googleSlidesImportHint":
          "Import the downloaded PPTX into Google Slides yourself.",
        "editorExport.googleSlidesOpenImporter": "Open Google Slides import",
        "editorExport.exportFailed": "Export failed",
        "editorExport.exporting": "Exporting...",
        "editorExport.duplicateDeck": "Duplicate deck",
        "comments.close": "Close",
      }) as Record<string, string>
    )[key] ?? key,
}));

import { resetGoogleSlidesExportAvailabilityCache } from "@/lib/google-slides-export-availability-client";

import { ExportMenu } from "./ExportMenu";

const HTML_MIME = "text/html";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Every export path, named the way the menu labels it. */
const EXPORT_PATHS = [
  "Download as HTML",
  "Export as PDF",
  "Export as PPTX",
  "Export to Google Slides",
] as const;

type ExportPath = (typeof EXPORT_PATHS)[number];

interface Harness {
  downloads: string[];
  opened: string[];
}

function statusResponse(available: boolean) {
  return new Response(JSON.stringify({ googleSlidesExport: { available } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fileResponse(mime: string, filename: string) {
  return new Response(new Blob(["PK"], { type: mime }), {
    status: 200,
    headers: {
      "content-type": mime,
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function installHarness(options: {
  googleAvailable?: boolean;
  htmlFails?: boolean;
}): Harness {
  const harness: Harness = { downloads: [], opened: [] };

  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url,
    );
    if (url.includes("/google-docs/status")) {
      return statusResponse(options.googleAvailable ?? true);
    }
    if (url.includes("/api/exports/html")) {
      return options.htmlFails
        ? new Response(JSON.stringify({ error: "HTML export failed" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          })
        : fileResponse(HTML_MIME, "deck.html");
    }
    if (url.includes("/api/exports/pptx")) {
      return fileResponse(PPTX_MIME, "deck.pptx");
    }
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      harness.downloads.push(this.download);
    },
  );
  vi.spyOn(window, "open").mockImplementation((url) => {
    harness.opened.push(String(url));
    return null;
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

  return harness;
}

function renderMenu(overrides: Record<string, unknown> = {}) {
  return render(
    <ExportMenu
      deckId="deck-1"
      deckTitle="Quarterly Review"
      onDuplicate={vi.fn()}
      onExportPdf={vi.fn().mockResolvedValue(undefined)}
      onExportPptx={vi.fn().mockResolvedValue(undefined)}
      onExportGoogleSlides={vi.fn().mockResolvedValue({
        url: "https://docs.google.com/presentation/d/new/edit",
      })}
      {...overrides}
    />,
  );
}

async function clickExport(path: ExportPath) {
  fireEvent.pointerDown(screen.getByRole("button", { name: /export/i }), {
    button: 0,
    ctrlKey: false,
  });
  const item = await screen.findByRole("menuitem", { name: new RegExp(path) });
  fireEvent.click(item);
  return item;
}

/** True when the user can see that the export did not work. */
function errorIsVisible(): boolean {
  return screen.queryAllByText(/Export failed/).length > 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetGoogleSlidesExportAvailabilityCache();
  getDeckMock.mockReturnValue(undefined);
  flushDeckSaveMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("export paths smoke test", () => {
  it("offers exactly the four documented export paths", async () => {
    installHarness({});
    renderMenu();
    fireEvent.pointerDown(screen.getByRole("button", { name: /export/i }), {
      button: 0,
      ctrlKey: false,
    });
    for (const path of EXPORT_PATHS) {
      expect(
        await screen.findByRole("menuitem", { name: new RegExp(path) }),
      ).toBeTruthy();
    }
  });

  it.each(["Download as HTML", "Export as PPTX"] as const)(
    "%s downloads a file",
    async (path) => {
      const harness = installHarness({});
      const onExportPptx = vi.fn().mockImplementation(async () => {
        // The browser exporter writes the file itself.
        harness.downloads.push("deck.pptx");
      });
      renderMenu({ onExportPptx });

      await clickExport(path);

      await vi.waitFor(() => expect(harness.downloads.length).toBe(1));
      expect(errorIsVisible()).toBe(false);
    },
  );

  it("Export as PDF runs the renderer", async () => {
    installHarness({});
    const onExportPdf = vi.fn().mockResolvedValue(undefined);
    renderMenu({ onExportPdf });

    await clickExport("Export as PDF");

    await vi.waitFor(() => expect(onExportPdf).toHaveBeenCalledTimes(1));
    expect(errorIsVisible()).toBe(false);
  });

  it("Export to Google Slides returns a deck the user can open", async () => {
    const harness = installHarness({ googleAvailable: true });
    renderMenu();

    await clickExport("Export to Google Slides");

    const open = await screen.findByRole("button", {
      name: /Export to Google Slides/,
    });
    fireEvent.click(open);
    expect(harness.opened).toContain(
      "https://docs.google.com/presentation/d/new/edit",
    );
  });

  it("Export to Google Slides is visibly gated when Google is broken", async () => {
    // The beta report: Google's consent screen answered "app request is
    // invalid", so the menu must not present this as a working option.
    installHarness({ googleAvailable: false });
    const onExportGoogleSlides = vi.fn();
    renderMenu({ onExportGoogleSlides });

    fireEvent.pointerDown(screen.getByRole("button", { name: /export/i }), {
      button: 0,
      ctrlKey: false,
    });
    const item = await screen.findByRole("menuitem", {
      name: /Export to Google Slides/,
    });
    await vi.waitFor(() =>
      expect(item.getAttribute("data-disabled")).not.toBeNull(),
    );

    expect(item.textContent).toContain("Unavailable");
    fireEvent.click(item);
    expect(onExportGoogleSlides).not.toHaveBeenCalled();
  });

  it("the Drive fallback never claims the deck reached Google Slides", async () => {
    // Reported symptom: a tab opens Google Slides, the deck is not in the
    // library, and a .pptx lands on the desktop. The download itself is the
    // right escape hatch - labelling its button "Export to Google Slides" is
    // what made it read as a success.
    installHarness({ googleAvailable: true });
    renderMenu({
      onExportGoogleSlides: vi.fn().mockResolvedValue({
        url: null,
        downloaded: true,
        reason: "Could not reach Google Drive. Try again.",
      }),
    });

    await clickExport("Export to Google Slides");

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Downloaded for Google Slides");

    const cta = Array.from(dialog.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Google Slides"),
    );
    expect(cta?.textContent).toBe("Open Google Slides import");
    expect(cta?.textContent).not.toBe("Export to Google Slides");
    expect(dialog.textContent).toContain("Could not reach Google Drive");
  });

  it("re-checks availability after the Drive upload fails", async () => {
    // The stale verdict that let the attempt through must not survive the
    // failure, or the next click dead-ends exactly the same way.
    installHarness({ googleAvailable: true });
    renderMenu({
      onExportGoogleSlides: vi
        .fn()
        .mockResolvedValue({ url: null, downloaded: true, reason: "HTTP 502" }),
    });

    await clickExport("Export to Google Slides");
    await screen.findByRole("dialog");

    const statusCalls = () =>
      (
        globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.filter((call) =>
        String(call[0]).includes("/google-docs/status"),
      ).length;
    const before = statusCalls();

    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);
    fireEvent.pointerDown(screen.getByRole("button", { name: /export/i }), {
      button: 0,
      ctrlKey: false,
    });

    await vi.waitFor(() => expect(statusCalls()).toBeGreaterThan(before));
  });

  it("a failing export says so instead of failing silently", async () => {
    const harness = installHarness({ htmlFails: true });
    renderMenu();

    await clickExport("Download as HTML");

    await vi.waitFor(() => expect(errorIsVisible()).toBe(true));
    expect(harness.downloads).toEqual([]);
  });

  it("every path reaches a visible outcome, never silence", async () => {
    for (const path of EXPORT_PATHS) {
      const harness = installHarness({ googleAvailable: true });
      const onExportPdf = vi.fn().mockResolvedValue(undefined);
      const onExportPptx = vi.fn().mockImplementation(async () => {
        harness.downloads.push("deck.pptx");
      });
      renderMenu({ onExportPdf, onExportPptx });

      await clickExport(path);

      await vi.waitFor(() => {
        const produced =
          harness.downloads.length > 0 ||
          onExportPdf.mock.calls.length > 0 ||
          screen.queryAllByText(/Exported to Google Slides/).length > 0;
        expect(produced || errorIsVisible()).toBe(true);
      });

      cleanup();
      vi.restoreAllMocks();
      resetGoogleSlidesExportAvailabilityCache();
    }
  });
});
