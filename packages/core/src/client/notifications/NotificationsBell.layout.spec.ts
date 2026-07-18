import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./NotificationsBell.tsx", import.meta.url),
  "utf8",
);

describe("NotificationsBell routing layout", () => {
  it("progressively discloses personal routing without exposing secret values", () => {
    expect(source).toContain('aria-label="Notification delivery settings"');
    expect(source).toContain('label="In-app inbox"');
    expect(source).toContain('label="Browser alerts"');
    expect(source).toContain('label="Email"');
    expect(source).toContain('label="Personal Slack"');
    expect(source).toContain("Webhook secret key name");
    expect(source).toContain("Store its webhook URL in Secrets");
    expect(source).not.toContain("Team Slack webhook");
  });

  it("uses named client methods instead of route fetches", () => {
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("/_agent-native/notifications");
    expect(source).toContain("updatePersonalNotificationRouting");
    expect(source).toContain("listClientNotifications");
  });

  it("keeps host-specific notification settings in the bell menu", () => {
    expect(source).toContain("contextualSettings?: ReactNode");
    expect(source).toContain("{contextualSettings}");
    expect(source.indexOf("{contextualSettings}")).toBeGreaterThan(
      source.indexOf('className="max-h-96 overflow-y-auto"'),
    );
  });
});
