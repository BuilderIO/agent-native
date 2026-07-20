// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

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
import { MultiFrontierParticipantSettings } from "./MultiFrontierWorkspace.js";

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
    expect(
      container.querySelector(".code-agents-multi-frontier-control"),
    ).toContain(trigger);
    expect(
      trigger?.classList.contains("code-agents-multi-frontier-mode-select"),
    ).toBe(true);
    expect(trigger?.classList.contains("desktop-select-trigger")).toBe(true);
    expect(container.textContent).not.toContain("Participants");
    expect(container.textContent).not.toContain("Connect");
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
    const menu = document.querySelector<HTMLElement>('[role="listbox"]');
    expect(menu?.classList.contains("code-agents-select-content")).toBe(true);
    expect(
      menu?.classList.contains("code-agents-multi-frontier-mode-menu"),
    ).toBe(true);
    expect(
      options.every((option) =>
        option.classList.contains("code-agents-multi-frontier-mode-menu-item"),
      ),
    ).toBe(true);
    expect(document.body.textContent).toContain(
      "Codex + Claude plan, review, then one builds",
    );
    expect(
      document.querySelector<HTMLElement>("[aria-label='Run mode']")
        ?.textContent,
    ).toContain("Auto");
    expect(
      document.querySelector<HTMLElement>("[aria-label='Run mode']")
        ?.textContent,
    ).not.toContain("One agent plans and builds");

    const multiFrontierOption = options.find((option) =>
      option.textContent?.startsWith("Multi-Frontier"),
    );
    expect(multiFrontierOption).toBeDefined();

    await act(async () => {
      multiFrontierOption?.click();
      await Promise.resolve();
    });

    expect(onModeChange).toHaveBeenCalledWith("multi-frontier");

    act(() => {
      root.render(
        React.createElement(MultiFrontierModeControl, {
          active: true,
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
    expect(container.textContent).toContain("Connect");
  });

  it("registers toolkit overlay styles in the desktop Tailwind build", () => {
    const shellCss = readFileSync("src/renderer/shell.css", "utf8");

    expect(shellCss).toContain('@import "@agent-native/toolkit/styles.css";');
  });

  it("renders a live provider update in the subscription usage popover", async () => {
    act(() => {
      root.render(
        React.createElement(MultiFrontierParticipantSettings, {
          statuses: {
            codex: {
              schemaVersion: 1,
              providerId: "codex",
              connectionState: "connected",
              telemetry: {
                state: "live",
                source: "codex-app-server",
                updatedAt: "2026-07-19T12:00:00.000Z",
                capabilities: {
                  account: false,
                  plan: false,
                  rateLimits: true,
                  modelTierRateLimits: false,
                  contextWindow: false,
                  credits: false,
                  liveUpdates: true,
                },
                meters: [
                  {
                    id: "five-hour",
                    kind: "five-hour",
                    state: "available",
                    usedPercent: 42,
                  },
                ],
              },
            },
          },
          busy: false,
          autoContinueAfterAgreement: false,
          defaultAutoContinueAfterAgreement: false,
        }),
      );
    });

    const participants = container.querySelector<HTMLButtonElement>("button");
    expect(participants).toBeDefined();
    await act(async () => {
      participants?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      participants?.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain(
      "Usage is updating from the connected subscription",
    );
  });
});
