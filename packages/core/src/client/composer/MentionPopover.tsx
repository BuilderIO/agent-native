import React, {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { createPortal } from "react-dom";
import {
  IconFile,
  IconFolder,
  IconStack2,
  IconFileText,
  IconCheckbox,
  IconMail,
  IconUser,
  IconPresentation,
  IconMessageChatbot,
  IconTrash,
  IconPlus,
  IconHelp,
  IconHistory,
  IconTerminal2,
  IconClipboardList,
  IconPencil,
} from "@tabler/icons-react";
import type { MentionItem, SkillResult, SlashCommand } from "./types.js";

export interface MentionPopoverRef {
  moveUp: () => void;
  moveDown: () => void;
  getSelectedIndex: () => number;
  getSelectedMention: () => MentionItem | null;
  getSelectedCommand: () => SlashCommand | null;
}

interface MentionPopoverProps {
  type: "@" | "/";
  position: { top: number; left: number } | null;
  mentionItems: MentionItem[];
  skills: SkillResult[];
  commands?: SlashCommand[];
  hint?: string;
  isLoading: boolean;
  query: string;
  onSelectMention: (item: MentionItem) => void;
  onSelectSkill: (skill: SkillResult) => void;
  onSelectCommand?: (command: SlashCommand) => void;
  onClose: () => void;
}

const iconProps = { size: 14, className: "shrink-0 text-muted-foreground" };

function MentionItemIcon({ icon }: { icon?: string }) {
  switch (icon) {
    case "folder":
      return <IconFolder {...iconProps} />;
    case "document":
      return <IconFileText {...iconProps} />;
    case "form":
      return <IconCheckbox {...iconProps} />;
    case "email":
      return <IconMail {...iconProps} />;
    case "user":
      return <IconUser {...iconProps} />;
    case "deck":
      return <IconPresentation {...iconProps} />;
    case "agent":
      return <IconMessageChatbot {...iconProps} />;
    case "file":
      return <IconFile {...iconProps} />;
    default:
      return <IconFile {...iconProps} />;
  }
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
  // If hint contains a URL, split it and render the URL as a link
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
        Learn more
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
    query,
    onSelectMention,
    onSelectSkill,
    onSelectCommand,
    onClose,
  } = props;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const itemCount =
    type === "@" ? mentionItems.length : commands.length + skills.length;

  // Group mention items by section for @ popover
  const groupedMentions = React.useMemo(() => {
    if (type !== "@") return [];
    const groups = new Map<string, MentionItem[]>();
    for (const item of mentionItems) {
      const section = item.section || "Other";
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section)!.push(item);
    }
    // Sort: Agents first, then Connected Agents, then template-specific,
    // then Files, then Other
    const sorted: { section: string; items: MentionItem[] }[] = [];
    const knownSections = new Set([
      "Agents",
      "Connected Agents",
      "Files",
      "Other",
    ]);
    // Agents first
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
    // Template-specific sections (anything not in knownSections)
    for (const [section, items] of groups) {
      if (!knownSections.has(section)) {
        sorted.push({ section, items });
      }
    }
    // Files
    if (groups.has("Files")) {
      sorted.push({ section: "Files", items: groups.get("Files")! });
    }
    // Other
    if (groups.has("Other")) {
      sorted.push({ section: "Other", items: groups.get("Other")! });
    }
    return sorted;
  }, [type, mentionItems]);

  // Flat list of mention items in section order for keyboard index tracking
  const flatMentionItems = React.useMemo(() => {
    return groupedMentions.flatMap((g) => g.items);
  }, [groupedMentions]);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [mentionItems, skills, query]);

  // Scroll selected item into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    // Find the actual item element by data attribute
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
        prev <= 0 ? Math.max(0, itemCount - 1) : prev - 1,
      );
    },
    moveDown: () => {
      setSelectedIndex((prev) => (prev >= itemCount - 1 ? 0 : prev + 1));
    },
    getSelectedIndex: () => selectedIndex,
    getSelectedMention: () => flatMentionItems[selectedIndex] ?? null,
    getSelectedCommand: () => {
      if (type !== "/" || selectedIndex >= commands.length) return null;
      return commands[selectedIndex] ?? null;
    },
  }));

  if (!position) return null;

  const content = (
    <>
      {/* Backdrop to capture outside clicks */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="fixed z-[9999] w-[320px] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
        style={{
          bottom: `calc(100vh - ${position.top}px + 4px)`,
          left: Math.max(8, Math.min(position.left, window.innerWidth - 336)),
          maxHeight: Math.min(320, position.top - 8),
        }}
      >
        {isLoading && itemCount === 0 ? (
          <LoadingSkeleton />
        ) : itemCount === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {type === "@" ? (
              query ? (
                "No results found"
              ) : (
                "Type to search..."
              )
            ) : hint ? (
              <HintWithLink hint={hint} />
            ) : (
              "No skills available"
            )}
          </div>
        ) : (
          <div ref={listRef} className="p-1">
            {isLoading && <LoadingSkeletonRow />}
            {type === "@"
              ? (() => {
                  let flatIndex = 0;
                  return groupedMentions.map((group) => (
                    <div key={group.section}>
                      <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                        {group.section}
                      </div>
                      {group.items.map((item) => {
                        const idx = flatIndex++;
                        return (
                          <button
                            key={item.id}
                            data-mention-index={idx}
                            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                              idx === selectedIndex
                                ? "bg-accent text-accent-foreground"
                                : "hover:bg-accent/50"
                            }`}
                            onMouseEnter={() => setSelectedIndex(idx)}
                            onClick={() => onSelectMention(item)}
                          >
                            <MentionItemIcon icon={item.icon} />
                            <span className="truncate text-sm">
                              {item.label}
                            </span>
                            {item.description && (
                              <span className="ml-auto shrink-0 truncate max-w-[160px] text-xs text-muted-foreground">
                                {item.description}
                              </span>
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
                          <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                            Commands
                          </div>
                          {commands.map((cmd) => {
                            const i = idx++;
                            return (
                              <button
                                key={cmd.name}
                                data-mention-index={i}
                                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                                  i === selectedIndex
                                    ? "bg-accent text-accent-foreground"
                                    : "hover:bg-accent/50"
                                }`}
                                onMouseEnter={() => setSelectedIndex(i)}
                                onClick={() => onSelectCommand?.(cmd)}
                              >
                                <CommandIcon icon={cmd.icon} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm">
                                    /{cmd.name}
                                  </span>
                                  {cmd.description && (
                                    <span className="block truncate text-xs text-muted-foreground">
                                      {cmd.description}
                                    </span>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {skills.length > 0 && (
                        <div>
                          {commands.length > 0 && (
                            <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                              Skills
                            </div>
                          )}
                          {(skills as SkillResult[]).map((skill) => {
                            const i = idx++;
                            return (
                              <button
                                key={skill.path}
                                data-mention-index={i}
                                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                                  i === selectedIndex
                                    ? "bg-accent text-accent-foreground"
                                    : "hover:bg-accent/50"
                                }`}
                                onMouseEnter={() => setSelectedIndex(i)}
                                onClick={() => onSelectSkill(skill)}
                              >
                                <IconStack2 {...iconProps} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm">
                                    {skill.name}
                                  </span>
                                  {skill.description && (
                                    <span className="block truncate text-xs text-muted-foreground">
                                      {skill.description}
                                    </span>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
          </div>
        )}
      </div>
    </>
  );

  return createPortal(content, document.body);
});
