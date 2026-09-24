import {
  McpIntegrationLogo,
  resolveAgentProviderLogo,
} from "@agent-native/core/client/resources";
import { IconDeviceDesktop, IconSparkles } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

/**
 * One identity for an AI participant in a comment thread: the provider's short
 * name (the visible author), a readable model name (the detail), and the
 * engine used to look up the shared provider logo.
 */
export interface AgentModelIdentity {
  provider: string;
  shortName: string;
  engine: string;
}

const PROVIDERS: Record<string, { shortName: string; engine: string }> = {
  anthropic: { shortName: "Claude", engine: "anthropic" },
  openai: { shortName: "GPT", engine: "ai-sdk:openai" },
  google: { shortName: "Gemini", engine: "ai-sdk:google" },
  mistral: { shortName: "Mistral", engine: "ai-sdk:mistral" },
  cohere: { shortName: "Cohere", engine: "ai-sdk:cohere" },
  groq: { shortName: "Groq", engine: "ai-sdk:groq" },
};

const MATCHERS = [
  ["anthropic", /(^|\/)claude-/],
  ["openai", /(^|\/)(gpt-|o[134](-|$)|chatgpt|codex)/],
  ["google", /(^|\/)(gemini-|gemma-)/],
  ["mistral", /(^|\/)(mistral|codestral|ministral|pixtral)/],
  ["cohere", /(^|\/)command-/],
  ["groq", /^groq\//],
] as const;

export function resolveAgentModelIdentity(
  model: string | null | undefined,
): AgentModelIdentity | null {
  const id = model?.trim().toLowerCase();
  if (!id) return null;
  const provider = MATCHERS.find(([, pattern]) => pattern.test(id))?.[0];
  return provider ? { provider, ...PROVIDERS[provider] } : null;
}

/** The visible author name for an AI participant, e.g. "Claude". */
export function agentDisplayName(model: string | null | undefined): string {
  return resolveAgentModelIdentity(model)?.shortName ?? "AI";
}

const capitalize = (part: string) =>
  part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part;

/**
 * A readable model name for any provider: `claude-opus-5-5` → "Claude Opus
 * 5.5", `gpt-5-4-mini` → "GPT-5.4 Mini", `gemini-3-pro` → "Gemini 3 Pro".
 * Unknown ids are returned unchanged rather than guessed at.
 */
export function modelDisplayName(model: string | null | undefined): string {
  const raw = model?.trim();
  if (!raw) return "AI";
  const id = raw.split("/").pop()!.toLowerCase();
  const withoutDate = id.replace(/-(?:\d{8}|latest)$/, "");

  const gpt = /^gpt-(\d+)(?:[.-](\d+))?(?:-(.+))?$/.exec(withoutDate);
  if (gpt) {
    const version = gpt[2] ? `${gpt[1]}.${gpt[2]}` : gpt[1];
    const variant = gpt[3]?.split("-").map(capitalize).join(" ");
    return variant ? `GPT-${version} ${variant}` : `GPT-${version}`;
  }

  const family = /^(claude|gemini|gemma)-(.+)$/.exec(withoutDate);
  if (family) {
    // Join adjacent numeric parts into a dotted version: 5-5 → 5.5.
    const parts = family[2]!.split("-");
    const words: string[] = [];
    for (const part of parts) {
      const previous = words[words.length - 1];
      if (/^\d+$/.test(part) && previous && /^\d+(\.\d+)?$/.test(previous)) {
        words[words.length - 1] = previous.includes(".")
          ? `${previous}${part}`
          : `${previous}.${part}`;
      } else {
        words.push(/^\d/.test(part) ? part : capitalize(part));
      }
    }
    return [capitalize(family[1]!), ...words].join(" ");
  }

  return raw;
}

/** "Claude · Claude Opus 5.5" style label used where both names matter. */
export function commentAiModelLabel(model: string | null | undefined): string {
  const normalized = model?.trim();
  return normalized
    ? `${agentDisplayName(normalized)} · ${modelDisplayName(normalized)}`
    : agentDisplayName(normalized);
}

/**
 * The engine whose logo represents a model. A gateway such as Builder routes
 * many makers' models, so the model's own maker wins when it is recognizable.
 */
export function agentLogoEngine(
  model: string | null | undefined,
  engine: string | null | undefined,
): string {
  return resolveAgentModelIdentity(model)?.engine ?? engine ?? "";
}

/** Provider logo for an AI participant, sized to sit in an avatar slot. */
export function AgentAvatar({
  model,
  engine,
  className,
}: {
  model?: string | null;
  engine?: string | null;
  className?: string;
}) {
  const identity = resolveAgentModelIdentity(model);
  const resolvedEngine = agentLogoEngine(model, engine);
  const logo = resolveAgentProviderLogo(resolvedEngine, identity?.shortName);
  const label = identity?.shortName ?? logo.label ?? "AI";
  const frame = cn(
    "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground",
    className,
  );
  if (logo.fallback === "local") {
    return (
      <span className={frame} title={label} aria-hidden>
        <IconDeviceDesktop size={14} />
      </span>
    );
  }
  if (!logo.logoUrl) {
    return (
      <span className={frame} title={label} aria-hidden>
        <IconSparkles size={14} />
      </span>
    );
  }
  return (
    <span className={frame} title={label} aria-hidden>
      <McpIntegrationLogo
        name={label}
        logoUrl={logo.logoUrl}
        integrationId={logo.integrationId ?? undefined}
        className="size-full rounded-full border-0 bg-transparent"
        imageClassName="size-4"
      />
    </span>
  );
}
