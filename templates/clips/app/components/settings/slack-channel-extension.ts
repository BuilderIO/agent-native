import { registerChannelSettingsExtensions } from "@agent-native/toolkit/app/settings";
import { createElement } from "react";

import { SlackHuddlesSection } from "./slack-huddles-section";
import { SlackSection } from "./slack-section";

function SlackLinkPreviews() {
  return createElement(SlackSection, { variant: "channel" });
}

// Settings › Channels › Slack shows Clips' link previews next to the agent's
// own Slack connection, and each person's own
// Slack connection for huddle participants.
registerChannelSettingsExtensions([
  {
    id: "clips-link-previews",
    platform: "slack",
    component: SlackLinkPreviews,
  },
  {
    id: "clips-slack-huddles",
    platform: "slack",
    component: SlackHuddlesSection,
  },
]);
