export type SlackMrkdwnNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "codeblock"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "strike"; value: string }
  | { type: "link"; href: string; label: string }
  | { type: "mention"; value: string };

const FENCE_RE = /```(?:[\w-]*\n)?([\s\S]*?)```/;
const INLINE_RE =
  /`([^`]+)`|<((?:https?:\/\/|mailto:)[^|>]+)(?:\|([^>]+))?>|<@([A-Z0-9]+)>|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/;

export function parseSlackMrkdwn(input: string): SlackMrkdwnNode[] {
  const nodes: SlackMrkdwnNode[] = [];
  let remaining = input;
  while (remaining.length > 0) {
    const fence = remaining.match(FENCE_RE);
    if (fence && fence.index !== undefined && fence.index >= 0) {
      if (fence.index > 0) {
        nodes.push(...parseInline(remaining.slice(0, fence.index)));
      }
      nodes.push({
        type: "codeblock",
        value: fence[1]!.replace(/^\n/, "").replace(/\n$/, ""),
      });
      remaining = remaining.slice(fence.index + fence[0].length);
      continue;
    }
    nodes.push(...parseInline(remaining));
    break;
  }
  return nodes;
}

function parseInline(input: string): SlackMrkdwnNode[] {
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
      nodes.push({
        type: "link",
        href: match[2],
        label: match[3] || match[2],
      });
    } else if (match[4] !== undefined) {
      nodes.push({ type: "mention", value: `@${match[4]}` });
    } else if (match[5] !== undefined) {
      nodes.push({ type: "bold", value: match[5] });
    } else if (match[6] !== undefined) {
      nodes.push({ type: "italic", value: match[6] });
    } else if (match[7] !== undefined) {
      nodes.push({ type: "strike", value: match[7] });
    }
    remaining = remaining.slice(match.index + match[0].length);
  }
  return nodes;
}
