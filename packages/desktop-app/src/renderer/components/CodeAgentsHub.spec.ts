// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MultiFrontierIpcEvent } from "../../../shared/multi-frontier-ipc.js";
import { MultiFrontierModeControl } from "./CodeAgentsHub.js";
import {
  initialMultiFrontierRunAutoContinue,
  locksMultiFrontierMode,
  providerOperationFailureNotice,
  readNewerMultiFrontierSnapshot,
} from "./multi-frontier-renderer-state.js";

describe("CodeAgentsHub multi-frontier event boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("rejects wrong-collaboration and stale events while preserving notices", () => {
    const event = {
      schemaVersion: 1,
      type: "event",
      collaborationId: "collaboration-1",
      sequence: 4,
      event: {
        kind: "notice",
        text: "Recovered safely.",
      },
    } satisfies MultiFrontierIpcEvent;

    expect(
      readNewerMultiFrontierSnapshot("collaboration-1", 4, event),
    ).toBeNull();
    expect(
      readNewerMultiFrontierSnapshot("other-collaboration", 3, event),
    ).toBeNull();
    expect(readNewerMultiFrontierSnapshot("collaboration-1", 3, event)).toEqual(
      {
        sequence: 4,
        snapshot: undefined,
        notice: {
          id: "collaboration-1:4",
          kind: "info",
          message: "Recovered safely.",
        },
      },
    );
  });

  it("seeds each run from the persisted default without coupling later edits", () => {
    const persistedDefault = { autoContinueAfterAgreement: true };
    let runAutoContinue = initialMultiFrontierRunAutoContinue(persistedDefault);

    runAutoContinue = false;

    expect(runAutoContinue).toBe(false);
    expect(persistedDefault).toEqual({ autoContinueAfterAgreement: true });
  });

  it("keeps the collaboration mode selected until a run is terminal", () => {
    expect(locksMultiFrontierMode({ phase: "implementing" })).toBe(true);
    expect(locksMultiFrontierMode({ phase: "paused" })).toBe(true);
    expect(locksMultiFrontierMode({ phase: "completed" })).toBe(false);
    expect(locksMultiFrontierMode({ phase: "failed" })).toBe(false);
  });

  it("reports provider-operation failures without surfacing raw provider errors", () => {
    expect(
      providerOperationFailureNotice("claude", "connect", "notice-1"),
    ).toEqual({
      id: "notice-1",
      kind: "failure",
      message:
        "Could not connect for Claude. Try again or check its local sign-in.",
    });
  });

  it("keeps the mode selector keyboard-focusable while a collaboration is inactive", async () => {
    const onModeChange = vi.fn();
    act(() => {
      root.render(
        React.createElement(MultiFrontierModeControl, {
          active: false,
          permissionMode: "full-auto",
          subscriptions: {},
          busy: false,
          modeLocked: false,
          autoContinueAfterAgreement: false,
          defaultAutoContinueAfterAgreement: false,
          onModeChange,
          onConnectSubscription: vi.fn(),
          onRefreshSubscription: vi.fn(),
          onAutoContinueAfterAgreementChange: vi.fn(),
          onDefaultAutoContinueAfterAgreementChange: vi.fn(),
        }),
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Run mode"]',
    );
    expect(trigger).not.toBeNull();
    act(() => trigger?.focus());
    expect(document.activeElement).toBe(trigger);

    await act(async () => {
      trigger?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      await Promise.resolve();
    });

    const options = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    expect(options.map((option) => option.textContent)).toContain(
      "Multi-Frontier",
    );

    const multiFrontierOption = options.find(
      (option) => option.textContent === "Multi-Frontier",
    );
    expect(multiFrontierOption).toBeDefined();

    await act(async () => {
      multiFrontierOption?.click();
      await Promise.resolve();
    });

    expect(onModeChange).toHaveBeenCalledWith("multi-frontier");
  });
});
