import { useT } from "@agent-native/core/client/i18n";
import {
  McpIntegrationLogo,
  resolveAgentProviderLogo,
} from "@agent-native/core/client/resources";
import {
  IconChevronDown,
  IconDeviceDesktop,
  IconSend,
  IconX,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type CommentAiMode = "auto" | "reply" | "suggest" | "apply-resolve";

export function modelFamilyAlias(model: string): string {
  const family = model.split("/").pop()?.toLowerCase() ?? model.toLowerCase();
  if (family.includes("luna")) return "Luna";
  if (family.includes("sonnet")) return "Sonnet";
  if (family.includes("opus")) return "Opus";
  if (family.includes("haiku")) return "Haiku";
  return family;
}

export interface CommentAiSelection {
  model: string;
  engine: string;
  provider: string;
}

export function CommentAiProviderIcon({
  engine,
  provider,
}: {
  engine: string;
  provider: string;
}) {
  const identity = resolveAgentProviderLogo(engine, provider);
  return (
    <span
      role="img"
      aria-label={identity.label}
      className="flex size-5 shrink-0 items-center justify-center"
      data-provider-id={identity.integrationId ?? identity.fallback}
    >
      {identity.fallback === "local" ? (
        <IconDeviceDesktop aria-hidden="true" size={13} />
      ) : (
        <McpIntegrationLogo
          name={identity.label}
          logoUrl={identity.logoUrl}
          integrationId={identity.integrationId ?? undefined}
          className="size-5 rounded-full border-0 bg-muted"
          imageClassName="size-3.5"
        />
      )}
    </span>
  );
}

export function CommentAiRecipient({
  selection,
  selections,
  mode,
  disabled,
  onModeChange,
  onSelectionChange,
  onRemove,
  onSubmit,
}: {
  selection: CommentAiSelection;
  selections: CommentAiSelection[];
  mode: CommentAiMode;
  disabled: boolean;
  onModeChange: (mode: CommentAiMode) => void;
  onSelectionChange: (selection: CommentAiSelection) => void;
  onRemove: () => void;
  onSubmit: () => void;
}) {
  const t = useT();
  const modes: Array<[CommentAiMode, string]> = [
    ["auto", t("comments.aiAuto")],
    ["reply", t("comments.aiReplyInThread")],
    ["suggest", t("comments.aiSuggestChanges")],
    ["apply-resolve", t("comments.aiApplyAndResolve")],
  ];

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-comment-ai-recipient
    >
      <div className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-muted/40 py-1 pr-1 pl-1.5">
        <CommentAiProviderIcon
          engine={selection.engine}
          provider={selection.provider}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 rounded text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate">
                {selection.provider} · {modelFamilyAlias(selection.model)}
              </span>
              <IconChevronDown className="shrink-0" size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t("comments.aiModel")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {selections.map((option) => (
              <DropdownMenuItem
                key={`${option.engine}:${option.model}`}
                className="gap-2"
                onSelect={() => onSelectionChange(option)}
              >
                <CommentAiProviderIcon
                  engine={option.engine}
                  provider={option.provider}
                />
                {option.provider} · {modelFamilyAlias(option.model)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={t("comments.aiRemoveRecipient")}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRemove}
        >
          <IconX size={13} />
        </button>
      </div>
      <div className="flex shrink-0 items-center">
        <Button
          type="button"
          size="sm"
          className="rounded-r-none"
          disabled={disabled}
          onClick={onSubmit}
        >
          <IconSend size={14} />
          {t("comments.aiSend")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              className="rounded-l-none border-l border-primary-foreground/20 px-2"
              disabled={disabled}
              aria-label={t("comments.aiChooseSendMode")}
            >
              <IconChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t("comments.aiSend")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => onModeChange(value as CommentAiMode)}
            >
              {modes.map(([value, label]) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function CommentAiSendControl({
  mode,
  disabled,
  onModeChange,
  onSubmit,
}: {
  mode: CommentAiMode;
  disabled: boolean;
  onModeChange: (mode: CommentAiMode) => void;
  onSubmit: () => void;
}) {
  const t = useT();
  const modes: Array<[CommentAiMode, string]> = [
    ["auto", t("comments.aiAuto")],
    ["reply", t("comments.aiReplyInThread")],
    ["suggest", t("comments.aiSuggestChanges")],
    ["apply-resolve", t("comments.aiApplyAndResolve")],
  ];
  return (
    <div className="flex shrink-0 items-center" data-comment-ai-send-control>
      <Button
        type="button"
        size="sm"
        className="rounded-r-none"
        disabled={disabled}
        onClick={onSubmit}
      >
        <IconSend size={14} />
        {t("comments.aiSend")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            className="rounded-l-none border-l border-primary-foreground/20 px-2"
            disabled={disabled}
            aria-label={t("comments.aiChooseSendMode")}
          >
            <IconChevronDown size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t("comments.aiSend")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => onModeChange(value as CommentAiMode)}
          >
            {modes.map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
