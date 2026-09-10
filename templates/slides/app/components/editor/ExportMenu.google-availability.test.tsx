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
        "editorExport.googleSlidesUnavailableHint":
          "Google Slides export is unavailable right now.",
        "editorExport.exportFailed": "Export failed",
        "editorExport.duplicateDeck": "Duplicate deck",
        "comments.close": "Close",
      }) as Record<string, string>
    )[key] ?? key,
}));

import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";

import {
  fetchGoogleSlidesExportAvailability,
  resetGoogleSlidesExportAvailabilityCache,
} from "@/lib/google-slides-export-availability-client";

import { ExportMenu } from "./ExportMenu";

function statusResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function renderMenu(onExportGoogleSlides = vi.fn()) {
  return render(
    <ExportMenu
      deckId="deck-1"
      deckTitle="Quarterly Review"
      onDuplicate={vi.fn()}
      onExportPdf={vi.fn()}
      onExportPptx={vi.fn()}
      onExportGoogleSlides={onExportGoogleSlides}
    />,
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
  resetGoogleSlidesExportAvailabilityCache();
  getDeckMock.mockReturnValue(undefined);
  flushDeckSaveMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ExportMenu> Google Slides availability", () => {
  it("disables and badges the item when Google refuses the OAuth request", async () => {
    globalThis.fetch = vi.fn(async () =>
      statusResponse({
        googleSlidesExport: { available: false, reason: "oauth-rejected" },
      }),
    ) as typeof fetch;

    renderMenu();
    openExportMenu();

    const item = await googleSlidesItem();
    await vi.waitFor(() =>
      expect(item.getAttribute("data-disabled")).not.toBeNull(),
    );
    expect(item.textContent).toContain("Unavailable");
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
    await vi.waitFor(() =>
      expect(item.getAttribute("data-disabled")).not.toBeNull(),
    );
    fireEvent.click(item);

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

  it("keeps the export usable when the status probe itself fails", async () => {
    // A broken status call says nothing about Google. Hiding a working export on
    // that basis would be a worse failure than the one this gate prevents.
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
    // The badge is driven by render state, which is still the optimistic
    // default on the very first interaction. Clicking that fast must not sail
    // past a rejection the menu has not received yet.
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
    // Still enabled: the verdict has not arrived, and flashing the item
    // disabled on every open would be its own bug.
    expect(item.getAttribute("data-disabled")).toBeNull();
    fireEvent.click(item);

    releaseStatus?.();

    await vi.waitFor(() =>
      expect(screen.queryAllByText(/Export failed/).length).toBeGreaterThan(0),
    );
    expect(onExportGoogleSlides).not.toHaveBeenCalled();
    expect(startWorkspaceProviderOAuth).not.toHaveBeenCalled();
  });

  it("re-asks the server once the cached verdict expires", async () => {
    // Switching organization only invalidates React Query caches, and this
    // module is not one of them, so a verdict that never expired would
    // outlive the credentials it was computed from.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(async () =>
      statusResponse({ googleSlidesExport: { available: true } }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await fetchGoogleSlidesExportAvailability();
    await fetchGoogleSlidesExportAvailability();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(31_000);
    await fetchGoogleSlidesExportAvailability();
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
});
