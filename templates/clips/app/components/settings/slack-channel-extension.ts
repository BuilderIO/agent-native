import { registerChannelSettingsExtensions } from "@agent-native/core/client/settings";

import { SlackSection } from "./slack-section";

// Settings › Channels › Slack shows Clips' link previews next to the agent's
// own Slack connection.
registerChannelSettingsExtensions([
  { id: "clips-link-previews", platform: "slack", component: SlackSection },
]);
