const SLACK_CHANNEL_ID = /^[CGD][A-Z0-9]{2,}$/;

/** A Slack channel, private channel or DM id such as `C0123ABCD`; a name like `#eng` is not one. */
export function isSlackChannelId(value: string): boolean {
  return SLACK_CHANNEL_ID.test(value);
}
