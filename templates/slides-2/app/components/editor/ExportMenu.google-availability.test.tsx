import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getDeckMock, flushDeckSaveMock, getGoogleDocsStatusMock } = vi.hoisted(
  () => ({
    getDeckMock: vi.fn(),
    flushDeckSaveMock: vi.fn(),
    getGoogleDocsStatusMock: vi.fn(),
  }),
);

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
        "editorExport.exportFailed": "Export failed",
        "editorExport.duplicateDeck": "Duplicate deck",
        "comments.close": "Close",
      }) as Record<string, string>
    )[key] ?? key,
}));

vi.mock("@/lib/google-docs-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/google-docs-client")>()),
  getGoogleDocsStatus: getGoogleDocsStatusMock,
}));

import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";

import { fetchGoogleSlidesExportAvailability } from "@/lib/google-slides-export-availability-client";

import { ExportMenu } from "./ExportMenu";

function statusResponse(body: unknown) {
  return { ok: true, status: 200, data: body, unreadable: false };
}

let queryClient: QueryClient;

function renderMenu(onExportGoogleSlides = vi.fn()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ExportMenu
        hasSlides
        deckId="deck-1"
        deckTitle="Quarterly Review"
        onDuplicate={vi.fn()}
        onExportPdf={vi.fn()}
        onExportPptx={vi.fn()}
        onExportGoogleSlides={onExportGoogleSlides}
      />
    </QueryClientProvider>,
  );
}

function openExportMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: /export/i }), {
    button: 0,
    ctrlKey: false,
  });
}

const googleSlidesItem = () =>
  screen.findByRole("menuitem", { name: /Export to Google Slides/ });

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  getDeckMock.mockReturnValue(undefined);
  flushDeckSaveMock.mockResolvedValue(undefined);
  getGoogleDocsStatusMock.mockResolvedValue(
    statusResponse({ googleSlidesExport: { available: true } }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ExportMenu> Google Slides availability", () => {
  it("disables and badges the item when Google refuses the OAuth request", async () => {
    getGoogleDocsStatusMock.mockResolvedValue(
      statusResponse({
        googleSlidesExport: { available: false, reason: "oauth-rejected" },
      }),
    );

    renderMenu();
    openExportMenu();

    const item = await googleSlidesItem();
    await vi.waitFor(() =>
      expect(item.getAttribute("data-disabled")).not.toBeNull(),
    );
    expect(item.textContent).toContain("Unavailable");
  });

  it("does not send the user to a broken Google consent screen", async () => {
    getGoogleDocsStatusMock.mockResolvedValue(
      statusResponse({
        googleSlidesExport: { available: false, reason: "not-configured" },
      }),
    );
    const onExportGoogleSlides = vi.fn();

    renderMenu(onExportGoogleSlides);
    openExportMenu();

    const item = await googleSlidesItem();
    await vi.waitFor(() =>
      expect(item.getAttribute("data-disabled")).not.toBeNull(),
    );
    fireEvent.click(item);

    expect(onExportGoogleSlides).not.toHaveBeenCalled();
    expect(startWorkspaceProviderOAuth).not.toHaveBeenCalled();
  });

  it("leaves the item working when the integration is available", async () => {
    getGoogleDocsStatusMock.mockResolvedValue(
      statusResponse({ googleSlidesExport: { available: true } }),
    );
    const onExportGoogleSlides = vi
      .fn()
      .mockResolvedValue({ url: "https://docs.google.com/presentation/d/x" });

    renderMenu(onExportGoogleSlides);
    openExportMenu();

    const item = await googleSlidesItem();
    expect(item.textContent).not.toContain("Unavailable");
    fireEvent.click(item);
    await vi.waitFor(() =>
      expect(onExportGoogleSlides).toHaveBeenCalledTimes(1),
    );
  });

  it("keeps the export usable when the status probe itself fails", async () => {
    getGoogleDocsStatusMock.mockRejectedValue(new Error("offline"));
    const onExportGoogleSlides = vi
      .fn()
      .mockResolvedValue({ url: "https://docs.google.com/presentation/d/x" });

    renderMenu(onExportGoogleSlides);
    openExportMenu();

    const item = await googleSlidesItem();
    expect(item.getAttribute("data-disabled")).toBeNull();
    fireEvent.click(item);
    await vi.waitFor(() =>
      expect(onExportGoogleSlides).toHaveBeenCalledTimes(1),
    );
  });

  it("blocks a click made before the probe has answered", async () => {
    let releaseStatus: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    getGoogleDocsStatusMock.mockImplementation(async () => {
      await held;
      return statusResponse({
        googleSlidesExport: { available: false, reason: "oauth-rejected" },
      });
    });
    const onExportGoogleSlides = vi.fn();

    renderMenu(onExportGoogleSlides);
    openExportMenu();

    const item = await googleSlidesItem();
    expect(item.getAttribute("data-disabled")).toBeNull();
    fireEvent.click(item);

    releaseStatus?.();

    await vi.waitFor(() =>
      expect(screen.queryAllByText(/Export failed/).length).toBeGreaterThan(0),
    );
    expect(onExportGoogleSlides).not.toHaveBeenCalled();
    expect(startWorkspaceProviderOAuth).not.toHaveBeenCalled();
  });

  it("drops the verdict when the org switch invalidates queries", async () => {
    getGoogleDocsStatusMock.mockResolvedValue(
      statusResponse({ googleSlidesExport: { available: true } }),
    );

    await fetchGoogleSlidesExportAvailability(queryClient);
    await fetchGoogleSlidesExportAvailability(queryClient);
    expect(getGoogleDocsStatusMock).toHaveBeenCalledTimes(1);

    await queryClient.invalidateQueries();

    await fetchGoogleSlidesExportAvailability(queryClient);
    expect(getGoogleDocsStatusMock).toHaveBeenCalledTimes(2);
  });

  it("re-asks the server once the verdict goes stale", async () => {
    getGoogleDocsStatusMock.mockResolvedValue(
      statusResponse({ googleSlidesExport: { available: true } }),
    );

    await fetchGoogleSlidesExportAvailability(queryClient);
    expect(getGoogleDocsStatusMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 31_000);
    await fetchGoogleSlidesExportAvailability(queryClient);
    expect(getGoogleDocsStatusMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("keeps the export usable against a server that predates the gate", async () => {
    getGoogleDocsStatusMock.mockResolvedValue(
      statusResponse({ configured: true, connected: true }),
    );

    renderMenu();
    openExportMenu();

    const item = await googleSlidesItem();
    expect(item.getAttribute("data-disabled")).toBeNull();
    expect(item.textContent).not.toContain("Unavailable");
  });
});
