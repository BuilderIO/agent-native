import { resolveConnectorSecret } from "../connectors/credentials.js";
import {
  getChannelHistory as readChannelHistory,
  addEyesReaction as writeEyesReaction,
  getThread as readThread,
  getTeamInfo as readTeamInfo,
  getUserInfo as readUserInfo,
  postThreadReply as writeThreadReply,
  type ChannelHistoryResult,
  type SlackPostMessageResult,
  type SlackReactionResult,
  type SlackTeamInfo,
  type SlackUserInfo,
  type SlackTokenResolver,
  type ThreadRepliesResult,
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
    getUserInfo(workspace: Workspace, userId: string): Promise<SlackUserInfo> {
      return readUserInfo(workspace, userId, tokenResolver);
    },
    getThread(
      workspace: Workspace,
      channelId: string,
      threadTs: string,
      limit?: number,
      cursor?: string,
    ): Promise<ThreadRepliesResult> {
      return readThread(
        workspace,
        channelId,
        threadTs,
        limit,
        cursor,
        tokenResolver,
      );
    },
    addEyesReaction(
      workspace: Workspace,
      channelId: string,
      timestamp: string,
    ): Promise<SlackReactionResult> {
      return writeEyesReaction(workspace, channelId, timestamp, tokenResolver);
    },
    postThreadReply(
      workspace: Workspace,
      channelId: string,
      threadTs: string,
      text: string,
    ): Promise<SlackPostMessageResult> {
      return writeThreadReply(
        workspace,
        channelId,
        threadTs,
        text,
        tokenResolver,
      );
    },
  };
}
