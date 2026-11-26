import { describe, expect, it } from "vitest";

import * as notifications from "./index.js";
import * as registry from "./registry.js";
import * as store from "./store.js";

describe("notifications public surface", () => {
  it("exposes archiving through the channel-aware registry", () => {
    expect(notifications.setNotificationArchived).toBe(
      registry.setNotificationArchived,
    );
    expect(notifications.archiveNotifications).toBe(
      registry.archiveNotifications,
    );
  });

  it("exposes inbox-only writes that bypass channel fan-out", () => {
    expect(notifications.ensureInboxReady).toBe(store.ensureTable);
    expect(notifications.insertInboxNotification).toBe(
      store.insertNotification,
    );
    expect(notifications.insertInboxNotification).not.toBe(
      notifications.notify,
    );
  });
});
