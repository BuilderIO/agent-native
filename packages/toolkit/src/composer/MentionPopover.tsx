import {
  IconStack2,
  IconTrash,
  IconPlus,
  IconHelp,
  IconHistory,
  IconTerminal2,
  IconClipboardList,
  IconPencil,
} from "@tabler/icons-react";
import React, {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";

import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import { MentionItemMedia } from "./MentionItemMedia.js";
import { COMPOSER_POPOVER_SURFACE_CLASS } from "./popover-surface.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";
import type { MentionItem, SkillResult, SlashCommand } from "./types.js";

export interface MentionPopoverRef {
  moveUp: () => void;
  moveDown: () => void;
  getSelectedIndex: () => number;
  getSelectedMention: () => MentionItem | null;
  getSelectedCommand: () => SlashCommand | null;
  /** Runs Retry if it is the highlighted row; false when it is not. */
  activateRetry: () => boolean;
}

interface MentionPopoverProps {
  type: "@" | "/";
  position: { top: number; left: number; width?: number } | null;
  mentionItems: MentionItem[];
  skills: SkillResult[];
  commands?: SlashCommand[];
  hint?: string;
  isLoading: boolean;
  /** Why some @ items could not load; shown above the items that did. */
  error?: string;
  onRetry?: () => void;
  query: string;
  onSelectMention: (item: MentionItem) => void;
  onSelectSkill: (skill: SkillResult) => void;
  onSelectCommand?: (command: SlashCommand) => void;
  onClose: () => void;
  /**
   * "stacked" shows a larger avatar with the description under the label, for
   * people and agent pickers where the description is an identity (an email).
   */
  density?: "default" | "stacked";
}

const iconProps = { size: 16, className: "shrink-0 text-muted-foreground" };
const COMPOSER_POPOVER_GAP = 8;
const COMPOSER_POPOVER_EDGE = 16;

function composerAnchorRect(
  position: { top: number; left: number; width?: number } | null,
): DOMRect {
  const left = position?.left ?? 0;
  const top = position?.top ?? 0;
  const width = position?.width ?? 0;
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height: 0,
    right: left + width,
    bottom: top,
    toJSON: () => ({ left, top, width, height: 0 }),
  } as DOMRect;
}

function CommandIcon({ icon }: { icon?: string }) {
  switch (icon) {
    case "clear":
      return <IconTrash {...iconProps} />;
    case "new":
      return <IconPlus {...iconProps} />;
    case "help":
      return <IconHelp {...iconProps} />;
    case "history":
      return <IconHistory {...iconProps} />;
    case "plan":
      return <IconClipboardList {...iconProps} />;
    case "act":
      return <IconPencil {...iconProps} />;
    default:
      return <IconTerminal2 {...iconProps} />;
  }
}

function HintWithLink({ hint }: { hint: string }) {
  const t = useComposerRuntimeAdapters().translate!;
  const urlMatch = hint.match(/(https?:\/\/\S+)/);
  if (!urlMatch) return <>{hint}</>;
  const before = hint.slice(0, urlMatch.index);
  const url = urlMatch[1];
  return (
    <>
      {before}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-foreground"
      >
        {t("agentChat.mentions.learnMore", { defaultValue: "Learn more" })}
      </a>
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-1 p-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2 rounded px-2 py-1.5">
          <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
          <div
            className="h-3 rounded bg-muted animate-pulse"
            style={{ width: `${60 + i * 20}px` }}
          />
        </div>
      ))}
    </div>
  );
}

function LoadingSkeletonRow() {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5">
      <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
      <div className="h-3 w-24 rounded bg-muted animate-pulse" />
    </div>
  );
}

function FullDescriptionTooltip({
  description,
  children,
}: {
  description?: string;
  children: React.ReactElement;
}) {
  if (!description) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        className="z-[10001] max-w-[280px] whitespace-normal break-words"
      >
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

export const MentionPopover = forwardRef<
  MentionPopoverRef,
  MentionPopoverProps
>(function MentionPopover(props, ref) {
  const {
    type,
    position,
    mentionItems,
    skills,
    commands = [],
    hint,
    isLoading,
    error,
    onRetry,
    query,
    onSelectMention,
    onSelectSkill,
    onSelectCommand,
    onClose,
    density = "default",
  } = props;
  const stacked = density === "stacked";

  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useComposerRuntimeAdapters().translate!;

  const sectionLabel = (section: string) => {
    switch (section) {
      case "Agents":
        return t("agentChat.mentions.sections.agents", {
          defaultValue: "Agents",
        });
      case "Connected Agents":
        return t("agentChat.mentions.sections.connectedAgents", {
          defaultValue: "Connected Agents",
        });
      case "Files":
        return t("agentChat.mentions.sections.files", {
          defaultValue: "Files",
        });
      case "Other":
        return t("agentChat.mentions.sections.other", {
          defaultValue: "Other",
        });
      default:
        return section;
    }
  };

  const itemCount =
    type === "@" ? mentionItems.length : commands.length + skills.length;
  // Focus stays in the editor, so Retry is a row above the items, at -1,
  // for the arrow keys to reach.
  const retryable = type === "@" && !!error && !!onRetry;
  const firstIndex = retryable ? -1 : 0;
  const itemIdentitySignature =
    type === "@"
      ? mentionItems.map((item) => item.id).join("\0")
      : [
          ...commands.map((command) => `command:${command.name}`),
          ...skills.map((skill) => `skill:${skill.path}`),
        ].join("\0");

  const groupedMentions = React.useMemo(() => {
    if (type !== "@") return [];
    const groups = new Map<string, MentionItem[]>();
    for (const item of mentionItems) {
      const section = item.section || "Other";
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section)!.push(item);
    }
    const sorted: { section: string; items: MentionItem[] }[] = [];
    const knownSections = new Set([
      "Agents",
      "Connected Agents",
      "Files",
      "Other",
    ]);
    if (groups.has("Agents")) {
      sorted.push({ section: "Agents", items: groups.get("Agents")! });
      groups.delete("Agents");
    }
    if (groups.has("Connected Agents")) {
      sorted.push({
        section: "Connected Agents",
        items: groups.get("Connected Agents")!,
      });
      groups.delete("Connected Agents");
    }
    for (const [section, items] of groups) {
      if (!knownSections.has(section)) {
        sorted.push({ section, items });
      }
    }
    if (groups.has("Files")) {
      sorted.push({ section: "Files", items: groups.get("Files")! });
    }
    if (groups.has("Other")) {
      sorted.push({ section: "Other", items: groups.get("Other")! });
    }
    return sorted;
  }, [type, mentionItems]);

  const flatMentionItems = React.useMemo(() => {
    return groupedMentions.flatMap((g) => g.items);
  }, [groupedMentions]);

  useEffect(() => {
    setSelectedIndex((current) => (current === 0 ? current : 0));
  }, [itemIdentitySignature, query, retryable]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const selected = container.querySelector(
      `[data-mention-index="${selectedIndex}"]`,
    ) as HTMLElement | undefined;
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    moveUp: () => {
      setSelectedIndex((prev) =>
        prev <= firstIndex ? Math.max(firstIndex, itemCount - 1) : prev - 1,
      );
    },
    moveDown: () => {
      setSelectedIndex((prev) =>
        prev >= itemCount - 1 ? firstIndex : prev + 1,
      );
    },
    getSelectedIndex: () => selectedIndex,
    getSelectedMention: () => flatMentionItems[selectedIndex] ?? null,
    getSelectedCommand: () => {
      if (type !== "/" || selectedIndex >= commands.length) return null;
      return commands[selectedIndex] ?? null;
    },
    activateRetry: () => {
      if (!retryable || selectedIndex !== -1) return false;
      onRetry!();
      return true;
    },
  }));

  const anchorRef = useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect: () => composerAnchorRect(null),
  });
  anchorRef.current = {
    getBoundingClientRect: () => composerAnchorRect(position),
  };

  if (!position) return null;

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        ref={containerRef}
        side="top"
        align="start"
        sideOffset={COMPOSER_POPOVER_GAP}
        collisionPadding={COMPOSER_POPOVER_EDGE}
        data-agent-native-composer-popover="true"
        data-agent-native-mention-popover="true"
        // Focus stays in the editor, which owns the arrow keys and Enter.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          // An IME uses Escape to cancel its composition; leave that to it.
          if (event.isComposing || event.keyCode === 229) return;
          // This Escape is spent closing the panel; the editor and host must
          // not also act on it.
          event.stopPropagation();
          onClose();
        }}
        className={`overflow-y-auto rounded-lg border-border/80 p-1 shadow-2xl ${COMPOSER_POPOVER_SURFACE_CLASS}`}
        style={{
          width: Math.min(
            position.width ?? 640,
            window.innerWidth - COMPOSER_POPOVER_EDGE * 2,
          ),
          maxHeight: `min(27.5rem, var(--radix-popover-content-available-height, 27.5rem))`,
        }}
      >
        {type === "@" && error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-destructive"
          >
            <span>{error}</span>
            {onRetry && (
              <button
                type="button"
                data-mention-index={-1}
                className={`shrink-0 rounded px-1.5 py-0.5 font-medium text-foreground ${
                  selectedIndex === -1 ? "bg-muted" : "hover:bg-accent"
                }`}
                onMouseEnter={() => setSelectedIndex(-1)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onRetry}
              >
                {t("agentChat.common.retry", { defaultValue: "Retry" })}
              </button>
            )}
          </div>
        )}
        {isLoading && itemCount === 0 ? (
          <LoadingSkeleton />
        ) : itemCount === 0 && type === "@" && error ? null : itemCount ===
          0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {type === "@" ? (
              query ? (
                t("agentChat.mentions.noResults", {
                  defaultValue: "No results found",
                })
              ) : (
                t("agentChat.mentions.typeToSearch", {
                  defaultValue: "Type to search...",
                })
              )
            ) : hint ? (
              <HintWithLink hint={hint} />
            ) : query ? (
              t("agentChat.mentions.noMatches", { defaultValue: "No matches" })
            ) : (
              t("agentChat.mentions.noCommands", {
                defaultValue: "No commands",
              })
            )}
          </div>
        ) : (
          <div>
            {isLoading && <LoadingSkeletonRow />}
            {type === "@"
              ? (() => {
                  let flatIndex = 0;
                  return groupedMentions.map((group) => (
                    <div key={group.section}>
                      <div
                        className={
                          stacked
                            ? "px-2.5 pb-1 pt-2 agent-kit-caption-copy font-medium uppercase tracking-wide text-muted-foreground/70"
                            : "px-3 pb-2 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/70"
                        }
                      >
                        {sectionLabel(group.section)}
                      </div>
                      {group.items.map((item) => {
                        const idx = flatIndex++;
                        return (
                          <button
                            key={item.id}
                            data-mention-index={idx}
                            data-mention-density={density}
                            className={`flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start ${
                              idx === selectedIndex
                                ? "bg-muted text-foreground"
                                : "hover:bg-accent/50"
                            }`}
                            onMouseEnter={() => setSelectedIndex(idx)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onSelectMention(item)}
                          >
                            <MentionItemMedia
                              icon={item.icon}
                              media={item.media}
                              size={stacked ? "lg" : "md"}
                            />
                            {stacked ? (
                              <span className="flex min-w-0 flex-col overflow-hidden">
                                <span className="truncate text-sm font-medium leading-5">
                                  {item.label}
                                </span>
                                {item.description && (
                                  <span className="truncate text-sm leading-4 text-muted-foreground">
                                    {item.description}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <>
                                <span className="min-w-0 truncate text-[0.8125rem] leading-4">
                                  {item.label}
                                </span>
                                {item.description && (
                                  <span
                                    data-mention-description
                                    className="ms-auto max-w-[60%] shrink-0 truncate text-[0.8125rem] leading-4 text-muted-foreground"
                                  >
                                    {item.description}
                                  </span>
                                )}
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ));
                })()
              : (() => {
                  let idx = 0;
                  return (
                    <>
                      {commands.length > 0 && (
                        <div>
                          <div className="px-2 pb-1 pt-1 agent-kit-micro-copy font-medium uppercase tracking-wide text-muted-foreground/70">
                            {t("agentChat.mentions.commands", {
                              defaultValue: "Commands",
                            })}
                          </div>
                          {commands.map((cmd) => {
                            const i = idx++;
                            return (
                              <button
                                key={cmd.name}
                                data-mention-index={i}
                                className={`flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start ${
                                  i === selectedIndex
                                    ? "bg-muted text-foreground"
                                    : "hover:bg-accent/50"
                                }`}
                                onMouseEnter={() => setSelectedIndex(i)}
                                onClick={() => onSelectCommand?.(cmd)}
                              >
                                <CommandIcon icon={cmd.icon} />
                                <span className="min-w-0 truncate text-[0.8125rem] font-medium leading-4">
                                  /{cmd.name}
                                </span>
                                {cmd.description && (
                                  <span
                                    data-mention-description
                                    className="ms-auto max-w-[60%] shrink-0 truncate text-[0.8125rem] leading-4 text-muted-foreground"
                                  >
                                    {cmd.description}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {skills.length > 0 && (
                        <div>
                          {commands.length > 0 && (
                            <div className="px-2 pb-1 pt-1.5 agent-kit-micro-copy font-medium uppercase tracking-wide text-muted-foreground/70">
                              {t("agentChat.mentions.skills", {
                                defaultValue: "Skills",
                              })}
                            </div>
                          )}
                          <TooltipProvider delayDuration={200}>
                            {(skills as SkillResult[]).map((skill) => {
                              const i = idx++;
                              return (
                                <FullDescriptionTooltip
                                  key={skill.path}
                                  description={skill.description}
                                >
                                  <button
                                    data-mention-index={i}
                                    className={`flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start ${
                                      i === selectedIndex
                                        ? "bg-muted text-foreground"
                                        : "hover:bg-accent/50"
                                    }`}
                                    onMouseEnter={() => setSelectedIndex(i)}
                                    onClick={() => onSelectSkill(skill)}
                                  >
                                    <IconStack2 {...iconProps} />
                                    <span className="min-w-0 truncate text-[0.8125rem] font-medium leading-4">
                                      {skill.name}
                                    </span>
                                    {skill.description && (
                                      <span
                                        data-mention-description
                                        className="ms-auto max-w-[60%] shrink-0 truncate text-[0.8125rem] leading-4 text-muted-foreground"
                                      >
                                        {skill.description}
                                      </span>
                                    )}
                                  </button>
                                </FullDescriptionTooltip>
                              );
                            })}
                          </TooltipProvider>
                        </div>
                      )}
                    </>
                  );
                })()}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});
