/**
 * A readable model name for any provider: `claude-opus-5-5` → "Claude Opus
 * 5.5", `gpt-5-4-mini` → "GPT-5.4 Mini", `gemini-3-pro` → "Gemini 3 Pro".
 * Unknown ids are returned unchanged rather than guessed at.
 */
export function modelDisplayName(model: string | null | undefined): string {
  const raw = model?.trim();
  if (!raw) return "AI";
  const id = (raw.split("/").pop() ?? raw).toLowerCase();
  const withoutDate = id.replace(/-(?:\d{8}|latest)$/, "");

  const gpt = /^gpt-(\d+)(?:[.-](\d+))?(?:-(.+))?$/.exec(withoutDate);
  if (gpt?.[1]) {
    const version = gpt[2] ? `${gpt[1]}.${gpt[2]}` : gpt[1];
    const variant = gpt[3]?.split("-").map(capitalize).join(" ");
    return variant ? `GPT-${version} ${variant}` : `GPT-${version}`;
  }

  const family = /^(claude|gemini|gemma)-(.+)$/.exec(withoutDate);
  if (family?.[1] && family[2]) {
    // Join adjacent numeric parts into a dotted version: 5-5 → 5.5.
    const words: string[] = [];
    for (const part of family[2].split("-")) {
      const previous = words[words.length - 1];
      if (/^\d+$/.test(part) && previous && /^\d+(\.\d+)?$/.test(previous)) {
        words[words.length - 1] = previous.includes(".")
          ? `${previous}${part}`
          : `${previous}.${part}`;
      } else {
        words.push(/^\d/.test(part) ? part : capitalize(part));
      }
    }
    return [capitalize(family[1]), ...words].join(" ");
  }

  return raw;
}

/**
 * The name stored as an agent comment's `authorName`. Callers pass the run's
 * model when they have it, so a missing model is the only "Agent" case.
 */
export function reviewAgentAuthorName(
  model: string | null | undefined,
): string {
  return model?.trim() ? modelDisplayName(model) : "Agent";
}

/** The `@` mention id for an agent selection, e.g. `agent:anthropic:claude-sonnet-5-5`. */
export function agentMentionId({
  engine,
  model,
}: {
  engine: string;
  model: string;
}): string {
  return `agent:${engine}:${model}`;
}

function capitalize(part: string): string {
  return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
}
