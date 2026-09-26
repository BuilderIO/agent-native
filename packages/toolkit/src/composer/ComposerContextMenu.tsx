import { IconFile, IconPlus, IconTextRecognition } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { formatAttachmentError } from "./attachment-accept.js";
import { ComposerContextMenuSearch } from "./ComposerContextMenuSearch.js";
import {
  ComposerContextPicker,
  type ComposerContextPickerConfig,
} from "./ComposerContextPicker.js";
import { ComposerContextPickerDialog } from "./ComposerContextPickerDialog.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";

export {
  ComposerContextSearchInput,
  type ComposerContextSearchInputProps,
} from "./ComposerContextSearchInput.js";
export type {
  ComposerContextPickerConfig,
  ComposerContextPickerItem,
  ComposerContextPickerRequest,
  ComposerContextPickerResult,
  ComposerContextPickerSelection,
  ComposerContextPickerFooterAction,
} from "./ComposerContextPicker.js";

interface ComposerContextMenuEntry {
  id: string;
  label: string;
  keywords?: readonly string[];
  icon?: ReactNode;
  disabled?: boolean;
}
export type ComposerContextMenuAction = ComposerContextMenuEntry & {
  onDismiss?: () => void;
  children?: never;
} & (
    | { picker: ComposerContextPickerConfig; render?: never; onSelect?: never }
    | {
        onSelect: () => void | Promise<void>;
        render?: (controls: ComposerContextPageControls) => ReactNode;
        picker?: never;
      }
  );
export interface ComposerContextPageControls {
  onBack(): void;
  onClose(options?: { restoreFocus?: boolean }): void;
  onResume(): void;
}
export interface ComposerContextMenuCategory extends ComposerContextMenuEntry {
  children: readonly ComposerContextMenuItem[];
  searchPlaceholder?: string;
  onSelect?: never;
  picker?: never;
  render?: never;
}
export type ComposerContextMenuItem =
  | ComposerContextMenuAction
  | ComposerContextMenuCategory;
export interface ComposerContextMenuProps {
  items: readonly ComposerContextMenuItem[];
  addAttachment?: (file: File) => Promise<unknown>;
  onAttachmentRequest?: () => void;
  attachmentAccept?: string;
  onAttachmentError?: (message: string) => void;
  disabled?: boolean;
}
interface ComposerContextPage {
  id: string;
  origin: string[];
  onDismiss?: () => void;
}
interface ComposerContextDialogSession {
  id: string;
  scopeKey?: string;
}

function findAction(
  items: readonly ComposerContextMenuItem[],
  id: string,
): ComposerContextMenuAction | undefined {
  for (const item of items) {
    if (item.children) {
      const match = findAction(item.children, id);
      if (match) return match;
    } else if (item.id === id) return item;
  }
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
      if (entry.children)
        visit(entry.children, searchable, disabled || entry.disabled === true);
      else if (
        terms.every((term) =>
          searchable.join(" ").toLocaleLowerCase().includes(term),
        )
      )
        matches.push(disabled ? { ...entry, disabled: true } : entry);
    }
  };
  visit(scope, []);
  return matches;
}

function ContextSubmenu({
  label,
  icon,
  disabled,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLDivElement>(null);
  return (
    <DropdownMenuSub open={open} onOpenChange={onOpenChange}>
      <DropdownMenuSubTrigger ref={trigger} disabled={disabled}>
        {icon}
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="w-64"
        data-agent-native-composer-popover="true"
        onFocusOutside={(event) => {
          const target = event.target;
          // Radix focuses ancestor menus/triggers while a resumed chain mounts.
          if (
            target instanceof HTMLElement &&
            target.closest('[data-agent-native-composer-popover="true"]') &&
            target.matches(
              '[role="menu"], [aria-haspopup="menu"][aria-expanded="true"]',
            )
          ) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(false);
          trigger.current?.focus();
        }}
      >
        {children}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ContextMenuPanel({
  placeholder,
  children,
}: {
  placeholder: string;
  children: (query: string) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  return (
    <>
      <ComposerContextMenuSearch
        placeholder={placeholder}
        value={query}
        onValueChange={setQuery}
      />
      {children(query)}
    </>
  );
}

function matchesEntry(entry: ComposerContextMenuItem, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [entry.label, ...(entry.keywords ?? [])]
    .join(" ")
    .toLocaleLowerCase();
  return (
    terms.every((term) => text.includes(term)) ||
    Boolean(entry.children?.some((child) => matchesEntry(child, query)))
  );
}

function LegacyContextPage({ children }: { children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const input = element.current?.querySelector<HTMLElement>(
        "[data-autofocus], [cmdk-input], input:not([type=hidden]):not(:disabled), textarea:not(:disabled)",
      );
      input?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div ref={element}>{children}</div>;
}

export function ComposerContextMenu({
  items,
  addAttachment,
  onAttachmentRequest,
  attachmentAccept,
  onAttachmentError,
  disabled,
}: ComposerContextMenuProps) {
  const t = useComposerRuntimeAdapters().translate!;
  const [open, setOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const pathRef = useRef(path);
  const [page, setPage] = useState<ComposerContextPage | null>(null);
  const pageRef = useRef(page);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingDialog = useRef<ComposerContextDialogSession | null>(null);
  const [dialog, setDialog] = useState<ComposerContextDialogSession | null>(
    null,
  );
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const dialogAction = dialog ? findAction(items, dialog.id) : undefined;
  const dialogAvailable =
    dialogAction?.picker &&
    typeof dialogAction.picker.presentation === "object" &&
    dialogAction.picker.scopeKey === dialog?.scopeKey;
  useEffect(() => {
    if (dialog && !dialogAvailable) {
      dialogRef.current = null;
      setDialog(null);
    }
  }, [dialog, dialogAvailable]);
  const restoreFocusOnClose = useRef(true);
  const label = t("agentChat.composer.addContext", {
    defaultValue: "Add context",
  });
  const searchContext = t("agentChat.composer.searchContext", {
    defaultValue: "Search context…",
  });
  const uploadLabel = t("agentChat.composer.menu.uploadFile", {
    defaultValue: "Upload File",
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
      (
        findAction(itemsRef.current, current.id)?.onDismiss ?? current.onDismiss
      )?.();
    } catch (cause) {
      reportError(cause);
    }
  }, [reportError]);
  const updatePath = (next: string[]) => {
    pathRef.current = next;
    setPath(next);
  };
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      dismissPage();
      updatePath([]);
      setContextOpen(false);
    }
  };
  const selectAction = (action: ComposerContextMenuAction) => {
    setError(null);
    try {
      void Promise.resolve(action.onSelect?.()).catch(reportError);
    } catch (cause) {
      reportError(cause);
    }
  };
  const activate = (
    action: ComposerContextMenuAction,
    origin: string[],
    select = true,
  ) => {
    dismissPage();
    const next = { id: action.id, origin, onDismiss: action.onDismiss };
    pageRef.current = next;
    setPage(next);
    updatePath([...origin, action.id]);
    if (select && !action.picker) selectAction(action);
  };
  const currentAction = page ? findAction(items, page.id) : undefined;
  useEffect(() => {
    if (page && !currentAction?.render && !currentAction?.picker) dismissPage();
  }, [page, currentAction, dismissPage]);

  const renderEntries = (
    entries: readonly ComposerContextMenuItem[],
    origin: string[],
  ): ReactNode => (
    <DropdownMenuGroup>
      {entries.map((entry) => {
        if (entry.picker && typeof entry.picker.presentation === "object") {
          return (
            <DropdownMenuItem
              key={entry.id}
              disabled={entry.disabled}
              onSelect={() => {
                pendingDialog.current = {
                  id: entry.id,
                  scopeKey: entry.picker?.scopeKey,
                };
                changeOpen(false);
              }}
            >
              {entry.icon}
              {entry.label}
            </DropdownMenuItem>
          );
        }
        const branch = [...origin, entry.id];
        const expanded = branch.every((id, index) => path[index] === id);
        if (entry.children || entry.picker || entry.render) {
          const back = () => {
            dismissPage();
            updatePath(origin);
          };
          const activePage = page;
          return (
            <ContextSubmenu
              key={entry.id}
              label={entry.label}
              icon={entry.icon}
              disabled={entry.disabled}
              open={expanded}
              onOpenChange={(next) => {
                const isOpen = branch.every(
                  (id, index) => pathRef.current[index] === id,
                );
                if (next === isOpen) return;
                if (!next) {
                  back();
                  return;
                }
                setError(null);
                if (entry.children) {
                  dismissPage();
                  updatePath(branch);
                } else activate(entry, origin);
              }}
            >
              {entry.children ? (
                <ContextMenuPanel
                  placeholder={entry.searchPlaceholder ?? searchContext}
                >
                  {(query) =>
                    renderEntries(
                      entry.children.filter((child) =>
                        matchesEntry(child, query),
                      ),
                      branch,
                    )
                  }
                </ContextMenuPanel>
              ) : entry.picker ? (
                <ComposerContextPicker
                  key={JSON.stringify([entry.id, entry.picker.scopeKey])}
                  config={entry.picker}
                  onClose={() => {
                    if (pageRef.current === activePage) changeOpen(false);
                  }}
                />
              ) : entry.render && expanded ? (
                <LegacyContextPage>
                  {entry.render({
                    onBack: back,
                    onClose: (options) => {
                      if (pageRef.current !== activePage) return;
                      restoreFocusOnClose.current =
                        options?.restoreFocus !== false;
                      changeOpen(false);
                    },
                    onResume: () => {
                      const action = findAction(itemsRef.current, entry.id);
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
                      setOpen(true);
                      setContextOpen(true);
                      activate(action, origin, false);
                    },
                  })}
                </LegacyContextPage>
              ) : null}
            </ContextSubmenu>
          );
        }
        return (
          <DropdownMenuItem
            key={entry.id}
            disabled={entry.disabled}
            onSelect={() => {
              changeOpen(false);
              selectAction(entry);
            }}
          >
            {entry.icon}
            {entry.label}
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuGroup>
  );

  return (
    <>
      {addAttachment && (
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={attachmentAccept}
          hidden
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
      )}
      <DropdownMenu open={open} onOpenChange={changeOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={triggerRef}
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                disabled={disabled}
                aria-label={label}
              >
                <IconPlus />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          className="w-64"
          data-agent-native-composer-popover="true"
          onCloseAutoFocus={(event) => {
            if (pendingDialog.current) {
              event.preventDefault();
              setDialog(pendingDialog.current);
              pendingDialog.current = null;
            }
            if (!restoreFocusOnClose.current) event.preventDefault();
            restoreFocusOnClose.current = true;
          }}
        >
          <ContextMenuPanel
            placeholder={t("agentChat.composer.menu.search", {
              defaultValue: "Search…",
            })}
          >
            {(query) => (
              <DropdownMenuGroup>
                {(addAttachment || onAttachmentRequest) &&
                  uploadLabel
                    .toLocaleLowerCase()
                    .includes(query.trim().toLocaleLowerCase()) && (
                    <DropdownMenuItem
                      onSelect={() => {
                        changeOpen(false);
                        if (addAttachment) inputRef.current?.click();
                        else onAttachmentRequest?.();
                      }}
                    >
                      <IconFile size={16} />
                      {uploadLabel}
                    </DropdownMenuItem>
                  )}
                {items.length > 0 &&
                  (label
                    .toLocaleLowerCase()
                    .includes(query.trim().toLocaleLowerCase()) ||
                    items.some((item) => matchesEntry(item, query))) && (
                    <ContextSubmenu
                      label={label}
                      icon={<IconTextRecognition size={16} />}
                      open={contextOpen}
                      onOpenChange={(next) => {
                        setContextOpen(next);
                        if (!next) {
                          dismissPage();
                          updatePath([]);
                        }
                      }}
                    >
                      <ContextMenuPanel placeholder={searchContext}>
                        {(contextQuery) =>
                          renderEntries(
                            items.filter((item) =>
                              matchesEntry(item, contextQuery),
                            ),
                            [],
                          )
                        }
                      </ContextMenuPanel>
                    </ContextSubmenu>
                  )}
              </DropdownMenuGroup>
            )}
          </ContextMenuPanel>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog &&
        dialogAvailable &&
        dialogAction?.picker &&
        typeof dialogAction.picker.presentation === "object" && (
          <ComposerContextPickerDialog
            key={JSON.stringify([dialog.id, dialogAction.picker.scopeKey])}
            title={dialogAction.label}
            config={dialogAction.picker}
            onClose={() => {
              if (dialogRef.current !== dialog) return;
              dialogRef.current = null;
              setDialog(null);
              try {
                dialogAction.onDismiss?.();
              } catch (cause) {
                reportError(cause);
              }
            }}
            onRestoreFocus={() => {
              if (!dialogRef.current) triggerRef.current?.focus();
            }}
          />
        )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}
