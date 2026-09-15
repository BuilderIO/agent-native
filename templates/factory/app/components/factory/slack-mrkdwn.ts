import { safeHttpUrl } from "../../lib/safe-http-url";
import { slackEmojiFor } from "./slack-emoji";

export type SlackMrkdwnNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "codeblock"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "strike"; value: string }
  | { type: "link"; href: string; label: string }
  | { type: "mention"; id: string; value: string }
  | { type: "emoji"; value: string; shortcode: string };

export type SlackMrkdwnOptions = {
  mentionLabels?: Record<string, string>;
  builderSlackUserId?: string | null;
};

const FENCE_RE = /```(?:[\w-]*\n)?([\s\S]*?)```/;
const INLINE_RE =
  /`([^`]+)`|<((?:https?:\/\/)[^|>]+)(?:\|([^>]+))?>|:([a-z0-9_+-]+):|<@([UW][A-Z0-9]+)(?:\|([^>]+))?>|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/i;

export const BUILDER_SLACK_MENTION_LABEL = "@Builder.io";

export function parseSlackMrkdwn(
  input: string,
  options: SlackMrkdwnOptions = {},
): SlackMrkdwnNode[] {
  const nodes: SlackMrkdwnNode[] = [];
  let remaining = input;
  while (remaining.length > 0) {
    const fence = remaining.match(FENCE_RE);
    if (fence && fence.index !== undefined && fence.index >= 0) {
      if (fence.index > 0) {
        nodes.push(...parseInline(remaining.slice(0, fence.index), options));
      }
      nodes.push({
        type: "codeblock",
        value: fence[1]!.replace(/^\n/, "").replace(/\n$/, ""),
      });
      remaining = remaining.slice(fence.index + fence[0].length);
      continue;
    }
    nodes.push(...parseInline(remaining, options));
    break;
  }
  return nodes;
}

export function resolveSlackMentionLabel(
  userId: string,
  pipeLabel: string | undefined,
  options: SlackMrkdwnOptions = {},
): string {
  const id = userId.trim();
  const fromMap = lookupMentionLabel(id, options.mentionLabels);
  if (fromMap) return formatMentionName(fromMap);
  const builderId = options.builderSlackUserId?.trim();
  if (builderId && id.toUpperCase() === builderId.toUpperCase()) {
    return BUILDER_SLACK_MENTION_LABEL;
  }
  if (pipeLabel?.trim()) return formatMentionName(pipeLabel.trim());
  return `@${id}`;
}

function parseInline(
  input: string,
  options: SlackMrkdwnOptions,
): SlackMrkdwnNode[] {
  const nodes: SlackMrkdwnNode[] = [];
  let remaining = input;
  while (remaining.length > 0) {
    const match = remaining.match(INLINE_RE);
    if (!match || match.index === undefined) {
      if (remaining) nodes.push({ type: "text", value: remaining });
      break;
    }
    if (match.index > 0) {
      nodes.push({ type: "text", value: remaining.slice(0, match.index) });
    }
    if (match[1] !== undefined) {
      nodes.push({ type: "code", value: match[1] });
    } else if (match[2] !== undefined) {
      const href = safeHttpUrl(match[2]);
      if (href) {
        nodes.push({
          type: "link",
          href,
          label: match[3] || href,
        });
      } else {
        nodes.push({ type: "text", value: match[0] });
      }
    } else if (match[4] !== undefined) {
      const shortcode = match[4];
      const emoji = slackEmojiFor(shortcode);
      if (emoji) nodes.push({ type: "emoji", value: emoji, shortcode });
      else nodes.push({ type: "text", value: `:${shortcode}:` });
    } else if (match[5] !== undefined) {
      nodes.push({
        type: "mention",
        id: match[5],
        value: resolveSlackMentionLabel(match[5], match[6], options),
      });
    } else if (match[7] !== undefined) {
      nodes.push({ type: "bold", value: match[7] });
    } else if (match[8] !== undefined) {
      nodes.push({ type: "italic", value: match[8] });
    } else if (match[9] !== undefined) {
      nodes.push({ type: "strike", value: match[9] });
    }
    remaining = remaining.slice(match.index + match[0].length);
  }
  return nodes;
}

function lookupMentionLabel(
  userId: string,
  labels: Record<string, string> | undefined,
): string | undefined {
  if (!labels) return undefined;
  return labels[userId] ?? labels[userId.toUpperCase()];
}

function formatMentionName(name: string): string {
  return name.startsWith("@") ? name : `@${name}`;
}
