import { describe, expect, it } from "vitest";

import listMessagingChannels from "./list-messaging-channels.js";

describe("integrations actions over MCP", () => {
  it.each([["list-messaging-channels", listMessagingChannels]] as const)(
    "keeps %s in the app, off MCP",
    (_name, action) => {
      expect(action.mcpTool).toBe(false);
    },
  );
});
