import { useT } from "@agent-native/core/client/i18n";
import { AgentShareSection } from "@agent-native/toolkit/app/sharing";
import {
  AgentDestinationActions,
  ClaudeCodeLogo,
  ClaudeLogo,
  CodexLogo,
  type AgentShareDestination,
} from "@agent-native/toolkit/sharing";
import { IconChevronDown, IconPlugConnected } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { AgentLevel } from "./AgentLevel";

const LEVEL_ORDER: AgentLevel[] = ["comment", "edit"];

/**
 * The Share panel's Agents tab: what agents may do on this page, and where to
 * send it. Anyone who can open the panel sees the level; only someone who
 * manages the page can change it.
 */
export function AgentsShareTab({
  documentId,
  level,
  onLevelChange,
  pending,
  canManage,
  onCopyPrompt,
  onOpenAgent,
  onOpenMcpSettings,
}: {
  documentId: string;
  level: AgentLevel;
  onLevelChange: (level: AgentLevel) => void;
  pending: boolean;
  canManage: boolean;
  onCopyPrompt: () => Promise<boolean>;
  onOpenAgent: (destination: AgentShareDestination) => void;
  onOpenMcpSettings: () => void;
}) {
  const t = useT();
  const levels: Record<AgentLevel, { label: string; description: string }> = {
    comment: {
      label: t("agentChat.share.canComment"), // i18n-key-ignore shared framework catalog
      description: t("editor.toolbar.agentLevelCommentDescription"),
    },
    edit: {
      label: t("agentChat.share.canEdit"), // i18n-key-ignore shared framework catalog
      description: t("editor.toolbar.agentLevelEditDescription"),
    },
  };
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-foreground">
            {t("editor.toolbar.agentLevelHeading")}
          </div>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canManage || pending}
                className="-me-2 h-7 shrink-0 gap-1 px-2 text-xs font-normal text-muted-foreground"
                aria-label={t("editor.toolbar.agentLevelMenuLabel")}
              >
                {levels[level].label}
                <IconChevronDown aria-hidden="true" className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              data-agent-native-share-overlay=""
              className="z-[100020] w-72 p-1"
            >
              <DropdownMenuRadioGroup
                value={level}
                onValueChange={(value) => onLevelChange(value as AgentLevel)}
              >
                {LEVEL_ORDER.map((value) => (
                  <DropdownMenuRadioItem
                    key={value}
                    value={value}
                    indicator="check"
                    className="items-start py-1.5"
                  >
                    <span className="flex flex-col">
                      <span>
                        {levels[value].label}
                        {value === "edit" ? (
                          <span className="text-muted-foreground">
                            {" "}
                            {t("editor.toolbar.agentLevelDefault")}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {levels[value].description}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {levels[level].description}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          {canManage
            ? t("editor.toolbar.agentLevelLimit")
            : t("editor.toolbar.agentLevelManagersOnly")}
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="text-sm font-medium text-foreground">
          {t("editor.toolbar.sendPageToAgent")}
        </div>
        <AgentDestinationActions
          className="[&_button]:has-[>svg]:px-1.5"
          labels={{
            copy: t("agentChat.share.copyAgentPrompt"), // i18n-key-ignore shared framework catalog
            claude: t("agentChat.share.openInClaude"), // i18n-key-ignore shared framework catalog
            claudeCode: t("agentChat.share.openInClaudeCode"), // i18n-key-ignore shared framework catalog
            codex: t("agentChat.share.openInCodex"), // i18n-key-ignore shared framework catalog
          }}
          icons={{
            claude: <ClaudeLogo className="size-4" />, // i18n-ignore logo map
            "claude-code": <ClaudeCodeLogo className="size-4" />, // i18n-ignore logo map
            codex: <CodexLogo className="size-4" />,
          }}
          onCopy={onCopyPrompt}
          onOpen={onOpenAgent}
        />
        <Button
          type="button"
          variant="ghost"
          className="-mx-1.5 -mt-1 h-9 justify-start gap-2 px-1.5 text-sm font-normal has-[>svg]:px-1.5"
          onClick={onOpenMcpSettings}
        >
          <IconPlugConnected
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          {t("editor.toolbar.connectAgentOverMcp")}
        </Button>
        <AgentShareSection
          enabled
          resourceType="document"
          resourceId={documentId}
          label={t("agentChat.share.copyAgentLink")} // i18n-key-ignore shared framework catalog
        />
      </section>
    </div>
  );
}
