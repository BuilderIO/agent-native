import { registerChannelSettingsExtensions } from "@agent-native/core/client/settings";
import { createElement } from "react";

import { SlackSection } from "./slack-section";

function SlackLinkPreviews() {
  return createElement(SlackSection, { variant: "channel" });
}

// Settings › Channels › Slack shows Clips' link previews next to the agent's
// own Slack connection.
registerChannelSettingsExtensions([
  {
    id: "clips-link-previews",
    platform: "slack",
    component: SlackLinkPreviews,
  },
]);
