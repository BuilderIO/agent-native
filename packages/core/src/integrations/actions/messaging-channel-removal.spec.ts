import { describe, expect, it } from "vitest";

import confirmRemoval from "./confirm-messaging-channel-credential-removal.js";
import prepareRemoval from "./prepare-messaging-channel-credential-removal.js";

describe("messaging channel credential removal actions", () => {
  it("keeps snapshot and token issuance actions behind the signed-in UI", async () => {
    for (const action of [prepareRemoval, confirmRemoval]) {
      expect(action).toMatchObject({
        uiOnly: true,
        agentTool: false,
        mcpTool: false,
        toolCallable: false,
      });
    }
    await expect(
      prepareRemoval.run(
        { platform: "telegram", keys: ["TELEGRAM_BOT_TOKEN"] },
        { caller: "agent" } as never,
      ),
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "ui_only_action" });
    await expect(
      confirmRemoval.run(
        {
          platform: "telegram",
          candidates: [{ key: "TELEGRAM_BOT_TOKEN", candidate: "snapshot" }],
        },
        { caller: "agent" } as never,
      ),
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "ui_only_action" });
  });
});
