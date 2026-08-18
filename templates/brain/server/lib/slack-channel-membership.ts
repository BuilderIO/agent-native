export interface SlackChannelMembershipTarget {
  id: string;
  is_im?: boolean;
  is_mpim?: boolean;
  is_channel?: boolean;
  is_group?: boolean;
  is_private?: boolean;
  is_member?: boolean;
}

export interface SlackChannelJoinResponse {
  ok?: boolean;
  error?: string;
}

export type SlackChannelMembershipResult =
  | "not_public"
  | "membership_unknown"
  | "already_member"
  | "joined";

export async function ensureSlackPublicChannelMembership(
  channel: SlackChannelMembershipTarget,
  joinChannel: (channelId: string) => Promise<SlackChannelJoinResponse>,
): Promise<SlackChannelMembershipResult> {
  if (
    channel.is_private === true ||
    channel.is_group === true ||
    channel.is_im === true ||
    channel.is_mpim === true ||
    channel.is_channel === false
  ) {
    return "not_public";
  }
  if (channel.is_member === true) return "already_member";
  if (channel.is_member !== false) return "membership_unknown";

  const result = await joinChannel(channel.id);
  if (result.ok !== false) return "joined";
  if (result.error === "already_in_channel") return "already_member";
  throw new Error(
    `Slack conversations.join failed: ${result.error ?? "unknown"}`,
  );
}
