import { resolveConnectorSecret } from "../connectors/credentials.js";
import {
  getChannelHistory as readChannelHistory,
  addEyesReaction as writeEyesReaction,
  authTest as readAuthTest,
  getEyesReaction as readEyesReaction,
  getThread as readThread,
  getTeamInfo as readTeamInfo,
  getUserInfo as readUserInfo,
  postThreadReply as writeThreadReply,
  type ChannelHistoryResult,
  type SlackMessage,
  type SlackPostMessageResult,
  type SlackReactionResult,
  type SlackReactionState,
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
  const verifiedWorkspaces = new Set<Workspace>();

  async function verifyAgentNativeIdentity(
    workspace: Workspace,
  ): Promise<void> {
    if (verifiedWorkspaces.has(workspace)) return;
    const auth = await readAuthTest(workspace, tokenResolver);
    const userName = auth.userName.trim().replace(/^@/, "").toLowerCase();
    if (userName !== "agent-native") {
      throw new Error(
        `Slack credential authenticated as @${auth.userName}, not @agent-native.`,
      );
    }
    verifiedWorkspaces.add(workspace);
  }

  return {
    async getChannelHistory(
      workspace: Workspace,
      channelId: string,
      limit?: number,
      cursor?: string,
    ): Promise<ChannelHistoryResult> {
      await verifyAgentNativeIdentity(workspace);
      return readChannelHistory(
        workspace,
        channelId,
        limit,
        cursor,
        tokenResolver,
      );
    },
    async getTeamInfo(workspace: Workspace): Promise<SlackTeamInfo> {
      await verifyAgentNativeIdentity(workspace);
      return readTeamInfo(workspace, tokenResolver);
    },
    async getUserInfo(
      workspace: Workspace,
      userId: string,
    ): Promise<SlackUserInfo> {
      await verifyAgentNativeIdentity(workspace);
      return readUserInfo(workspace, userId, tokenResolver);
    },
    async getThread(
      workspace: Workspace,
      channelId: string,
      threadTs: string,
      limit?: number,
      cursor?: string,
    ): Promise<ThreadRepliesResult> {
      await verifyAgentNativeIdentity(workspace);
      return readThread(
        workspace,
        channelId,
        threadTs,
        limit,
        cursor,
        tokenResolver,
      );
    },
    async addEyesReaction(
      workspace: Workspace,
      channelId: string,
      timestamp: string,
    ): Promise<SlackReactionResult> {
      await verifyAgentNativeIdentity(workspace);
      return writeEyesReaction(workspace, channelId, timestamp, tokenResolver);
    },
    async postThreadReply(
      workspace: Workspace,
      channelId: string,
      threadTs: string,
      text: string,
    ): Promise<SlackPostMessageResult> {
      await verifyAgentNativeIdentity(workspace);
      return writeThreadReply(
        workspace,
        channelId,
        threadTs,
        text,
        tokenResolver,
      );
    },
    async getEyesReaction(
      workspace: Workspace,
      channelId: string,
      timestamp: string,
    ): Promise<SlackReactionState> {
      await verifyAgentNativeIdentity(workspace);
      return readEyesReaction(workspace, channelId, timestamp, tokenResolver);
    },
    async getCompleteThread(
      workspace: Workspace,
      channelId: string,
      threadTs: string,
    ): Promise<{ messages: SlackMessage[]; hasMore: boolean }> {
      const messages: SlackMessage[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const result = await this.getThread(
          workspace,
          channelId,
          threadTs,
          100,
          cursor,
        );
        messages.push(...result.messages);
        if (!result.has_more) return { messages, hasMore: false };
        if (!result.next_cursor) {
          throw new Error(
            "Slack thread pagination is incomplete because the provider omitted its next cursor.",
          );
        }
        cursor = result.next_cursor;
      }
      return { messages, hasMore: true };
    },
    verifyAgentNativeIdentity,
  };
}
