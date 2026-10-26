import { describe, expect, it } from "vitest";

import {
  actionCallIntent,
  preparedCallNeedsApproval,
  type ActionRunContext,
} from "../../action.js";
import manageMessagingChannel from "./manage-messaging-channel.js";

describe("manage-messaging-channel approval", () => {
  it("requires human approval for removal even with a listed confirmation token", async () => {
    const context: ActionRunContext = {
      caller: "tool",
      actionName: "manage-messaging-channel",
    };
    const removal = await actionCallIntent(manageMessagingChannel, {
      operation: "remove-credentials",
      platform: "telegram",
      confirmedCredentials: [
        {
          key: "TELEGRAM_BOT_TOKEN",
          removalConfirmation: "listed-removal-confirmation",
        },
      ],
    });
    expect(removal.valid).toBe(true);
    if (!removal.valid) return;
    await expect(
      preparedCallNeedsApproval(manageMessagingChannel, removal, context),
    ).resolves.toBe(true);

    const disable = await actionCallIntent(manageMessagingChannel, {
      operation: "disable",
      platform: "telegram",
    });
    expect(disable.valid).toBe(true);
    if (!disable.valid) return;
    await expect(
      preparedCallNeedsApproval(manageMessagingChannel, disable, context),
    ).resolves.toBe(false);
  });
});
