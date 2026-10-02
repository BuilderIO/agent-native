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
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { Skeleton } from "../ui/skeleton.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { formatAttachmentError } from "./attachment-accept.js";
import {
  ComposerContextPicker,
  type ComposerContextPickerConfig,
} from "./ComposerContextPicker.js";
import { ComposerContextPickerDialog } from "./ComposerContextPickerDialog.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";
import { useComposerPanelPlacement } from "./use-composer-panel-placement.js";

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
  description?: string;
  intent?: "add-context" | "invoke-integration";
  keywords?: readonly string[];
  icon?: ReactNode;
  disabled?: boolean;
}
export type ComposerContextMenuAction = ComposerContextMenuEntry & {
  checked?: boolean;
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
  menuActionItems?: readonly ComposerContextMenuItem[];
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  addAttachment?: (file: File) => Promise<unknown>;
  onAttachmentRequest?: () => void;
  attachmentAccept?: string;
  onAttachmentError?: (message: string) => void;
  onDisabledFocus?: () => void;
  onRestoreFocus?: () => void;
  contextButtonTooltipDisabled?: boolean;
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
  inheritedDisabled = false,
): ComposerContextMenuAction | undefined {
  for (const item of items) {
    const disabled = inheritedDisabled || item.disabled === true;
    if (item.children) {
      const match = findAction(item.children, id, disabled);
      if (match) return match;
    } else if (item.id === id)
      return disabled ? { ...item, disabled: true } : item;
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
      const searchable = [
        ...ancestors,
        entry.label,
        entry.description ?? "",
        ...(entry.keywords ?? []),
      ];
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
        <span className="min-w-0 truncate">{label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        style={{ boxShadow: "none" }}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 max-w-[calc(100vw-24px)] overflow-y-auto data-[state=open]:fade-in-100 data-[state=closed]:fade-out-100"
        data-agent-native-composer-popover="true"
        onFocusOutside={(event) => {
          const target = event.target;
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

function ContextEntryLabel({ label, description }: ComposerContextMenuEntry) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-row @md:items-baseline @md:gap-2">
      <span
        className={
          description
            ? "min-w-0 truncate @md:max-w-[60%] @md:shrink-0"
            : "min-w-0 truncate"
        }
      >
        {label}
      </span>
      {description && (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {description}
        </span>
      )}
    </span>
  );
}

export function ComposerContextMenu({
  items,
  menuActionItems = [],
  loading,
  error: searchError,
  onRetry,
  open: controlledOpen,
  onOpenChange,
  addAttachment,
  onAttachmentRequest,
  attachmentAccept,
  onAttachmentError,
  onDisabledFocus,
  onRestoreFocus,
  contextButtonTooltipDisabled = false,
  disabled,
}: ComposerContextMenuProps) {
  const t = useComposerRuntimeAdapters().translate!;
  const allItems = [...menuActionItems, ...items];
  const onDisabledFocusRef = useRef(onDisabledFocus);
  onDisabledFocusRef.current = onDisabledFocus;
  const disabledFocusFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (disabledFocusFrame.current !== null)
        window.cancelAnimationFrame(disabledFocusFrame.current);
    },
    [],
  );
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [triggerTooltipOpen, setTriggerTooltipOpen] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const pathRef = useRef(path);
  const [page, setPage] = useState<ComposerContextPage | null>(null);
  const pageRef = useRef(page);
  const itemsRef = useRef(allItems);
  itemsRef.current = allItems;
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const placement = useComposerPanelPlacement(triggerRef, open);
  const pendingDialog = useRef<ComposerContextDialogSession | null>(null);
  const pendingAttachmentRequest = useRef(false);
  const [dialog, setDialog] = useState<ComposerContextDialogSession | null>(
    null,
  );
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const dialogAction = dialog ? findAction(allItems, dialog.id) : undefined;
  const dialogAvailable =
    !dialogAction?.disabled &&
    dialogAction?.picker &&
    dialogAction.picker.scopeKey === dialog?.scopeKey;
  useEffect(() => {
    if (dialog && !dialogAvailable && !disabled) {
      dialogRef.current = null;
      setDialog(null);
    }
  }, [dialog, dialogAvailable, disabled]);
  useEffect(() => {
    if (contextButtonTooltipDisabled) setTriggerTooltipOpen(false);
  }, [contextButtonTooltipDisabled]);
  const restoreFocusOnClose = useRef(true);
  const label = t("agentChat.composer.addContext", {
    defaultValue: "Add context",
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
  const updatePath = useCallback((next: string[]) => {
    pathRef.current = next;
    setPath(next);
  }, []);
  const changeOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next);
      onOpenChange?.(next);
      if (!next) {
        dismissPage();
        updatePath([]);
      }
    },
    [controlledOpen, dismissPage, onOpenChange, updatePath],
  );
  useEffect(() => {
    if (open || !pendingAttachmentRequest.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (!pendingAttachmentRequest.current) return;
      pendingAttachmentRequest.current = false;
      onAttachmentRequest?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [onAttachmentRequest, open]);
  useEffect(() => {
    if (!disabled) return;
    pendingDialog.current = null;
    if (open) {
      restoreFocusOnClose.current = false;
      changeOpen(false);
    }
    const closingDialog = dialogRef.current;
    if (!closingDialog) return;
    dialogRef.current = null;
    setDialog(null);
    try {
      findAction(itemsRef.current, closingDialog.id)?.onDismiss?.();
    } catch (cause) {
      reportError(cause);
    }
    disabledFocusFrame.current = window.requestAnimationFrame(() => {
      disabledFocusFrame.current = null;
      onDisabledFocusRef.current?.();
    });
  }, [disabled, open, changeOpen, reportError]);
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
  const currentAction = page ? findAction(allItems, page.id) : undefined;
  useEffect(() => {
    if (
      page &&
      (currentAction?.disabled ||
        (!currentAction?.render && !currentAction?.picker))
    ) {
      dismissPage();
      updatePath(page.origin);
    }
  }, [page, currentAction, dismissPage, updatePath]);

  const renderEntries = (
    entries: readonly ComposerContextMenuItem[],
    origin: string[],
  ): ReactNode => (
    <>
      {entries.map((entry) => {
        const branch = [...origin, entry.id];
        const expanded = branch.every((id, index) => path[index] === id);
        if (entry.children) {
          return (
            <ContextSubmenu
              key={entry.id}
              label={entry.label}
              disabled={entry.disabled}
              open={expanded}
              onOpenChange={(next) => {
                const isOpen = branch.every(
                  (id, index) => pathRef.current[index] === id,
                );
                if (next === isOpen) return;
                if (!next) {
                  dismissPage();
                  updatePath(origin);
                  return;
                }
                setError(null);
                updatePath(branch);
              }}
            >
              {renderEntries(entry.children, branch)}
            </ContextSubmenu>
          );
        }
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
              <ContextEntryLabel {...entry} />
            </DropdownMenuItem>
          );
        }
        if (entry.picker || entry.render) {
          const back = () => {
            dismissPage();
            updatePath(origin);
          };
          const activePage = page;
          return (
            <ContextSubmenu
              key={entry.id}
              label={entry.label}
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
                activate(entry, origin);
              }}
            >
              {entry.picker ? (
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
                      if (!action?.render || action.disabled) {
                        reportError(
                          new Error(
                            t("agentChat.composer.contextActionFailed", {
                              defaultValue: "Could not add context.",
                            }),
                          ),
                        );
                        return;
                      }
                      changeOpen(true);
                      activate(action, origin, false);
                    },
                  })}
                </LegacyContextPage>
              ) : null}
            </ContextSubmenu>
          );
        }
        if (entry.checked !== undefined) {
          return (
            <DropdownMenuCheckboxItem
              key={entry.id}
              checked={entry.checked}
              disabled={entry.disabled}
              onSelect={(event) => {
                event.preventDefault();
                selectAction(entry);
              }}
            >
              <ContextEntryLabel {...entry} />
            </DropdownMenuCheckboxItem>
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
            <ContextEntryLabel {...entry} />
          </DropdownMenuItem>
        );
      })}
    </>
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
      <DropdownMenu
        open={open}
        onOpenChange={changeOpen}
        dir={placement.direction}
      >
        <Tooltip
          open={triggerTooltipOpen && !contextButtonTooltipDisabled}
          onOpenChange={setTriggerTooltipOpen}
        >
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={triggerRef}
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                data-agent-composer-slot="plus-button"
                disabled={disabled}
                aria-label={label}
                onClick={(event) => event.stopPropagation()}
              >
                <IconPlus />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          side={placement.side}
          sideOffset={placement.sideOffset}
          alignOffset={placement.alignOffset}
          collisionPadding={12}
          style={{
            maxHeight: placement.maxHeight,
            boxShadow: "none",
          }}
          className="@container flex w-64 max-w-[calc(100vw-24px)] flex-col p-1 data-[state=open]:fade-in-100 data-[state=closed]:fade-out-100"
          data-agent-native-composer-popover="true"
          onCloseAutoFocus={(event) => {
            if (pendingDialog.current) {
              event.preventDefault();
              setDialog(pendingDialog.current);
              pendingDialog.current = null;
              return;
            }
            if (!restoreFocusOnClose.current) event.preventDefault();
            else if (onRestoreFocus) {
              event.preventDefault();
              onRestoreFocus();
            }
            restoreFocusOnClose.current = true;
          }}
        >
          <div className="min-h-0 overflow-y-auto">
            <DropdownMenuGroup>
              {(addAttachment || onAttachmentRequest) && (
                <DropdownMenuItem
                  onSelect={() => {
                    if (addAttachment) {
                      changeOpen(false);
                      inputRef.current?.click();
                    } else {
                      pendingAttachmentRequest.current = true;
                      changeOpen(false);
                    }
                  }}
                >
                  <IconFile size={16} />
                  {uploadLabel}
                </DropdownMenuItem>
              )}
              {(items.length > 0 || loading || searchError) && (
                <ContextSubmenu
                  label={label}
                  icon={<IconTextRecognition size={16} />}
                  open={path[0] === "add-context"}
                  onOpenChange={(next) => {
                    if (next === (pathRef.current[0] === "add-context")) return;
                    if (!next) {
                      dismissPage();
                      updatePath([]);
                      return;
                    }
                    setError(null);
                    updatePath(["add-context"]);
                  }}
                >
                  {renderEntries(items, ["add-context"])}
                  {loading && (
                    <div
                      role="status"
                      aria-label={t("agentChat.composer.contextPending", {
                        defaultValue: "Loading context…",
                      })}
                      className="grid gap-2 p-3"
                    >
                      <Skeleton className="h-5 w-2/3" />
                      <Skeleton className="h-5 w-1/2" />
                    </div>
                  )}
                  {searchError && (
                    <div
                      role="alert"
                      className="px-3 py-2 text-sm text-destructive"
                    >
                      {searchError}
                    </div>
                  )}
                  {searchError && onRetry && (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault();
                        onRetry();
                      }}
                    >
                      {t("agentChat.common.retry", { defaultValue: "Retry" })}
                    </DropdownMenuItem>
                  )}
                </ContextSubmenu>
              )}
              {renderEntries(menuActionItems, [])}
            </DropdownMenuGroup>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog && dialogAvailable && dialogAction?.picker && (
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
            if (dialogRef.current) return;
            if (!disabled) {
              if (onRestoreFocus) onRestoreFocus();
              else triggerRef.current?.focus();
            }
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
