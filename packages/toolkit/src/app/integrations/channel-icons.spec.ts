import { listBuiltInChannelIntegrations } from "@agent-native/core/integrations/catalog";
import { IconPlug } from "@tabler/icons-react";
import { describe, expect, it } from "vitest";

import { channelIcon } from "./channel-icons.js";

describe("channel icons", () => {
  it("has an icon for every built-in channel", () => {
    for (const entry of listBuiltInChannelIntegrations()) {
      expect(channelIcon(entry.iconKey)).not.toBe(IconPlug);
    }
  });
});
