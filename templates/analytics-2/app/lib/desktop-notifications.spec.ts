// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  notifyRunFinished,
  parseDesktopNotificationSettings,
} from "./desktop-notifications";

/**
 * Settings > Notifications > "Desktop notifications" (sweep analytics-2#4): the
 * switch persisted a value nothing read, so flipping it had no effect a person
 * could see. `notifyRunFinished` is the reader; these cases pin when it fires.
 */
describe("desktop notifications for a finished run", () => {
  const shown: string[] = [];
  const show = (title: string) => {
    shown.push(title);
  };

  it("raises a notice for a background run when the switch is on", () => {
    shown.length = 0;
    expect(
      notifyRunFinished({
        enabled: true,
        title: "Notebook run finished",
        body: "done",
        hidden: true,
        show,
      }),
    ).toBe(true);
    expect(shown).toEqual(["Notebook run finished"]);
  });

  it("stays silent when the switch is off", () => {
    shown.length = 0;
    expect(
      notifyRunFinished({
        enabled: false,
        title: "Notebook run finished",
        body: "done",
        hidden: true,
        show,
      }),
    ).toBe(false);
    expect(shown).toEqual([]);
  });

  it("stays silent while the notebook is on screen", () => {
    shown.length = 0;
    expect(
      notifyRunFinished({
        enabled: true,
        title: "Notebook run finished",
        body: "done",
        hidden: false,
        show,
      }),
    ).toBe(false);
    expect(shown).toEqual([]);
  });

  it("stays silent when the browser refused permission", () => {
    shown.length = 0;
    expect(
      notifyRunFinished({
        enabled: true,
        title: "Notebook run finished",
        body: "done",
        hidden: true,
        show,
        permission: "denied",
      }),
    ).toBe(false);
    expect(shown).toEqual([]);
  });
});

describe("the stored switch", () => {
  it("reads a stored true and defaults everything else to off", () => {
    expect(
      parseDesktopNotificationSettings('{"desktopNotifications":true}')
        .desktopNotifications,
    ).toBe(true);
    expect(
      parseDesktopNotificationSettings('{"desktopNotifications":"yes"}')
        .desktopNotifications,
    ).toBe(false);
    expect(
      parseDesktopNotificationSettings("not json").desktopNotifications,
    ).toBe(false);
    expect(
      parseDesktopNotificationSettings(undefined).desktopNotifications,
    ).toBe(false);
  });
});
