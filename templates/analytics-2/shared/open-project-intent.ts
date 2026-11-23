const VERB =
  "(?:open|go to|go into|take me to|pull up|bring up|navigate to|jump to|switch to)";
const PATTERN = new RegExp(
  `^(?:please\\s+)?(?:(?:can|could|would)\\s+you\\s+(?:please\\s+)?)?${VERB}\\s+(?:(?:the|my)\\s+)?(?:project|dashboard)\\s+(?:(?:called|named|titled)\\s+)?(.+)$`,
  "i",
);

const MAX_TITLE_LENGTH = 200;

export function parseOpenProjectIntent(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_TITLE_LENGTH + 60) return null;
  if (/[\r\n]/.test(trimmed)) return null;
  const raw = PATTERN.exec(trimmed)?.[1];
  if (!raw) return null;
  const title = raw
    .trim()
    .replace(/\s+please$/i, "")
    .replace(/[.!?]+$/, "")
    .trim()
    .replace(/^(["'`“‘])(.*)(["'`”’])$/, "$2")
    .trim();
  return title && title.length <= MAX_TITLE_LENGTH ? title : null;
}

const QUESTION_START =
  /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:how|what|which|where|why|who|when|is|are|does|do|did|show|tell|give|summari[sz]e|explain|check|report)\b/i;
const REFERENCE_STOP =
  "my|the|our|in|on|of|for|from|at|with|doing|is|are|was|a|an|this|that|these|those|current|new|latest|last|first|recent|open|create|build|make";
const DASHBOARD_REFERENCE = new RegExp(
  `\\b(?:my|the|our|in|on|from|for)\\s+((?:(?!(?:${REFERENCE_STOP})\\b)[^\\s?.!,;:]+\\s+){0,5}(?!(?:${REFERENCE_STOP})\\b)[^\\s?.!,;:]+)\\s+(?:dashboard|project|board)\\b`,
  "i",
);

export function parseDashboardQuestion(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 300 || /[\r\n]/.test(trimmed)) return null;
  if (!QUESTION_START.test(trimmed) && !trimmed.endsWith("?")) return null;
  const ref = DASHBOARD_REFERENCE.exec(trimmed)?.[1]?.trim();
  return ref ? ref : null;
}
