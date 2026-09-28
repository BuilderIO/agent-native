import { TextField } from "@agent-native/toolkit/design-system";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconArrowUpRight,
  IconExternalLink,
  IconPlugConnected,
  IconSearch,
  IconTopologyRing2,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import {
  buildSettingsRoute,
  STANDARD_APP_ROUTES,
} from "../../navigation/index.js";
import { appMountedPath } from "../api-path.js";
import { useT } from "../i18n.js";
import { useOrg } from "../org/hooks.js";
import {
  canManageSharedAgents,
  CONNECTED_AGENTS_SETTINGS_ID,
} from "./AgentsSection.js";

export type AgentDirectoryProvider = {
  id: "foundry" | "gemini" | "anthropic";
  nameKey: string;
  hintKey: string;
  protocolKey: string;
  provider: "a2a" | "anthropic-managed-agents";
};

export const AGENT_DIRECTORY_PROVIDERS: readonly AgentDirectoryProvider[] = [
  {
    id: "foundry",
    nameKey: "agentChat.agents.directoryFoundry",
    hintKey: "agentChat.agents.directoryFoundryHint",
    protocolKey: "agentChat.agents.directoryA2A",
    provider: "a2a",
  },
  {
    id: "gemini",
    nameKey: "agentChat.agents.directoryGemini",
    hintKey: "agentChat.agents.directoryGeminiHint",
    protocolKey: "agentChat.agents.directoryA2A",
    provider: "a2a",
  },
  {
    id: "anthropic",
    nameKey: "agentChat.agents.directoryAnthropic",
    hintKey: "agentChat.agents.directoryAnthropicHint",
    protocolKey: "agentChat.agents.directoryManaged",
    provider: "anthropic-managed-agents",
  },
];

/** The Global A2A Registry, where public agent cards are listed. */
export const A2A_REGISTRY_URL = "https://www.a2a-registry.org";

function openAgentConnection(provider?: AgentDirectoryProvider["provider"]) {
  if (typeof window === "undefined") return;
  const query = `?connect=${encodeURIComponent(provider ?? "manual")}`;
  const path = `${appMountedPath(
    buildSettingsRoute(
      CONNECTED_AGENTS_SETTINGS_ID,
      STANDARD_APP_ROUTES.settings,
    ),
    STANDARD_APP_ROUTES.settings,
  )}${query}`;
  window.location.assign(path);
}

/** Directory providers whose name, hint, or protocol matches `query`. */
export function useAgentDirectoryProviders(
  query: string,
): readonly AgentDirectoryProvider[] {
  const t = useT();
  return useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return AGENT_DIRECTORY_PROVIDERS;
    return AGENT_DIRECTORY_PROVIDERS.filter((provider) =>
      [t(provider.nameKey), t(provider.hintKey), t(provider.protocolKey)]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, t]);
}

export function AgentDirectorySection() {
  const t = useT();
  const orgQuery = useOrg();
  const canManage = canManageSharedAgents(orgQuery);
  const [query, setQuery] = useState("");
  const filteredProviders = useAgentDirectoryProviders(query);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TextField
          value={query}
          onChange={setQuery}
          aria-label={t("agentChat.agents.directorySearch")}
          placeholder={t("agentChat.agents.directorySearch")}
          leadingContent={<IconSearch size={15} />}
          className="w-full sm:max-w-sm"
        />
        {canManage && (
          <Button
            type="button"
            variant="outline"
            intent="neutral"
            emphasis="outline"
            onClick={() => openAgentConnection()}
            className="shrink-0"
          >
            <IconPlugConnected />
            {t("agentChat.agents.directoryManual")}
          </Button>
        )}
      </div>

      <section
        className="space-y-3"
        aria-labelledby="agent-directory-providers"
      >
        <h2
          id="agent-directory-providers"
          className="text-sm font-medium text-foreground"
        >
          {t("agentChat.agents.directoryProviders")}
        </h2>
        {filteredProviders.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-3">
            {filteredProviders.map((provider) => (
              <article
                key={provider.id}
                className="flex min-h-36 flex-col justify-between rounded-lg border border-border bg-card p-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-8 items-center justify-center rounded-md bg-accent/60 text-foreground">
                        <IconTopologyRing2 size={17} />
                      </span>
                      <h3 className="text-sm font-medium text-foreground">
                        {t(provider.nameKey)}
                      </h3>
                    </div>
                    <Badge variant="outline">{t(provider.protocolKey)}</Badge>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t(provider.hintKey)}
                  </p>
                </div>
                {canManage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    intent="neutral"
                    onClick={() => openAgentConnection(provider.provider)}
                    className="mt-4 justify-between"
                  >
                    {t("agentChat.common.connect")}
                    <IconArrowUpRight />
                  </Button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {t("agentChat.agents.directoryNoMatches")}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-8 items-center justify-center rounded-md bg-accent/60 text-foreground">
              <IconTopologyRing2 size={17} />
            </span>
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-foreground">
                {t("agentChat.agents.directoryRegistry")}
              </h2>
              <p className="max-w-xl text-xs leading-5 text-muted-foreground">
                {t("agentChat.agents.directoryRegistryHint")}
              </p>
            </div>
          </div>
          <a
            href={A2A_REGISTRY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground no-underline transition-colors hover:bg-accent/40"
          >
            {t("agentChat.agents.directoryBrowse")}
            <IconExternalLink size={14} />
          </a>
        </div>
      </section>
    </div>
  );
}
