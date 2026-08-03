import { resolveConnectorSecret } from "../connectors/credentials.js";
import {
  getChannelHistory as readChannelHistory,
  getTeamInfo as readTeamInfo,
  type ChannelHistoryResult,
  type SlackTeamInfo,
  type SlackTokenResolver,
  type Workspace,
} from "../connectors/slack.js";

export interface SlackReaderIdentity {
  ownerEmail: string;
  orgId?: string | null;
}

function createTokenResolver({
  ownerEmail,
  orgId,
}: SlackReaderIdentity): SlackTokenResolver {
  return async (workspace) => {
    const key =
      workspace === "secondary" ? "SLACK_BOT_TOKEN_2" : "SLACK_BOT_TOKEN";
    const token = await resolveConnectorSecret(key, ownerEmail, { orgId });
    if (!token) {
      throw new Error(
        `No Slack bot token configured. Connect Slack in Settings → Messaging, or set ${key}.`,
      );
    }
    return token;
  };
}

export function createSlackReader(identity: SlackReaderIdentity) {
  const tokenResolver = createTokenResolver(identity);

  return {
    getChannelHistory(
      workspace: Workspace,
      channelId: string,
      limit?: number,
      cursor?: string,
    ): Promise<ChannelHistoryResult> {
      return readChannelHistory(
        workspace,
        channelId,
        limit,
        cursor,
        tokenResolver,
      );
    },
    getTeamInfo(workspace: Workspace): Promise<SlackTeamInfo> {
      return readTeamInfo(workspace, tokenResolver);
    },
  };
}
