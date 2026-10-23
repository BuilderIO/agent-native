import { resolveConnectorSecret } from "../connectors/credentials.js";
import {
  getChannelHistory as readChannelHistory,
  findUserByEmail as readUserByEmail,
  getMessagePermalink as readMessagePermalink,
  authTest as readAuthTest,
  getThread as readThread,
  getTeamInfo as readTeamInfo,
  getUserInfo as readUserInfo,
  postChannelMessage as writeChannelMessage,
  postThreadReply as writeThreadReply,
  type ChannelHistoryResult,
  type SlackAuthTestResult,
  type SlackMessage,
  type SlackPostMessageResult,
  type SlackTeamInfo,
  type SlackUserInfo,
  type SlackUserLookup,
  type SlackTokenResolver,
  type ThreadRepliesResult,
  type Workspace,
} from "../connectors/slack.js";

export interface SlackReaderIdentity {
  ownerEmail: string;
  orgId?: string | null;
}

const AGENT_NATIVE_SLACK_USER_NAMES = new Set(["agent-native", "agentnative"]);

export function isAgentNativeSlackUserName(value: string): boolean {
  return AGENT_NATIVE_SLACK_USER_NAMES.has(
    value.trim().replace(/^@/, "").toLowerCase(),
  );
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
  const identities = new Map<Workspace, SlackAuthTestResult>();

  async function getAgentNativeIdentity(
    workspace: Workspace,
  ): Promise<SlackAuthTestResult> {
    const existing = identities.get(workspace);
    if (existing) return existing;
    const auth = await readAuthTest(workspace, tokenResolver);
    if (!isAgentNativeSlackUserName(auth.userName)) {
      throw new Error(
        `Slack credential authenticated as @${auth.userName}, not @agent-native.`,
      );
    }
    identities.set(workspace, auth);
    return auth;
  }

  async function verifyAgentNativeIdentity(
    workspace: Workspace,
  ): Promise<void> {
    await getAgentNativeIdentity(workspace);
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
    async postChannelMessage(
      workspace: Workspace,
      channelId: string,
      text: string,
    ): Promise<SlackPostMessageResult> {
      await verifyAgentNativeIdentity(workspace);
      return writeChannelMessage(workspace, channelId, text, tokenResolver);
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
    getAgentNativeIdentity,
  };
}

/**
 * The reader plus what a workflow's Slack writes need: resolving an email to a
 * member and linking the posted message. Each call keeps the @agent-native
 * identity check the reader makes.
 */
export function createSlackWorkflowClient(identity: SlackReaderIdentity) {
  const reader = createSlackReader(identity);
  const tokenResolver = createTokenResolver(identity);
  return {
    ...reader,
    async findUserByEmail(
      workspace: Workspace,
      email: string,
    ): Promise<SlackUserLookup | null> {
      await reader.verifyAgentNativeIdentity(workspace);
      return readUserByEmail(workspace, email, tokenResolver);
    },
    async getMessagePermalink(
      workspace: Workspace,
      channelId: string,
      messageTs: string,
    ): Promise<string> {
      await reader.verifyAgentNativeIdentity(workspace);
      return readMessagePermalink(
        workspace,
        channelId,
        messageTs,
        tokenResolver,
      );
    },
  };
}
