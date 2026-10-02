import type { ChatModelCatalog, ChatModelGroup } from "./types";
import type { AgentChatSettings } from "./use-agent-chat";

export const MOBILE_AGENT_OPTIONS = [
  {
    id: "default",
    label: "Default",
    description: "Agent-Native hosted chat",
  },
  {
    id: "codex",
    label: "Codex",
    description: "Run locally with Codex CLI",
    engine: "codex-cli",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Run locally with Claude Code",
    engine: "claude-cli",
  },
  {
    id: "pi",
    label: "Pi",
    description: "Run locally with Pi",
    engine: "pi-cli",
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "Run locally with OpenCode",
    engine: "opencode-cli",
  },
] as const;

export const MOBILE_LOCAL_AGENT_ENGINES: Set<string> = new Set(
  MOBILE_AGENT_OPTIONS.flatMap((agent) =>
    "engine" in agent && agent.engine ? [agent.engine] : [],
  ),
);

export type MobileAgentId = (typeof MOBILE_AGENT_OPTIONS)[number]["id"];

export function getMobileAgentId(engine: string | undefined): MobileAgentId {
  return (
    MOBILE_AGENT_OPTIONS.find(
      (agent) => "engine" in agent && agent.engine === engine,
    )?.id ?? "default"
  );
}

export function getMobileAgentLabel(engine: string | undefined): string {
  const id = getMobileAgentId(engine);
  return (
    MOBILE_AGENT_OPTIONS.find((agent) => agent.id === id)?.label ?? "Default"
  );
}

export function formatMobileModelLabel(model: string | undefined): string {
  if (!model) return "Auto";
  const raw = model
    .split("/")
    .pop()!
    .replace(/-\d{8}$/, "");
  const claude = raw.match(/^claude-(sonnet|opus|haiku)-(\d+(?:[-.]\d+)?)$/i);
  if (claude) {
    const family = claude[1]![0]!.toUpperCase() + claude[1]!.slice(1);
    return `${family} ${claude[2]!.replace("-", ".")}`;
  }
  if (/gpt-4o/i.test(raw)) return "GPT-4o";
  const gpt = raw.match(
    /^gpt-(\d+)(?:[.-](\d+))?(?:-(luna|sol|terra|mini|codex-mini))?$/i,
  );
  if (gpt) {
    const version = gpt[2] ? `${gpt[1]}.${gpt[2]}` : gpt[1];
    const suffix = gpt[3]?.replaceAll("-", " ");
    return `GPT-${version}${suffix ? ` ${suffix[0]!.toUpperCase()}${suffix.slice(1)}` : ""}`;
  }
  const gemini = raw.match(
    /^gemini-(\d+)(?:[.-](\d+))?-(flash(?:-lite)?|pro)(?:-preview)?$/i,
  );
  if (gemini) {
    const version = gemini[2] ? `${gemini[1]}.${gemini[2]}` : gemini[1];
    const variant = gemini[3]!.replaceAll("-", " ");
    return `Gemini ${version} ${variant[0]!.toUpperCase()}${variant.slice(1)}`;
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function getMobileModelGroups(
  catalog: ChatModelCatalog | null,
  agentId: MobileAgentId,
): ChatModelGroup[] {
  if (!catalog) return [];
  const agent = MOBILE_AGENT_OPTIONS.find((option) => option.id === agentId);
  if (agent && "engine" in agent && agent.engine) {
    return catalog.groups.filter((group) => group.engine === agent.engine);
  }
  return catalog.groups.filter(
    (group) => !MOBILE_LOCAL_AGENT_ENGINES.has(group.engine),
  );
}

export function selectMobileAgentSettings(
  agentId: MobileAgentId,
  current: AgentChatSettings,
  catalog: ChatModelCatalog | null,
): AgentChatSettings {
  const agent = MOBILE_AGENT_OPTIONS.find((option) => option.id === agentId);
  if (!agent || !("engine" in agent) || !agent.engine) {
    if (!MOBILE_LOCAL_AGENT_ENGINES.has(current.engine ?? "")) return current;
    const firstHostedModel = getMobileModelGroups(catalog, "default")[0]
      ?.models[0];
    return {
      ...current,
      ...(firstHostedModel
        ? {
            model: firstHostedModel,
            engine: catalog?.groups.find((group) =>
              group.models.includes(firstHostedModel),
            )?.engine,
          }
        : { model: undefined, engine: undefined }),
    };
  }

  const firstModel = getMobileModelGroups(catalog, agentId)[0]?.models[0];
  return firstModel
    ? { ...current, model: firstModel, engine: agent.engine }
    : current;
}
