import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
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
        "editorExport.disconnectGoogle": "Disconnect Google",
        "editorExport.googleDisconnectFailed":
          "Could not disconnect Google Drive.",
        "editorExport.googleSlidesUnavailableHint":
          "Google Slides export is unavailable right now.",
        "editorExport.exportFailed": "Export failed",
        "editorExport.duplicateDeck": "Duplicate deck",
        "comments.close": "Close",
      }) as Record<string, string>
    )[key] ?? key,
}));

import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";

import { fetchGoogleSlidesExportAvailability } from "@/lib/google-slides-export-availability-client";

import { ExportMenu } from "./ExportMenu";

function statusResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let queryClient: QueryClient;

function renderMenu(
  onExportGoogleSlides = vi.fn(),
  flushInlineEdit?: () => void,
) {
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
        flushInlineEdit={flushInlineEdit}
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ExportMenu> Google Slides availability", () => {
  it("badges the item but keeps it clickable when Google refuses the OAuth request", async () => {
    globalThis.fetch = vi.fn(async () =>
      statusResponse({
        googleSlidesExport: { available: false, reason: "oauth-rejected" },
      }),
    ) as typeof fetch;

    renderMenu();
    openExportMenu();

    const item = await googleSlidesItem();
    await vi.waitFor(() => expect(item.textContent).toContain("Unavailable"));
    expect(item.getAttribute("data-disabled")).toBeNull();
  });

  it("does not send the user to a broken Google consent screen", async () => {
    globalThis.fetch = vi.fn(async () =>
      statusResponse({
        googleSlidesExport: { available: false, reason: "not-configured" },
      }),
    ) as typeof fetch;
    const onExportGoogleSlides = vi.fn();

    renderMenu(onExportGoogleSlides);
    openExportMenu();

    const item = await googleSlidesItem();
    await vi.waitFor(() => expect(item.textContent).toContain("Unavailable"));
    fireEvent.click(item);

    await vi.waitFor(() =>
      expect(
        screen.getByText("Google Slides export is unavailable right now."),
      ).toBeTruthy(),
    );
    expect(onExportGoogleSlides).not.toHaveBeenCalled();
    expect(startWorkspaceProviderOAuth).not.toHaveBeenCalled();
  });

  it("leaves the item working when the integration is available", async () => {
    globalThis.fetch = vi.fn(async () =>
      statusResponse({ googleSlidesExport: { available: true } }),
    ) as typeof fetch;
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

  it("commits the open inline draft before the Google Slides export starts", async () => {
    globalThis.fetch = vi.fn(async () =>
      statusResponse({ googleSlidesExport: { available: true } }),
    ) as typeof fetch;
    const order: string[] = [];
    const flushInlineEdit = vi.fn(() => {
      order.push("inline");
    });
    const onExportGoogleSlides = vi.fn(async () => {
      order.push("export");
      return { url: "https://docs.google.com/presentation/d/x" };
    });

    renderMenu(onExportGoogleSlides, flushInlineEdit);
    openExportMenu();
    fireEvent.click(await googleSlidesItem());

    await vi.waitFor(() => expect(order).toEqual(["inline", "export"]));
  });

  it("keeps the export usable when the status probe itself fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;
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
    globalThis.fetch = vi.fn(async () => {
      await held;
      return statusResponse({
        googleSlidesExport: { available: false, reason: "oauth-rejected" },
      });
    }) as typeof fetch;
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
    const fetchMock = vi.fn(async () =>
      statusResponse({ googleSlidesExport: { available: true } }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await fetchGoogleSlidesExportAvailability(queryClient);
    await fetchGoogleSlidesExportAvailability(queryClient);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await queryClient.invalidateQueries();

    await fetchGoogleSlidesExportAvailability(queryClient);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-asks the server once the verdict goes stale", async () => {
    const fetchMock = vi.fn(async () =>
      statusResponse({ googleSlidesExport: { available: true } }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await fetchGoogleSlidesExportAvailability(queryClient);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 31_000);
    await fetchGoogleSlidesExportAvailability(queryClient);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("keeps the export usable against a server that predates the gate", async () => {
    globalThis.fetch = vi.fn(async () =>
      statusResponse({ configured: true, connected: true }),
    ) as typeof fetch;

    renderMenu();
    openExportMenu();

    const item = await googleSlidesItem();
    expect(item.getAttribute("data-disabled")).toBeNull();
    expect(item.textContent).not.toContain("Unavailable");
  });

  it("disconnects a connected Google account from the export menu", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/google-docs/disconnect")
        ? statusResponse({ ok: true })
        : statusResponse({
            disconnectable: true,
            googleSlidesExport: { available: true },
          }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    renderMenu();
    openExportMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Disconnect Google" }),
    );

    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("/google-docs/disconnect"),
        ),
      ).toBe(true),
    );
  });

  it("shows a localized failure when the Google disconnect request fails", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/google-docs/disconnect")
        ? statusResponse({ error: "Google refused the request" })
        : statusResponse({
            disconnectable: true,
            googleSlidesExport: { available: true },
          }),
    ) as typeof fetch;

    renderMenu();
    openExportMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Disconnect Google" }),
    );

    expect(
      await screen.findByText("Could not disconnect Google Drive."),
    ).toBeTruthy();
  });

  it("hides Disconnect when the only account is the workspace's shared one", async () => {
    globalThis.fetch = vi.fn(async () =>
      statusResponse({
        connected: true,
        disconnectable: false,
        googleSlidesExport: { available: true },
      }),
    ) as typeof fetch;

    renderMenu();
    openExportMenu();

    await googleSlidesItem();
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(
      screen.queryByRole("menuitem", { name: "Disconnect Google" }),
    ).toBeNull();
  });
});
