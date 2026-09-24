import { useT } from "@agent-native/core/client/i18n";
import { IconCheck, IconChevronDown, IconSparkles } from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { AgentAvatar, modelDisplayName } from "./agent-identity";

export type CommentAiMode = "auto" | "reply" | "suggest" | "apply-resolve";

export interface CommentAiSelection {
  model: string;
  engine: string;
  provider: string;
}

export const commentAiSelectionKey = (selection: CommentAiSelection) =>
  `${selection.engine}:${selection.model}`;

/** Words a person might type after `@` to find a model, e.g. "Sonnet". */
export function modelAliases(model: string): string[] {
  const name = modelDisplayName(model);
  const words = name.split(" ").filter((word) => /^[a-z]/i.test(word));
  return Array.from(new Set([name, ...words.slice(1)]));
}

/**
 * The connected models, shown when the AI pill is clicked.
 */
export function CommentAiModelList({
  models,
  selected,
  onSelect,
}: {
  models: CommentAiSelection[];
  selected: CommentAiSelection | null;
  onSelect: (selection: CommentAiSelection) => void;
}) {
  const t = useT();
  const selectedKey = selected ? commentAiSelectionKey(selected) : null;
  return (
    <div
      role="listbox"
      aria-label={t("comments.aiModel")}
      className="grid gap-0.5"
      data-comment-ai-model-list
    >
      {models.map((selection) => {
        const key = commentAiSelectionKey(selection);
        const active = key === selectedKey;
        return (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(selection)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
              active && "bg-accent/60",
            )}
          >
            <AgentAvatar
              model={selection.model}
              engine={selection.engine}
              className="size-6"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium leading-5">
                {modelDisplayName(selection.model)}
              </span>
              <span className="truncate text-xs leading-4 text-muted-foreground">
                {selection.provider}
              </span>
            </span>
            {active ? (
              <IconCheck size={15} className="shrink-0 text-foreground" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Send control shown once an AI recipient is in the draft. The main segment
 * sends; the chevron picks how AI should respond. The model is chosen from
 * the recipient pill itself.
 */
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
  const segment =
    "inline-flex h-7 items-center bg-foreground text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-35";
  return (
    <div className="flex shrink-0 items-center" data-comment-ai-send-control>
      <button
        type="button"
        className={cn(
          segment,
          "gap-1.5 rounded-s-full ps-2.5 pe-2 text-xs font-medium",
        )}
        disabled={disabled}
        onClick={onSubmit}
        aria-label={t("comments.aiSend")}
        data-comment-send
      >
        <IconSparkles size={14} aria-hidden />
        {t("comments.aiSendShort")}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              segment,
              "rounded-e-full border-s border-background/25 pe-2 ps-1.5",
            )}
            aria-label={t("comments.aiChooseSendMode")}
          >
            <IconChevronDown size={14} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>{t("comments.aiResponseMode")}</DropdownMenuLabel>
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
