import { describe, expect, it } from "vitest";

import { isMailFrameworkAutomation } from "./automation-visibility";

describe("isMailFrameworkAutomation", () => {
  it("keeps scheduled automations created from Mail visible", () => {
    expect(isMailFrameworkAutomation({ appId: "mail" })).toBe(true);
  });

  it("accepts legacy Mail domain and event metadata", () => {
    expect(isMailFrameworkAutomation({ domain: "mail" })).toBe(true);
    expect(
      isMailFrameworkAutomation({
        triggerType: "event",
        event: "mail.message.received",
      }),
    ).toBe(true);
  });

  it("hides automations owned by another app", () => {
    expect(
      isMailFrameworkAutomation({
        appId: "calendar",
        domain: "calendar",
        triggerType: "event",
        event: "calendar.event.created",
      }),
    ).toBe(false);
  });
});
