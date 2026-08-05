import { describe, expect, it } from "vitest";

import {
  automationIdentity,
  automationNextRun,
  automationScopeLabel,
  automationStatus,
  automationTarget,
  automationTroubleshootPath,
  sortAutomations,
} from "./automation-display.js";
import type { DispatchAutomationItem } from "./automations.js";

function item(
  overrides: Partial<DispatchAutomationItem> &
    Pick<DispatchAutomationItem, "id" | "name" | "path" | "owner">,
): DispatchAutomationItem {
  return {
    enabled: true,
    ...overrides,
  };
}

describe("automation-display", () => {
  it("builds a stable owner:path identity", () => {
    expect(
      automationIdentity({ owner: "user@example.com", path: "jobs/digest.md" }),
    ).toBe("user@example.com:jobs/digest.md");
  });

  it("prepares a thread-debug search for an automation", () => {
    expect(
      automationTroubleshootPath({ name: "coach onboarding reminder" }),
    ).toBe("/thread-debug?query=coach+onboarding+reminder");
  });

  it("prefers event names, then schedule descriptions", () => {
    expect(
      automationTarget(
        item({
          id: "1",
          name: "Alert",
          path: "jobs/alert.md",
          owner: "user@example.com",
          triggerType: "event",
          event: "calendar.booking.created",
        }),
      ),
    ).toBe("calendar.booking.created");

    expect(
      automationTarget(
        item({
          id: "2",
          name: "Digest",
          path: "jobs/digest.md",
          owner: "user@example.com",
          scheduleDescription: "Weekdays at 9am",
          schedule: "0 9 * * 1-5",
        }),
      ),
    ).toBe("Weekdays at 9am");
  });

  it("reports paused next-run and status for disabled automations", () => {
    const paused = item({
      id: "3",
      name: "Paused",
      path: "jobs/paused.md",
      owner: "user@example.com",
      enabled: false,
      lastStatus: "success",
    });
    expect(automationNextRun(paused)).toBe("paused");
    expect(automationStatus(paused)).toEqual({
      label: "Paused",
      tone: "muted",
    });
  });

  it("labels blocked scheduler checks separately from execution failures", () => {
    const blocked = item({
      id: "blocked",
      name: "Blocked",
      path: "jobs/blocked.md",
      owner: "user@example.com",
      lastStatus: "skipped",
      lastError: "Condition was false",
    });

    expect(automationStatus(blocked)).toEqual({
      label: "Blocked",
      tone: "warning",
    });
  });

  it("identifies personal and organization ownership in the UI", () => {
    expect(
      automationScopeLabel(
        item({
          id: "personal",
          name: "Personal",
          path: "jobs/personal.md",
          owner: "user@example.com",
        }),
      ),
    ).toBe("Personal");
    expect(
      automationScopeLabel(
        item({
          id: "organization",
          name: "Organization",
          path: "jobs/organization.md",
          owner: "__organization__:org-1",
        }),
      ),
    ).toBe("Organization");
  });

  it("sorts enabled errors ahead of healthy runs", () => {
    const healthy = item({
      id: "healthy",
      name: "Healthy",
      path: "jobs/healthy.md",
      owner: "user@example.com",
      lastStatus: "success",
      lastRun: "2026-07-08T10:00:00.000Z",
    });
    const errored = item({
      id: "error",
      name: "Broken",
      path: "jobs/broken.md",
      owner: "user@example.com",
      lastStatus: "error",
      lastRun: "2026-07-08T09:00:00.000Z",
    });
    expect(sortAutomations([healthy, errored]).map((row) => row.id)).toEqual([
      "error",
      "healthy",
    ]);
  });
});
