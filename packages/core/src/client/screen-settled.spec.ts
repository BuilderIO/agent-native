// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _resetRenderedScreenStateForTests,
  getLastUserInteractedEntityId,
  postScreenSettled,
  reportRenderedScreen,
  reportUserInteraction,
  SCREEN_SETTLED_EVENT,
  UPDATE_MODEL_CONTEXT_MESSAGE_TYPE,
  useReportRenderedScreen,
  verifyScreenSettledReceipt,
  type RenderedScreenReport,
  type ScreenSettledReceipt,
} from "./screen-settled.js";

vi.mock("./api-path.js", () => ({ resolveAppBasePath: () => "/items-app" }));

vi.mock("./frame.js", () => ({
  getFrameOrigin: () => "https://parent.example.test",
  isKnownFrameHostOrigin: () => true,
}));

afterEach(() => {
  _resetRenderedScreenStateForTests();
  vi.unstubAllGlobals();
});

describe("screen-settled and rendered-object verification contract", () => {
  it("delivers the same settled receipt to the document and its parent", () => {
    const dispatchEvent = vi.fn();
    const postMessage = vi.fn();
    vi.stubGlobal("window", { dispatchEvent, parent: { postMessage } });
    postScreenSettled({
      writeId: "write-1",
      url: "/items/one",
      tabId: "tab-1",
    });
    postScreenSettled({
      writeId: "write-1",
      url: "/items/one",
      tabId: "tab-1",
    });
    const detail = {
      type: SCREEN_SETTLED_EVENT,
      writeId: "write-1",
      tabId: "tab-1",
      appBasePath: "/items-app",
      url: "/items/one",
      screenSummary: { title: document.title, route: "/items/one" },
    };
    expect(dispatchEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ detail }),
    );
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      detail,
      "https://parent.example.test",
    );
  });

  it("includes renderedScreen and lastUserInteractedEntity in screen-settled and ui/update-model-context updates", () => {
    const postMessage = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      dispatchEvent,
      parent: { postMessage },
      location: { origin: "https://app.example.test" },
    });

    reportRenderedScreen({
      screenId: "deck-editor",
      entityType: "deck",
      entityId: "deck-42",
      objectTitle: "Q4 Strategy",
      interactiveControls: ["add-slide", "edit-title", "add-slide"],
    });
    const interaction = reportUserInteraction({
      entityId: "slide-3",
      entityType: "slide",
      action: "drag",
    });

    expect(getLastUserInteractedEntityId()).toBe("slide-3");
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: UPDATE_MODEL_CONTEXT_MESSAGE_TYPE,
        renderedScreen: {
          screenId: "deck-editor",
          entityType: "deck",
          entityId: "deck-42",
          objectTitle: "Q4 Strategy",
          interactiveControls: ["add-slide", "edit-title"],
        },
        lastUserInteractedEntity: interaction,
        lastUserInteractedEntityId: "slide-3",
      }),
      "https://parent.example.test",
    );

    postScreenSettled({
      writeId: "write-2",
      url: "/docs/deck-42",
      tabId: "tab-1",
    });

    const settledCall = postMessage.mock.calls.find(
      ([payload]) => payload?.type === SCREEN_SETTLED_EVENT,
    );
    expect(settledCall).toBeDefined();
    if (!settledCall) throw new Error("Expected screen-settled postMessage");
    const receipt = settledCall[0] as ScreenSettledReceipt;
    expect(receipt.renderedScreen).toEqual({
      screenId: "deck-editor",
      entityType: "deck",
      entityId: "deck-42",
      objectTitle: "Q4 Strategy",
      interactiveControls: ["add-slide", "edit-title"],
    });
    expect(receipt.lastUserInteractedEntityId).toBe("slide-3");
    expect(
      verifyScreenSettledReceipt(receipt, {
        screenId: "deck-editor",
        entityId: "deck-42",
        requiredControls: ["edit-title"],
      }),
    ).toEqual({
      verified: true,
      renderedScreen: receipt.renderedScreen,
    });
  });

  it("detects fallback screens, entity mismatches, screen mismatches, and missing controls", () => {
    const baseReceipt: ScreenSettledReceipt = {
      type: SCREEN_SETTLED_EVENT,
      writeId: "w-3",
      tabId: "tab-1",
      appBasePath: "/decks-2",
      url: "/docs/deck-99",
      screenSummary: { title: "Decks", route: "/docs/deck-99" },
      renderedScreen: {
        screenId: "empty-generator",
        interactiveControls: ["generate-deck"],
        isFallback: true,
      },
    };

    expect(
      verifyScreenSettledReceipt(baseReceipt, { entityId: "deck-99" }),
    ).toMatchObject({
      verified: false,
      reason: "fallback-rendered",
    });

    expect(
      verifyScreenSettledReceipt(
        {
          ...baseReceipt,
          renderedScreen: {
            screenId: "deck-editor",
            entityId: "deck-other",
            interactiveControls: ["edit-title"],
          },
        },
        { screenId: "deck-editor", entityId: "deck-99" },
      ),
    ).toMatchObject({
      verified: false,
      reason: "entity-mismatch",
      expectedEntityId: "deck-99",
      actualEntityId: "deck-other",
    });

    expect(
      verifyScreenSettledReceipt(
        {
          ...baseReceipt,
          renderedScreen: {
            screenId: "deck-editor",
            entityId: "deck-99",
            interactiveControls: ["edit-title"],
          },
        },
        {
          screenId: "deck-editor",
          entityId: "deck-99",
          requiredControls: ["edit-title", "share"],
        },
      ),
    ).toMatchObject({
      verified: false,
      reason: "missing-controls",
      missingControls: ["share"],
    });
  });

  it("reports rendered screen via useReportRenderedScreen hook and cleans up on unmount", () => {
    function TestScreen({ report }: { report: RenderedScreenReport | null }) {
      useReportRenderedScreen(report);
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(TestScreen, {
          report: {
            screenId: "meeting-note",
            entityType: "note",
            entityId: "note-7",
            objectTitle: "Weekly Sync",
            interactiveControls: ["edit-body", "add-action-item"],
          },
        }),
      );
    });

    const settled: ScreenSettledReceipt[] = [];
    const listener = (event: Event) => {
      settled.push((event as CustomEvent<ScreenSettledReceipt>).detail);
    };
    window.addEventListener(SCREEN_SETTLED_EVENT, listener);
    postScreenSettled({
      writeId: "write-hook",
      url: "/notes/note-7",
      tabId: "tab-hook",
    });
    window.removeEventListener(SCREEN_SETTLED_EVENT, listener);

    expect(settled[0]?.renderedScreen).toEqual({
      screenId: "meeting-note",
      entityType: "note",
      entityId: "note-7",
      objectTitle: "Weekly Sync",
      interactiveControls: ["edit-body", "add-action-item"],
    });

    act(() => {
      root.unmount();
    });
  });
});
