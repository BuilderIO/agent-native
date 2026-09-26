import { useT } from "@agent-native/core/client/i18n";
import {
  registerChannelSettingsExtensions,
  SettingsGroup,
  SettingsRow,
} from "@agent-native/core/client/settings";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

/**
 * Mail's part of Settings › Channels › Slack. Mentioning the agent in Slack
 * queues a draft for review; the agent's own Slack connection and its switch
 * are the core group below this one.
 */
function SlackDraftRequests() {
  const t = useT();
  return (
    <SettingsGroup id="draft-requests" title={t("settings.slackDraftRequests")}>
      <SettingsRow
        id="slack-draft-queue"
        label={t("settings.slackDraftQueue")}
        description={t("settings.slackDraftQueueDescription")}
        control={
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs"
          >
            <Link to="/draft-queue">{t("settings.openDraftQueue")}</Link>
          </Button>
        }
      />
    </SettingsGroup>
  );
}

registerChannelSettingsExtensions([
  {
    id: "mail-draft-requests",
    platform: "slack",
    component: SlackDraftRequests,
  },
]);
