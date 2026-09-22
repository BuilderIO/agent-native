import { safeHttpUrl } from "@/lib/safe-http-url";

export function slackThreadUrl(channelId: string, threadTs: string): string {
  const compactTs = threadTs.replace(".", "");
  return `https://slack.com/archives/${encodeURIComponent(channelId)}/p${compactTs}?thread_ts=${encodeURIComponent(threadTs)}`;
}

export function resolveInboxSourceUrl({
  sourceUrl,
  channelId,
  threadTs,
}: {
  sourceUrl?: string | null;
  channelId?: string | null;
  threadTs?: string | null;
}): string | null {
  const stored = safeHttpUrl(sourceUrl);
  if (stored) return stored;
  const channel = channelId?.trim();
  const ts = threadTs?.trim();
  if (!channel || !ts) return null;
  return safeHttpUrl(slackThreadUrl(channel, ts));
}
