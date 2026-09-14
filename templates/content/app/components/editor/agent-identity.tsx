import { IconBrandOpenai, IconMessageCircle } from "@tabler/icons-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

interface AgentModelIdentity {
  provider: string;
  shortName: string;
  Icon: ComponentType<{ size?: number | string }>;
}

const PROVIDERS: Record<string, Omit<AgentModelIdentity, "provider">> = {
  openai: { shortName: "GPT", Icon: IconBrandOpenai },
  anthropic: { shortName: "Claude", Icon: IconMessageCircle },
  google: { shortName: "Gemini", Icon: IconMessageCircle },
  mistral: { shortName: "Mistral", Icon: IconMessageCircle },
  cohere: { shortName: "Cohere", Icon: IconMessageCircle },
  groq: { shortName: "Groq", Icon: IconMessageCircle },
};

const MATCHERS = [
  ["anthropic", /(^|\/)claude-/],
  ["openai", /(^|\/)(gpt-|o[134](-|$)|chatgpt)/],
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

export function agentDisplayName(model: string | null | undefined): string {
  return resolveAgentModelIdentity(model)?.shortName ?? "AI";
}

export function AgentAvatar({
  model,
  className,
}: {
  model: string | null | undefined;
  className?: string;
}) {
  const identity = resolveAgentModelIdentity(model);
  const Icon = identity?.Icon ?? IconMessageCircle;
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
        className,
      )}
      title={identity?.shortName ?? "AI"}
      aria-hidden
    >
      <Icon size={13} />
    </span>
  );
}
