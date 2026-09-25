import {
  IconArrowLeft,
  IconChevronRight,
  IconPaperclip,
  IconPlus,
} from "@tabler/icons-react";
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import { Button } from "../ui/button.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { formatAttachmentError } from "./attachment-accept.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";

interface ComposerContextMenuEntry {
  id: string;
  label: string;
  keywords?: readonly string[];
  icon?: ReactNode;
  disabled?: boolean;
}

export interface ComposerContextMenuAction extends ComposerContextMenuEntry {
  onSelect: () => void | Promise<void>;
  render?: (controls: ComposerContextPageControls) => ReactNode;
  onDismiss?: () => void;
  children?: never;
}

export interface ComposerContextPageControls {
  onBack(): void;
  onClose(options?: { restoreFocus?: boolean }): void;
  onResume(): void;
}

export interface ComposerContextSearchInputProps extends Omit<
  ComponentPropsWithoutRef<typeof CommandInput>,
  "leading"
> {
  onBack?: () => void;
}

export const ComposerContextSearchInput = forwardRef<
  HTMLInputElement,
  ComposerContextSearchInputProps
>(({ onBack, ...props }, ref) => {
  const t = useComposerRuntimeAdapters().translate!;
  return (
    <CommandInput
      {...props}
      ref={ref}
      leading={
        onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ms-2 size-8 shrink-0"
            aria-label={t("agentChat.composer.contextBack", {
              defaultValue: "Back",
            })}
            onKeyDown={(event) => {
              // Keep cmdk from activating the selected row on native button keys.
              if (event.key === "Enter" || event.key === " ")
                event.stopPropagation();
            }}
            onClick={onBack}
          >
            <IconArrowLeft />
          </Button>
        ) : undefined
      }
    />
  );
});
ComposerContextSearchInput.displayName = "ComposerContextSearchInput";

interface ComposerContextPage {
  id: string;
  origin: string[];
  onDismiss?: () => void;
}

function findAction(
  items: readonly ComposerContextMenuItem[],
  id: string,
): ComposerContextMenuAction | undefined {
  for (const item of items) {
    if (item.children) {
      const match = findAction(item.children, id);
      if (match) return match;
    } else if (item.id === id) {
      return item;
    }
  }
}

export interface ComposerContextMenuCategory extends ComposerContextMenuEntry {
  children: readonly ComposerContextMenuItem[];
  onSelect?: never;
}

export type ComposerContextMenuItem =
  | ComposerContextMenuAction
  | ComposerContextMenuCategory;

export interface ComposerContextMenuProps {
  items: readonly ComposerContextMenuItem[];
  addAttachment?: (file: File) => Promise<unknown>;
  attachmentAccept?: string;
  onAttachmentError?: (message: string) => void;
  disabled?: boolean;
}

export function getComposerContextMenuEntries(
  items: readonly ComposerContextMenuItem[],
  path: readonly string[],
  query: string,
): ComposerContextMenuItem[] {
  let scope = items;
  for (const id of path) {
    const category = scope.find((item) => item.id === id);
    if (!category?.children || category.disabled) return [];
    scope = category.children;
  }
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...scope];
  const matches: ComposerContextMenuItem[] = [];
  const visit = (
    entries: readonly ComposerContextMenuItem[],
    ancestors: string[],
    disabled = false,
  ) => {
    for (const entry of entries) {
      const searchable = [...ancestors, entry.label, ...(entry.keywords ?? [])];
      if (entry.children) {
        visit(entry.children, searchable, disabled || entry.disabled === true);
      } else if (
        terms.every((term) =>
          searchable.join(" ").toLocaleLowerCase().includes(term),
        )
      ) {
        matches.push(disabled ? { ...entry, disabled: true } : entry);
      }
    }
  };
  visit(scope, []);
  return matches;
}

export function ComposerContextMenu({
  items,
  addAttachment,
  attachmentAccept,
  onAttachmentError,
  disabled,
}: ComposerContextMenuProps) {
  const t = useComposerRuntimeAdapters().translate!;
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const [page, setPage] = useState<ComposerContextPage | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const restoreFocusOnClose = useRef(true);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pageRef = useRef(page);
  const label = t("agentChat.composer.addContext", {
    defaultValue: "Add context",
  });
  const reportError = useCallback(
    (cause: unknown) => {
      const message = formatAttachmentError(
        cause,
        t("agentChat.composer.contextActionFailed", {
          defaultValue: "Could not add context.",
        }),
      );
      setError(message);
      onAttachmentError?.(message);
    },
    [t, onAttachmentError],
  );
  const dismissPage = useCallback(() => {
    const current = pageRef.current;
    pageRef.current = null;
    setPage(null);
    if (!current) return;
    try {
      const action = findAction(itemsRef.current, current.id);
      (action?.onDismiss ?? current.onDismiss)?.();
    } catch (cause) {
      reportError(cause);
    }
  }, [reportError]);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      dismissPage();
      setPath([]);
      setQuery("");
    }
  };
  const selectAction = (action: ComposerContextMenuAction) => {
    setError(null);
    try {
      void Promise.resolve(action.onSelect()).catch(reportError);
    } catch (cause) {
      reportError(cause);
    }
  };
  const openPage = (target: ComposerContextPage, select = true) => {
    const action = findAction(itemsRef.current, target.id);
    if (!action?.render) {
      reportError(
        new Error(
          t("agentChat.composer.contextActionFailed", {
            defaultValue: "Could not add context.",
          }),
        ),
      );
      return;
    }
    if (select) dismissPage();
    const next = { ...target, onDismiss: action.onDismiss };
    pageRef.current = next;
    setPage(next);
    setPath(target.origin);
    setQuery("");
    setOpen(true);
    if (select) selectAction(action);
  };
  const currentAction = page ? findAction(items, page.id) : undefined;
  useEffect(() => {
    if (page && !currentAction?.render) {
      dismissPage();
      setQuery("");
    }
  }, [page, currentAction, dismissPage]);
  useEffect(() => {
    if (!open) return;
    const content = contentRef.current;
    const input =
      content?.querySelector<HTMLElement>("[data-autofocus]") ??
      content?.querySelector<HTMLElement>("[cmdk-input]") ??
      content?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled)',
      );
    input?.focus();
  }, [open, page]);
  const entries = getComposerContextMenuEntries(items, path, query);
  const attachLabel = t("agentChat.composer.attachFiles", {
    defaultValue: "Attach files",
  });
  const showAttachment =
    addAttachment &&
    path.length === 0 &&
    (!query.trim() ||
      attachLabel
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()));

  return (
    <>
      {addAttachment ? (
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={attachmentAccept}
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            setError(null);
            void Promise.all(
              files.map((file) =>
                Promise.resolve().then(() => addAttachment(file)),
              ),
            ).catch(reportError);
          }}
        />
      ) : null}
      <Popover open={open} onOpenChange={changeOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                disabled={disabled}
                aria-label={label}
              >
                <IconPlus />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <PopoverContent
          ref={contentRef}
          onCloseAutoFocus={(event) => {
            if (!restoreFocusOnClose.current) event.preventDefault();
            restoreFocusOnClose.current = true;
          }}
          align="start"
          className="w-80 max-w-[var(--radix-popover-content-available-width)] p-0"
          data-agent-native-composer-popover="true"
        >
          {page && currentAction?.render ? (
            <Fragment key={page.id}>
              {currentAction.render({
                onBack: () => {
                  dismissPage();
                  setPath(page.origin);
                  setQuery("");
                },
                onClose: (options) => {
                  restoreFocusOnClose.current = options?.restoreFocus !== false;
                  changeOpen(false);
                },
                onResume: () => openPage(page, false),
              })}
            </Fragment>
          ) : (
            <Command key="menu" shouldFilter={false} label={label}>
              <ComposerContextSearchInput
                onBack={
                  path.length
                    ? () => {
                        setPath((current) => current.slice(0, -1));
                        setQuery("");
                        searchRef.current?.focus();
                      }
                    : undefined
                }
                ref={searchRef}
                value={query}
                onValueChange={setQuery}
                placeholder={t("agentChat.composer.searchContext", {
                  defaultValue: "Search context…",
                })}
              />
              <CommandList>
                <CommandEmpty>
                  {t("agentChat.composer.noContextResults", {
                    defaultValue: "No matching context.",
                  })}
                </CommandEmpty>
                <CommandGroup className="[&_svg]:size-4 [&_svg]:shrink-0">
                  {showAttachment ? (
                    <CommandItem
                      value="native-attach-files"
                      className="gap-2"
                      onSelect={() => {
                        changeOpen(false);
                        inputRef.current?.click();
                      }}
                    >
                      <IconPaperclip />
                      {attachLabel}
                    </CommandItem>
                  ) : null}
                  {entries.map((entry) => (
                    <CommandItem
                      key={entry.id}
                      value={entry.id}
                      className="gap-2"
                      disabled={entry.disabled}
                      onSelect={() => {
                        if (entry.children) {
                          setPath((current) => [...current, entry.id]);
                          setQuery("");
                          searchRef.current?.focus();
                        } else {
                          if (entry.render)
                            openPage({ id: entry.id, origin: [...path] });
                          else {
                            changeOpen(false);
                            selectAction(entry);
                          }
                        }
                      }}
                    >
                      {entry.icon}
                      {entry.label}
                      {entry.children ? (
                        <IconChevronRight className="ms-auto" />
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </>
  );
}
