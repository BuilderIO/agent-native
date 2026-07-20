// @vitest-environment happy-dom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MultiFrontierRendererState } from "../../../shared/multi-frontier-ipc.js";
import type { SubscriptionStatus } from "../../../shared/subscription-status.js";
import {
  agreementPolicyForWorkspace,
  createMultiFrontierInput,
  controlsForState,
  MultiFrontierParticipantSettings,
  MultiFrontierWorkspace,
  usageSummary,
  UsageMeter,
} from "./MultiFrontierWorkspace.js";

describe("MultiFrontierWorkspace presentation helpers", () => {
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

  it("only exposes GO after convergence is awaiting explicit approval", () => {
    expect(
      controlsForState({ phase: "awaiting_go", approvalState: "pending" }),
    ).toMatchObject({ canGo: true, canPause: true, canCancel: true });
    expect(
      controlsForState({ phase: "awaiting_go", approvalState: "rejected" }),
    ).toMatchObject({ canGo: false });
    expect(
      controlsForState({
        phase: "awaiting_go",
        approvalState: "pending",
        autoContinueAfterAgreement: true,
      }),
    ).toMatchObject({ canGo: false });
  });

  it("does not expose controls for terminal collaborations", () => {
    expect(
      controlsForState({ phase: "completed", approvalState: "not_required" }),
    ).toEqual({
      canStart: false,
      canGo: false,
      canPause: false,
      canResume: false,
      canCancel: false,
      canSwap: false,
      canReReview: false,
    });
  });

  it("only permits role swaps at reviewed handoff boundaries", () => {
    expect(
      controlsForState({ phase: "awaiting_go", approvalState: "approved" }),
    ).toMatchObject({ canSwap: true });
    expect(
      controlsForState({
        phase: "checkpoint_review",
        approvalState: "not_required",
      }),
    ).toMatchObject({ canSwap: true });
    expect(
      controlsForState({ phase: "implementing", approvalState: "approved" }),
    ).toMatchObject({ canSwap: false });
    expect(
      controlsForState({ phase: "proposing", approvalState: "not_required" }),
    ).toMatchObject({ canSwap: false });
  });

  it("makes the Claude live-usage degradation explicit", () => {
    expect(
      usageSummary({
        schemaVersion: 1,
        providerId: "claude",
        connectionState: "connected",
        telemetry: {
          state: "unsupported",
          source: "connection-only",
          capabilities: {
            account: false,
            plan: true,
            rateLimits: false,
            modelTierRateLimits: false,
            contextWindow: false,
            credits: false,
            liveUpdates: false,
          },
          meters: [],
        },
      }),
    ).toContain("non-interactive Claude sessions");
  });

  it("never represents unreported usage as a zero-percent progress bar", () => {
    const markup = renderToStaticMarkup(
      createElement(UsageMeter, {
        meter: {
          id: "weekly",
          kind: "weekly",
          state: "unsupported",
          message: "Not reported by this provider",
        },
      }),
    );

    expect(markup).toContain("Not reported by this provider");
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain('aria-valuenow="0"');
  });

  it("renders live notices and an accessible cancellation confirmation", () => {
    const markup = renderToStaticMarkup(
      createElement(MultiFrontierWorkspace, {
        state: rendererState("awaiting_go"),
        notices: [
          { id: "recovery", kind: "recovery", message: "Recovered safely." },
          { id: "failure", kind: "failure", message: "A participant failed." },
        ],
        onSecondaryAction: () => undefined,
      }),
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("More collaboration actions");
    expect(markup).toContain("Evidence · 0");
  });

  it("defaults each run to explicit GO", () => {
    expect(createMultiFrontierInput("Review this change")).toEqual({
      prompt: "Review this change",
      autoContinueAfterAgreement: false,
    });
  });

  it("keeps prompt entry in the existing code-agent composer", () => {
    const markup = renderToStaticMarkup(
      createElement(MultiFrontierWorkspace, {
        subscriptions: {},
        autoContinueAfterAgreement: false,
      }),
    );

    expect(markup).toContain("Connect subscriptions to begin");
    expect(markup).not.toContain("textarea");
  });

  it("keeps subscription details collapsed until they are explicitly expanded", async () => {
    act(() => {
      root.render(
        createElement(MultiFrontierParticipantSettings, {
          statuses: {
            codex: connectedSubscription("codex", "Pro"),
            claude: connectedSubscription("claude", "Max"),
          },
          busy: false,
          autoContinueAfterAgreement: false,
          defaultAutoContinueAfterAgreement: false,
        }),
      );
    });

    const participants = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Participants",
    );
    expect(
      participants?.classList.contains(
        "code-agents-multi-frontier-participants",
      ),
    ).toBe(true);
    await act(async () => {
      participants?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      participants?.click();
      await Promise.resolve();
    });

    const participantPopover = document.body.querySelector<HTMLElement>(
      '[data-agent-native-multi-frontier-popover="true"]',
    );
    expect(participantPopover).toBeInstanceOf(HTMLElement);
    expect(participantPopover?.classList.contains("border-0")).toBe(false);

    const details = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Show Codex subscription details"]',
    );
    expect(details).toBeInstanceOf(HTMLButtonElement);
    expect(details?.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toContain("ChatGPT subscription");
    expect(document.body.textContent).not.toContain("Pro");

    await act(async () => {
      details?.focus();
      details?.click();
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(details);
    expect(details?.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("ChatGPT subscription");
    expect(document.body.textContent).toContain("Pro");

    const usage = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="View Codex usage"]',
    );
    await act(async () => {
      usage?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      usage?.click();
      await Promise.resolve();
    });

    const popovers = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        '[data-agent-native-multi-frontier-popover="true"]',
      ),
    );
    expect(popovers.length).toBeGreaterThanOrEqual(2);
    expect(
      popovers.some((popover) => popover.textContent?.includes("Codex usage")),
    ).toBe(true);
    expect(
      popovers.every((popover) => !popover.classList.contains("border-0")),
    ).toBe(true);
  });

  it("uses an existing run's persisted agreement policy rather than the new-run draft", () => {
    expect(
      agreementPolicyForWorkspace({ autoContinueAfterAgreement: true }, false),
    ).toEqual({ autoContinueAfterAgreement: true, isReadOnly: true });
    expect(agreementPolicyForWorkspace(undefined, false)).toEqual({
      autoContinueAfterAgreement: false,
      isReadOnly: false,
    });
  });

  it("keeps evidence keyboard-focusable and announces phase changes without expanding it by default", () => {
    const state = rendererState("proposing");
    state.artifacts = [
      {
        id: "proposal-1",
        kind: "proposal",
        summary: "A bounded proposal.",
      },
    ];

    act(() => {
      root.render(createElement(MultiFrontierWorkspace, { state }));
    });

    const evidence = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Evidence · 1"),
    );
    expect(evidence).toBeInstanceOf(HTMLButtonElement);
    expect(evidence?.getAttribute("aria-expanded")).toBe("false");

    act(() => evidence?.focus());
    expect(document.activeElement).toBe(evidence);

    act(() => evidence?.click());
    expect(evidence?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("A bounded proposal.");

    const awaitingGo = { ...state, phase: "awaiting_go" as const };
    act(() => {
      root.render(createElement(MultiFrontierWorkspace, { state: awaitingGo }));
    });
    const phaseStatus = container.querySelector('[role="status"]');
    expect(phaseStatus?.textContent).toContain("awaiting go · Round 1");
    expect(phaseStatus?.getAttribute("aria-live")).toBe("polite");
  });
});

function rendererState(
  phase: MultiFrontierRendererState["phase"],
): MultiFrontierRendererState {
  return {
    rendererStateIsAuthoritative: false,
    collaborationId: "collaboration-1",
    phase,
    round: 1,
    participants: [
      {
        participantId: "codex-1",
        providerId: "codex",
        role: "watchdog",
        permission: "read_only",
        status: "waiting",
        capabilities: ["read-only"],
      },
      {
        participantId: "claude-1",
        providerId: "claude",
        role: "watchdog",
        permission: "read_only",
        status: "waiting",
        capabilities: ["read-only"],
      },
    ],
    approvalState: "pending",
    artifacts: [],
    subscriptions: {},
  };
}

function connectedSubscription(
  providerId: "codex" | "claude",
  plan: string,
): SubscriptionStatus {
  return {
    schemaVersion: 1,
    providerId,
    connectionState: "connected",
    plan: { label: plan },
    telemetry: {
      state: "live",
      source:
        providerId === "codex" ? "codex-app-server" : "claude-status-line",
      capabilities: {
        account: false,
        plan: true,
        rateLimits: false,
        modelTierRateLimits: false,
        contextWindow: false,
        credits: false,
        liveUpdates: false,
      },
      meters: [],
    },
  };
}
