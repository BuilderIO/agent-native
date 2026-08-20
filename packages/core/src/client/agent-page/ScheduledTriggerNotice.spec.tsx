// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, string | undefined>): string =>
      String(options?.defaultValue ?? key),
}));

import type {
  ScheduledTriggerState,
  ScheduledTriggerStatus,
} from "./scheduled-trigger-state.js";
import { ScheduledTriggerNotice } from "./ScheduledTriggerNotice.js";

describe("ScheduledTriggerNotice", () => {
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

  function render(status: ScheduledTriggerStatus) {
    return renderState({ kind: "resolved", status });
  }

  function renderState(state: ScheduledTriggerState) {
    act(() => {
      root.render(<ScheduledTriggerNotice state={state} />);
    });
    return container.querySelector('[data-testid="scheduled-trigger-notice"]');
  }

  it("renders nothing before the status resolves", () => {
    expect(renderState({ kind: "loading" })).toBeNull();
  });

  // The bug this guards: a failed status query used to be indistinguishable
  // from a healthy one, so an unreachable/403/404 check silently vouched for
  // every "Next run" date on the page.
  it("says the check failed instead of vouching for the deploy", () => {
    const notice = renderState({ kind: "unknown", error: new Error("403") });

    expect(notice).not.toBeNull();
    expect(notice?.getAttribute("data-reason")).toBe("check-failed");
    expect(notice?.textContent).toContain(
      "Couldn't check whether schedules run here",
    );
    expect(notice?.textContent).toContain("unconfirmed");
  });

  // A weaker claim must not look like the strong one, or readers learn to
  // discount the banner that actually means schedules are dead.
  it("keeps the failed check visually distinct from a known-dead scheduler", () => {
    const unknown = renderState({ kind: "unknown", error: null });
    const unknownClass = unknown?.className ?? "";
    const unknownHasDisclosure = Boolean(unknown?.querySelector("details"));
    const dead = render({ available: false, reason: "disabled-by-env" });

    expect(unknownClass).not.toContain("amber");
    expect(dead?.className).toContain("amber");
    // Nothing to toggle: the check failing is not a setting anyone can flip.
    expect(unknownHasDisclosure).toBe(false);
  });

  it("renders nothing when a driver will fire schedules", () => {
    expect(
      render({ available: true, driver: "netlify-scheduled-function" }),
    ).toBeNull();
    expect(render({ available: true, driver: "in-process" })).toBeNull();
  });

  // Naming the env var is the point: the reader's next question is always "so
  // how do I turn it back on", and the answer is not discoverable from the UI.
  it("names the build kill switch when that is what turned schedules off", () => {
    const notice = render({ available: false, reason: "disabled-by-env" });

    expect(notice?.getAttribute("data-reason")).toBe("disabled-by-env");
    expect(notice?.textContent).toContain("Schedules won't run in this deploy");
    expect(notice?.textContent).toContain(
      "AGENT_NATIVE_DISABLE_RECURRING_JOBS",
    );
  });

  // Only the build re-emits the scheduled trigger, so naming the runtime scope
  // would send the reader somewhere that cannot fix it.
  it("tells the reader how to turn schedules back on, accurately", () => {
    const notice = render({ available: false, reason: "disabled-by-env" });

    expect(notice?.textContent).toContain(
      "AGENT_NATIVE_DISABLE_RECURRING_JOBS=false",
    );
    expect(notice?.textContent).toContain("build");
    expect(notice?.textContent).not.toContain(
      "AGENT_NATIVE_ENABLE_RECURRING_JOBS=",
    );
  });

  it("blames the hosting target when no scheduler exists for it", () => {
    const notice = render({
      available: false,
      reason: "no-platform-scheduler",
    });

    expect(notice?.textContent).toContain("Schedules won't run in this deploy");
    expect(notice?.textContent).toContain("no durable scheduler");
  });

  // A dev machine is not a broken deploy; saying so would train people to
  // ignore the banner in the one place it means something.
  it("distinguishes local development and names the local opt-in", () => {
    const notice = render({ available: false, reason: "local-development" });

    expect(notice?.textContent).toContain(
      "Schedules don't run in local development",
    );
    expect(notice?.textContent).toContain(
      "AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS",
    );
    expect(notice?.textContent).not.toContain("this deploy");
  });

  it("tells the reader what still works, so the warning is actionable", () => {
    const notice = render({ available: false, reason: "disabled-by-env" });

    expect(notice?.textContent).toContain("Event-triggered automations");
  });

  // Collapsed, not absent: the fix is secondary to the warning but must stay
  // reachable by find-in-page, which a useState toggle would break.
  it("keeps the fix in a disclosure that starts closed", () => {
    const notice = render({ available: false, reason: "disabled-by-env" });
    const details = notice?.querySelector("details");

    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain(
      "Show more",
    );
    expect(details?.querySelector("summary")?.textContent).toContain(
      "Show less",
    );
    expect(details?.textContent).toContain(
      "AGENT_NATIVE_DISABLE_RECURRING_JOBS=false",
    );
  });

  it("offers the local opt-in through the same disclosure", () => {
    const notice = render({ available: false, reason: "local-development" });

    expect(notice?.querySelector("details")?.textContent).toContain(
      "AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS=true",
    );
  });

  // An empty disclosure would promise a fix that does not exist: this host has
  // no scheduler to switch on.
  it("shows no disclosure when nothing is toggleable", () => {
    const notice = render({
      available: false,
      reason: "no-platform-scheduler",
    });

    expect(notice?.querySelector("details")).toBeNull();
  });
});
